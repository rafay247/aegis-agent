"""Narration lines and per-segment timing budget shared by narrate.py and build_video.py."""

SEGMENTS = [
    {
        "name": "rag",
        "target_seconds": 14.0,
        "line": (
            "Add a document or upload a PDF into RAG, ask a question, and "
            "Aegis retrieves the answer straight from your own sources."
        ),
    },
    {
        "name": "web",
        "target_seconds": 9.0,
        "line": (
            "Switch on Smart Search and Aegis researches the live web, "
            "citing every source it finds."
        ),
    },
]
