# Demo video rebuild — design

Date: 2026-08-03

## Goal

Replace `docs/media/aegis-demo.mp4` / `aegis-demo.gif` with a new ~20s narrated,
captioned demo that shows two things the current clip doesn't clearly separate:

1. RAG working end-to-end: pasting a document into the Documents panel, then
   asking a question that can only be answered from that document.
2. Smart Search working end-to-end: toggling Smart Search on and asking a
   live/current question, showing the agent step trace and a cited answer
   with web source chips.

## Pipeline

```
scripts/demo/record.py     Playwright drives `npm run dev`, records two raw
                            segments (rag.webm, websearch.webm) by waiting on
                            real DOM state (answer text, source-chip count),
                            not fixed sleeps.

scripts/demo/narrate.py    Piper TTS (en_US voice) renders one narration line
                            per segment to wav.

scripts/demo/build_video.py
                            For each segment: speed up raw footage (ffmpeg
                            setpts) to fit its ~9-10s slot, speed-fit the
                            narration wav to the same window (floor to stay
                            intelligible), burn in an .srt subtitle generated
                            from the same two lines, concat segments, mux
                            audio. Output: docs/media/aegis-demo.mp4.
                            Also regenerate aegis-demo.gif from the final mp4.
```

## Content

- RAG doc: a short paragraph about Aegis's own architecture (ReAct loop,
  three-layer persistence fallback), pasted into the Documents panel.
- RAG query (Smart Search off): a question answerable only from that pasted
  paragraph — proves retrieval, not model background knowledge.
- Web query (Smart Search on): a current-events-style question — proves live
  Tavily search + citation synthesis.

## Timing

Target total ≤ 20s: ~9s RAG segment + ~10s web segment. Real API round-trips
will make raw footage longer than that; each segment is uniformly sped up
(`setpts`) to fit its slot rather than cut mid-action, which also reads as an
intentional "fast-forward while it works" cue.

## Dependencies (no sudo required)

- `playwright` + one browser (`npx playwright install chromium`)
- `piper-tts` (pip) + one voice model (~60MB, gitignored, documented
  re-download command in `scripts/demo/README.md`)
- `ffmpeg` via the `imageio-ffmpeg` PyPI wheel

## Error handling

`record.py` waits on explicit success conditions (answer text present, source
chip count > 0) with a generous timeout and fails loudly (non-zero exit,
clear message) if OpenAI/Tavily/Postgres/Redis aren't reachable or the agent
errors — no silent recording of a broken demo.

## Out of scope

- Re-styling the UI for the recording.
- Changing README wording beyond keeping it accurate to the new clip.
- Any narration/subtitle reuse from other projects — built fresh for this repo.
