import argparse
import base64
import io
import json
import sys
import time
import traceback


def write_json(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Persistent Kokoro ONNX JSONL worker.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    args = parser.parse_args()

    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except Exception as error:
        write_json({"type": "ready", "ok": False, "error": f"Kokoro ONNX dependencies are not installed: {error}"})
        return 1

    try:
        started = time.perf_counter()
        kokoro = Kokoro(args.model, args.voices)
        write_json({"type": "ready", "ok": True, "loadMs": round((time.perf_counter() - started) * 1000)})
    except Exception as error:
        write_json({"type": "ready", "ok": False, "error": str(error)})
        return 1

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            text = str(request.get("text") or "").strip()
            voice = str(request.get("voice") or "ef_dora")
            lang = str(request.get("lang") or "es")
            speed = float(request.get("speed") or 1.0)
            if not request_id:
                raise ValueError("Missing request id.")
            if not text:
                raise ValueError("Missing text.")

            started = time.perf_counter()
            samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang)
            output = io.BytesIO()
            sf.write(output, samples, sample_rate, format="WAV")
            audio = base64.b64encode(output.getvalue()).decode("ascii")
            write_json({
                "id": request_id,
                "ok": True,
                "audio": audio,
                "mimeType": "audio/wav",
                "sampleRate": sample_rate,
                "totalTtsMs": round((time.perf_counter() - started) * 1000)
            })
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            write_json({"id": request.get("id"), "ok": False, "error": str(error)})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
