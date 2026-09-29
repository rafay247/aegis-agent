"""Synthesize narration wavs for each demo segment with Piper TTS."""

import pathlib
import subprocess
import sys

from narration import SEGMENTS

HERE = pathlib.Path(__file__).parent
VOICE_MODEL = HERE / "voices" / "en_US-ryan-medium.onnx"
OUT_DIR = HERE / "narration_audio"


def synth(text: str, out_path: pathlib.Path):
    subprocess.run(
        # Run as a module: the venv's `piper` launcher breaks if the venv moves.
        [sys.executable, "-m", "piper", "-m", str(VOICE_MODEL), "-f", str(out_path)],
        input=text,
        text=True,
        check=True,
        capture_output=True,
    )


def main():
    if not VOICE_MODEL.exists():
        raise SystemExit(
            f"Voice model missing: {VOICE_MODEL}. See scripts/demo/README.md to download it."
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for segment in SEGMENTS:
        out_path = OUT_DIR / f"{segment['name']}.wav"
        synth(segment["line"], out_path)
        print(f"Synthesized {out_path}")


if __name__ == "__main__":
    main()
