"""Narration lines and per-segment timing budget shared by narrate.py and build_video.py."""

SEGMENTS = [
    {
        "name": "docs",
        "target_seconds": 14.0,
        "line": (
            "Upload a PDF to your private library, switch to My documents, and "
            "ask. Aegis searches your files live, streams the answer, and every "
            "citation opens the exact passage it came from."
        ),
    },
    {
        "name": "web",
        "target_seconds": 13.0,
        "line": (
            "Switch to Web and Aegis researches the live internet instead, never "
            "mixing the two, with a cited source behind every claim."
        ),
    },
]
