import argparse
import json
import os
import subprocess
import sys
import time
import wave
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = ROOT_DIR / "data" / "tts" / "kokoro" / "kokoro-v1.0.onnx"
DEFAULT_VOICES = ROOT_DIR / "data" / "tts" / "kokoro" / "voices-v1.0.bin"
LOCAL_VENV_PYTHON = ROOT_DIR / ".local" / "kokoro-onnx-venv" / "Scripts" / "python.exe"


def main():
    parser = argparse.ArgumentParser(description="Generate local TTS audio with Kokoro ONNX.")
    parser.add_argument("--text", default="Si, mi creador.")
    parser.add_argument("--output", default="")
    parser.add_argument("--model", default=os.environ.get("KOKORO_MODEL_PATH", str(DEFAULT_MODEL) if DEFAULT_MODEL.exists() else ""))
    parser.add_argument("--voices", default=os.environ.get("KOKORO_VOICES_PATH", str(DEFAULT_VOICES) if DEFAULT_VOICES.exists() else ""))
    parser.add_argument("--voice", default=os.environ.get("KOKORO_VOICE", "ef_dora"))
    parser.add_argument("--lang", default=os.environ.get("KOKORO_LANGUAGE", os.environ.get("KOKORO_LANG", "es")))
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--list-voices", action="store_true")
    args = parser.parse_args()
    if args.self_test and (not args.output):
        args.output = os.path.join(os.environ.get("TEMP") or os.getcwd(), "mivtuberia-kokoro-onnx-self-test.wav")
    if not args.output and not args.list_voices:
        fail("--output is required.")
    if not args.model or not args.voices:
        if args.self_test:
            print(json.dumps({
                "ok": True,
                "status": "skipped",
                "reason": "KOKORO_MODEL_PATH/KOKORO_VOICES_PATH or --model/--voices are required."
            }, ensure_ascii=False))
            return 0
        fail("KOKORO_MODEL_PATH/KOKORO_VOICES_PATH or --model/--voices are required.")

    started = time.perf_counter()
    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except Exception as error:
        maybe_reexec_with_local_venv()
        fail(f"Kokoro ONNX dependencies are not installed: {error}")

    try:
        kokoro = Kokoro(args.model, args.voices)
        if args.list_voices:
            print(json.dumps({
                "ok": True,
                "backend": "kokoro",
                "engine": "kokoro-onnx",
                "voices": kokoro.get_voices()
            }, ensure_ascii=False))
            return 0
        samples, sample_rate = kokoro.create(
            args.text,
            voice=args.voice,
            speed=args.speed,
            lang=args.lang
        )
        sf.write(args.output, samples, sample_rate)
        audio_duration_ms = wav_duration_ms(args.output)
        total_ms = round((time.perf_counter() - started) * 1000)
        print(json.dumps({
            "ok": True,
            "backend": "kokoro",
            "engine": "kokoro-onnx",
            "output": args.output,
            "voice": args.voice,
            "lang": args.lang,
            "sampleRate": sample_rate,
            "firstAudioMs": total_ms,
            "totalTtsMs": total_ms,
            "audioDurationMs": audio_duration_ms,
            "rtf": round(total_ms / audio_duration_ms, 3) if audio_duration_ms else None
        }, ensure_ascii=False))
    except Exception as error:
        fail(str(error))


def wav_duration_ms(file_path):
    try:
        with wave.open(file_path, "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            if rate <= 0:
                return None
            return round(frames / rate * 1000)
    except Exception:
        return None


def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)


def maybe_reexec_with_local_venv():
    if os.environ.get("MIVTUBERIA_KOKORO_REEXEC") == "1":
        return
    if not LOCAL_VENV_PYTHON.exists():
        return
    current = Path(sys.executable).resolve()
    target = LOCAL_VENV_PYTHON.resolve()
    if current == target:
        return
    env = os.environ.copy()
    env["MIVTUBERIA_KOKORO_REEXEC"] = "1"
    completed = subprocess.run([str(target), *sys.argv], env=env)
    sys.exit(completed.returncode)


if __name__ == "__main__":
    raise SystemExit(main())
