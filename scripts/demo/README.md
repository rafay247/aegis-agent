# Demo video tooling

Regenerates `docs/media/aegis-demo.mp4` / `.gif` and `docs/screenshots/*.png`:
a real Playwright recording of the running app, with Piper TTS narration
(male voice, audio only, no subtitles).

- **Part 1 (docs):** upload a PDF in the My documents window, switch to
  "My documents", ask a question answered only by that PDF — live search
  steps, the streamed answer, and a document citation card.
- **Part 2 (web):** switch to "Web", ask a live question — live steps, the
  streamed answer, a web citation card, and the history sidebar; ends on
  the light theme.

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

1. Build and start the app with real `OPENAI_API_KEY` and `TAVILY_API_KEY`
   in `.env.local`. To keep demo data out of your real database, blank the
   stores for this run (the app then uses its in-memory fallbacks):

   ```bash
   npm run build
   DATABASE_URL= REDIS_URL= BRAINTRUST_API_KEY= npx next start -p 3000
   ```

   (`AEGIS_URL` overrides the default `http://localhost:3000`.)
2. From `scripts/demo/`:

   ```bash
   .venv/bin/python record.py        # assets/*.pdf, raw/docs.webm + raw/web.webm, docs/screenshots/*.png
   .venv/bin/python narrate.py       # narration_audio/*.wav
   .venv/bin/python build_video.py   # docs/media/aegis-demo.mp4 + .gif
   ```

`record.py` renders its own sample PDF into `assets/`, so no PDF needs to be
committed. Edit `narration.py` to change the narration lines or each
segment's time budget; keep the budgets close to the raw clip lengths
(printed by `build_video.py`) to avoid long frozen frames.

If a recording fails waiting for live steps, the agent probably hit its
fallback (for example a transient OpenAI error right after many requests);
wait a moment and run `record.py` again.

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
