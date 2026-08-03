"""Build docs/media/aegis-demo.mp4 (+ .gif) from raw Playwright footage and Piper narration.

For each segment: speed up the raw screen recording (setpts) and the narration
audio (atempo) to fit a fixed time budget, burn in a one-line subtitle, then
concat the segments and render a matching gif.
"""

import pathlib
import tempfile

from ffmpeg_util import FFMPEG, get_duration, run_ffmpeg
from narration import SEGMENTS

HERE = pathlib.Path(__file__).parent
RAW_DIR = HERE / "raw"
NARRATION_DIR = HERE / "narration_audio"
OUT_DIR = HERE / "build"
FINAL_MP4 = HERE.parent.parent / "docs" / "media" / "aegis-demo.mp4"
FINAL_GIF = HERE.parent.parent / "docs" / "media" / "aegis-demo.gif"

MAX_AUDIO_SPEEDUP = 1.3


def format_srt_time(seconds: float) -> str:
    ms = round(seconds * 1000)
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def write_srt(path: pathlib.Path, text: str, duration: float):
    srt = (
        "1\n"
        f"{format_srt_time(0)} --> {format_srt_time(duration)}\n"
        f"{text}\n"
    )
    path.write_text(srt)


def build_segment(segment: dict) -> pathlib.Path:
    name = segment["name"]
    raw_path = RAW_DIR / f"{name}.webm"
    wav_path = NARRATION_DIR / f"{name}.wav"
    out_path = OUT_DIR / f"{name}.mp4"

    raw_duration = get_duration(raw_path)
    wav_duration = get_duration(wav_path)

    target = segment["target_seconds"]
    audio_speed = max(wav_duration / target, 1.0)
    if audio_speed > MAX_AUDIO_SPEEDUP:
        audio_speed = MAX_AUDIO_SPEEDUP
        effective_target = wav_duration / audio_speed
    else:
        effective_target = target

    video_speed_factor = raw_duration / effective_target  # setpts divisor

    print(
        f"[{name}] raw={raw_duration:.1f}s wav={wav_duration:.1f}s "
        f"target={effective_target:.2f}s video_speedup={video_speed_factor:.2f}x "
        f"audio_speedup={audio_speed:.2f}x"
    )

    with tempfile.TemporaryDirectory() as tmp:
        srt_path = pathlib.Path(tmp) / f"{name}.srt"
        write_srt(srt_path, segment["line"], effective_target)

        if video_speed_factor >= 1:
            # Raw footage is longer than the slot: speed it up to fit.
            video_chain = (
                f"[0:v]setpts=PTS/{video_speed_factor},"
                f"trim=0:{effective_target},setpts=PTS-STARTPTS"
            )
        else:
            # Raw footage is already shorter than the slot: keep natural speed
            # and freeze on the last frame instead of slowing it down.
            pad_seconds = effective_target - raw_duration
            video_chain = f"[0:v]tpad=stop_mode=clone:stop_duration={pad_seconds}"

        filter_complex = (
            f"{video_chain},"
            f"subtitles='{srt_path}':force_style='FontName=DejaVu Sans,FontSize=22,"
            "Outline=2,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000'[v];"
            f"[1:a]atempo={audio_speed},apad,atrim=0:{effective_target}[a]"
        )

        run_ffmpeg(
            [
                "-i", str(raw_path),
                "-i", str(wav_path),
                "-filter_complex", filter_complex,
                "-map", "[v]",
                "-map", "[a]",
                "-r", "30",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                str(out_path),
            ]
        )

    return out_path


def concat_segments(segment_paths):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    list_path = OUT_DIR / "concat.txt"
    list_path.write_text("".join(f"file '{p.resolve()}'\n" for p in segment_paths))

    FINAL_MP4.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(
        [
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_path),
            "-c", "copy",
            str(FINAL_MP4),
        ]
    )


def build_gif():
    palette = OUT_DIR / "palette.png"
    run_ffmpeg(
        [
            "-i", str(FINAL_MP4),
            "-vf", "fps=12,scale=720:-1:flags=lanczos,palettegen",
            str(palette),
        ]
    )
    run_ffmpeg(
        [
            "-i", str(FINAL_MP4),
            "-i", str(palette),
            "-lavfi", "fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse",
            str(FINAL_GIF),
        ]
    )


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    segment_paths = [build_segment(segment) for segment in SEGMENTS]
    concat_segments(segment_paths)
    build_gif()
    total = get_duration(FINAL_MP4)
    print(f"Final video: {FINAL_MP4} ({total:.2f}s)")
    print(f"Final gif: {FINAL_GIF}")


if __name__ == "__main__":
    main()
