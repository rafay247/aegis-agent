"""Shared ffmpeg helpers for the demo build pipeline (no ffprobe binary available,
so duration is parsed from ffmpeg's own stderr banner)."""

import re
import subprocess

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

_DURATION_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)")


def get_duration(path) -> float:
    result = subprocess.run(
        [FFMPEG, "-i", str(path)],
        capture_output=True,
        text=True,
    )
    match = _DURATION_RE.search(result.stderr)
    if not match:
        raise RuntimeError(f"Could not determine duration of {path}:\n{result.stderr}")
    hours, minutes, seconds = match.groups()
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def run_ffmpeg(args):
    cmd = [FFMPEG, "-y", *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed ({' '.join(cmd)}):\n{result.stderr[-4000:]}"
        )
    return result
