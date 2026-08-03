"""Narration lines and per-segment timing budget shared by narrate.py and build_video.py."""

SEGMENTS = [
    {
        "name": "rag",
        "target_seconds": 9.0,
        "line": (
            "Paste a document into RAG, ask a question, and Aegis retrieves "
            "the answer straight from your source."
        ),
    },
    {
        "name": "web",
        "target_seconds": 10.0,
        "line": (
            "Switch on Smart Search and Aegis researches the live web, "
            "citing every source it finds."
        ),
    },
]
