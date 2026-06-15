import base64
import io
import json
import sys
import traceback


def write_json(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    try:
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline
    except Exception as error:
        write_json({"type": "ready", "ok": False, "error": f"Kokoro dependencies are not installed: {error}"})
        return 1

    pipelines = {}
    write_json({"type": "ready", "ok": True})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        request = {}
        try:
            request = json.loads(line)
            request_id = request.get("id")
            text = str(request.get("text") or "").strip()
            voice = str(request.get("voice") or "jf_alpha")
            lang = str(request.get("lang") or "e")
            speed = float(request.get("speed") or 0.95)

            if not request_id:
                raise ValueError("Missing request id.")
            if not text:
                raise ValueError("Missing text.")

            if lang not in pipelines:
                pipelines[lang] = KPipeline(lang_code=lang)

            chunks = []
            for _graphemes, _phonemes, audio in pipelines[lang](text, voice=voice, speed=speed):
                chunks.append(audio)
            if not chunks:
                raise RuntimeError("Kokoro generated no audio.")

            combined = np.concatenate(chunks)
            output = io.BytesIO()
            sf.write(output, combined, 24000, format="WAV")
            audio = base64.b64encode(output.getvalue()).decode("ascii")
            write_json({
                "id": request_id,
                "ok": True,
                "audio": audio,
                "mimeType": "audio/wav",
                "sampleRate": 24000
            })
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            write_json({
                "id": request.get("id"),
                "ok": False,
                "error": str(error)
            })

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
