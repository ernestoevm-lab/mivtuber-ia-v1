use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{path::BaseDirectory, Manager, RunEvent};

const BACKEND_PORT: u16 = 8787;
// Windows (WinNAT/Hyper-V) reserva rangos de puertos que cambian por reinicio y pueden
// capturar el 8787. Mismos candidatos que server/index.ts y scripts/dev.mjs.
const BACKEND_PORT_CANDIDATES: [u16; 5] = [8787, 17787, 27787, 37787, 47787];
// Puerto real del backend; el frontend lo consulta con el comando `get_backend_port`.
static CHOSEN_BACKEND_PORT: AtomicU16 = AtomicU16::new(BACKEND_PORT);
const BACKEND_STATUS_PATH: &str = "/api/status";
const BACKEND_WAIT_TIMEOUT: Duration = Duration::from_secs(45);

fn backend_port() -> u16 {
    CHOSEN_BACKEND_PORT.load(Ordering::Relaxed)
}

// En Windows, Tauri resuelve recursos con prefijo verbatim \\?\ (extended-length).
// Node NO soporta ese prefijo como entry point ni en NODE_PATH: revienta con
// "EISDIR: illegal operation on a directory, lstat 'C:'" (visto en el primer
// instalador beta, 2026-06-11). Quitarlo es seguro para rutas locales normales.
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

// Primer candidato bindeable ahora mismo. El listener de prueba se libera al salir; queda
// una ventana de carrera mínima, pero el backend tiene su propio fallback y este valor es
// su primer candidato (PORT), así que en el peor caso ambos convergen igual.
fn pick_available_port() -> u16 {
    for port in BACKEND_PORT_CANDIDATES {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    BACKEND_PORT
}

#[tauri::command]
fn get_backend_port() -> u16 {
    backend_port()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_child = Arc::new(Mutex::new(None::<Child>));
    let setup_backend_child = Arc::clone(&backend_child);
    let run_backend_child = Arc::clone(&backend_child);

    tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![get_backend_port])
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if cfg!(debug_assertions) {
        // En dev el backend lo lanza npm run dev (scripts/dev.mjs), que elige su propio
        // puerto si el 8787 está reservado: aquí solo lo DESCUBRIMOS escaneando candidatos.
        thread::spawn(|| {
          if let Some(port) = wait_for_backend_on_any_candidate(BACKEND_WAIT_TIMEOUT) {
            CHOSEN_BACKEND_PORT.store(port, Ordering::Relaxed);
            eprintln!("MiVtuberIA backend ready on port {port} (Tauri dev supervisor).");
          } else {
            eprintln!("MiVtuberIA backend did not become ready in Tauri dev. npm run dev should provide it.");
          }
        });
      } else {
        // En release elegimos el puerto ANTES de lanzar el sidecar y se lo pasamos (PORT).
        CHOSEN_BACKEND_PORT.store(pick_available_port(), Ordering::Relaxed);
        if let Err(error) = start_backend_supervisor(app, setup_backend_child) {
          eprintln!("MiVtuberIA backend supervisor failed: {error}");
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app_handle, event| {
      if matches!(event, RunEvent::Exit) {
        stop_backend_supervisor(&run_backend_child);
      }
    });
}

fn start_backend_supervisor<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
    backend_child: Arc<Mutex<Option<Child>>>,
) -> Result<(), String> {
    let log_path =
        prepare_log_path(app).map_err(|error| format!("could not prepare log path: {error}"))?;

    if backend_status_ready() {
        append_log(
            &log_path,
            &format!("Backend already responded on 127.0.0.1:{}; Tauri will not own it.", backend_port()),
        );
        return Ok(());
    }

    let backend_script = strip_verbatim(
        &app.path()
            .resolve("dist-server/server/index.js", BaseDirectory::Resource)
            .map_err(|error| format!("could not resolve dist-server resource: {error}"))?,
    );
    if !backend_script.exists() {
        append_log(
            &log_path,
            &format!("Missing backend script: {}", backend_script.display()),
        );
        return Err(format!(
            "backend script not found: {}",
            backend_script.display()
        ));
    }

    let resource_dir = strip_verbatim(
        &app.path()
            .resource_dir()
            .map_err(|error| format!("could not resolve resource dir: {error}"))?,
    );
    let app_data_dir = strip_verbatim(
        &app.path()
            .app_local_data_dir()
            .map_err(|error| format!("could not resolve app data dir: {error}"))?,
    );
    fs::create_dir_all(&app_data_dir).map_err(|error| {
        format!(
            "could not create app data dir {}: {error}",
            app_data_dir.display()
        )
    })?;

    let node_runtime = resolve_node_sidecar(app, &resource_dir).map_err(|error| {
        append_log(&log_path, &error);
        error
    })?;

    append_log(
        &log_path,
        &format!(
            "Starting backend with bundled Node sidecar: {}",
            node_runtime.display()
        ),
    );
    let mut command = Command::new(&node_runtime);
    command
        .arg(&backend_script)
        .current_dir(&app_data_dir)
        .env("NODE_ENV", "production")
        .env("NODE_PATH", resource_dir.join("node_modules"))
        .env("PORT", backend_port().to_string())
        .env("MIVTUBERIA_TAURI_MANAGED", "1")
        .env("MIVTUBERIA_ROOT_DIR", &app_data_dir)
        .env("MIVTUBERIA_BUNDLE_DIR", &resource_dir)
        .env("MIVTUBERIA_FRONTEND_DIST", resource_dir.join("dist"))
        .env("MIVTUBERIA_SCRIPTS_DIR", resource_dir.join("scripts"))
        .stdin(Stdio::null());

    attach_child_logs(&mut command, &log_path)?;

    // Windows: el sidecar es node.exe (subsistema consola). Sin CREATE_NO_WINDOW,
    // spawnearlo abre una ventana de consola negra junto a la app cuando el backend
    // corre como proceso persistente. La bandera la suprime.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("could not spawn Node backend: {error}"))?;
    let child_id = child.id();
    *backend_child
        .lock()
        .map_err(|_| "backend child lock poisoned".to_string())? = Some(child);
    append_log(
        &log_path,
        &format!("Backend child started with PID {child_id}."),
    );

    // El healthcheck va en un hilo aparte: bloquear aquí congela el hilo principal de
    // la ventana hasta 45s y Windows marca la app como "no responde" (visto en el
    // primer instalador beta). La UI ya muestra estado pendiente mientras tanto.
    let wait_log_path = log_path.clone();
    thread::spawn(move || {
        if wait_for_backend_ready(BACKEND_WAIT_TIMEOUT) {
            append_log(&wait_log_path, "Backend healthcheck succeeded.");
        } else {
            append_log(
                &wait_log_path,
                "Backend healthcheck timed out; UI will show pending/error state.",
            );
        }
    });

    Ok(())
}

