import argparse
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Generate local TTS audio with Kokoro.")
    parser.add_argument("--text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--voice", default="ef_dora")
    parser.add_argument("--lang", default="e")
    parser.add_argument("--speed", type=float, default=0.95)
    args = parser.parse_args()

    try:
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline
    except Exception as error:
        fail(f"Kokoro dependencies are not installed: {error}")

    try:
        pipeline = KPipeline(lang_code=args.lang)
        chunks = []
        for _graphemes, _phonemes, audio in pipeline(args.text, voice=args.voice, speed=args.speed):
            chunks.append(audio)
        if not chunks:
            fail("Kokoro generated no audio.")
        combined = np.concatenate(chunks)
        sf.write(args.output, combined, 24000)
        print(json.dumps({"ok": True, "output": args.output, "sampleRate": 24000}))
    except Exception as error:
        fail(str(error))


def fail(message):
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
