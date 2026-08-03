# Demo video tooling

Regenerates `docs/media/aegis-demo.mp4` / `.gif`: a real Playwright recording of
the running app — Part 1: pasting text AND uploading a PDF into RAG, then
asking a question answered from that content; Part 2: Smart Search
researching the web — with Piper TTS narration (male voice, audio only, no
subtitles), sped up to fit ~20-25s.

## Setup (one time)

```bash
cd scripts/demo
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium

mkdir -p voices
curl -fsSL -o voices/en_US-ryan-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx"
curl -fsSL -o voices/en_US-ryan-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json"
```

(`en_US-ryan-medium` is a male voice. Swap the name in `narrate.py`'s
`VOICE_MODEL` for a different Piper voice.)

## Regenerate

1. Start the app: `npm run dev` (needs real `OPENAI_API_KEY`, `TAVILY_API_KEY`,
   `DATABASE_URL` in `.env.local` — this records real RAG + web search calls).
2. From `scripts/demo/` with the venv active:

   ```bash
   python record.py        # generates assets/*.pdf, records raw/rag.webm + raw/web.webm
   python narrate.py       # synthesizes narration_audio/*.wav
   python build_video.py   # writes docs/media/aegis-demo.mp4 + .gif
   ```

`record.py` renders its own sample PDF with Playwright (`page.pdf()`) into
`assets/` before recording, so no PDF needs to be committed. Edit
`narration.py` to change the narration lines or per-segment time budget.

## Note on Postgres/Redis timeouts

`src/lib/db/client.ts` and `src/lib/memory/client.ts` have explicit connection
timeouts (added alongside this tooling) so that an unreachable Postgres/Redis
host fails fast and falls back gracefully instead of hanging `/api/chat`
indefinitely — same pattern as the existing `AbortController` guards around
the OpenAI calls. If recording hangs, check `REDIS_URL`/`DATABASE_URL` are
actually reachable first.

## Note on PDF upload (pdfjs-dist + Next.js)

`pdfjs-dist`'s Node.js code path dynamically imports its own worker module at
runtime. Bundled by webpack, that dynamic import gets rewritten into an
internal module reference that doesn't exist at runtime, breaking PDF text
extraction with a "Setting up fake worker failed" / module-not-found error.
Fixed by adding `pdfjs-dist` to `serverExternalPackages` in `next.config.ts`,
which excludes it from webpack bundling entirely so Node's native module
resolution handles it unbundled.