fn resolve_node_sidecar<R: tauri::Runtime>(
    app: &tauri::App<R>,
    resource_dir: &Path,
) -> Result<PathBuf, String> {
    let mut candidates = vec![
        resource_dir.join("mivtuberia-node.exe"),
        resource_dir.join("mivtuberia-node"),
        resource_dir.join("binaries").join("mivtuberia-node.exe"),
        resource_dir.join("binaries").join("mivtuberia-node"),
        resource_dir.join("mivtuberia-node-x86_64-pc-windows-msvc.exe"),
        resource_dir
            .join("binaries")
            .join("mivtuberia-node-x86_64-pc-windows-msvc.exe"),
    ];

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
    {
        candidates.push(exe_dir.join("mivtuberia-node.exe"));
        candidates.push(exe_dir.join("mivtuberia-node"));
    }

    if let Ok(path) = app
        .path()
        .resolve("mivtuberia-node.exe", BaseDirectory::Resource)
    {
        candidates.push(path);
    }
    if let Ok(path) = app
        .path()
        .resolve("binaries/mivtuberia-node.exe", BaseDirectory::Resource)
    {
        candidates.push(path);
    }

    candidates
        .into_iter()
        .find(|path| path.exists())
        .map(|path| strip_verbatim(&path))
        .ok_or_else(|| {
            "Bundled Node sidecar was not found. Run `npm run tauri:prepare-sidecars` before `npm run app:build`.".to_string()
        })
}

fn stop_backend_supervisor(backend_child: &Arc<Mutex<Option<Child>>>) {
    let Ok(mut guard) = backend_child.lock() else {
        return;
    };
    let Some(mut child) = guard.take() else {
        return;
    };

    let _ = post_backend_shutdown();
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(3) {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => break,
        }
    }

    let _ = child.kill();
    let _ = child.wait();
}

fn prepare_log_path<R: tauri::Runtime>(app: &tauri::App<R>) -> std::io::Result<PathBuf> {
    let log_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?
        .join("logs");
    fs::create_dir_all(&log_dir)?;
    Ok(log_dir.join("tauri-backend.log"))
}

fn attach_child_logs(command: &mut Command, log_path: &Path) -> Result<(), String> {
    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| format!("could not open backend stdout log: {error}"))?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("could not clone backend log handle: {error}"))?;
    command
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    Ok(())
}

fn append_log(path: &Path, message: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[tauri-supervisor] {message}");
    }
}

// Escanea los candidatos hasta que alguno responda /api/status con ok (modo dev: el
// puerto lo eligió scripts/dev.mjs y aquí solo lo descubrimos).
fn wait_for_backend_on_any_candidate(timeout: Duration) -> Option<u16> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        for port in BACKEND_PORT_CANDIDATES {
            CHOSEN_BACKEND_PORT.store(port, Ordering::Relaxed);
            if backend_status_ready() {
                return Some(port);
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    CHOSEN_BACKEND_PORT.store(BACKEND_PORT, Ordering::Relaxed);
    None
}

fn wait_for_backend_ready(timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if backend_status_ready() {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn backend_status_ready() -> bool {
    match http_request("GET", BACKEND_STATUS_PATH) {
        Ok(response) => response.contains("200 OK") && response.contains("\"ok\":true"),
        Err(_) => false,
    }
}

fn post_backend_shutdown() -> std::io::Result<String> {
    http_request("POST", "/api/control/shutdown")
}

fn http_request(method: &str, path: &str) -> std::io::Result<String> {
    let port = backend_port();
    let address = ("127.0.0.1", port)
        .to_socket_addrs()?
        .next()
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::AddrNotAvailable,
                "backend address unavailable",
            )
        })?;
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(600))?;
    stream.set_read_timeout(Some(Duration::from_millis(900)))?;
    stream.set_write_timeout(Some(Duration::from_millis(900)))?;
    let request = format!(
    "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
  );
    stream.write_all(request.as_bytes())?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    Ok(response)
}
