"""Record raw demo footage for the Aegis README video.

Drives the real running app (npm run dev must already be up on
http://localhost:3000, with real API keys in .env.local) with Playwright and
records two segments:

  1. rag    - paste a document into RAG, ask a question only it can answer.
  2. web    - toggle Smart Search, ask a live question, show cited web sources.

Output: scripts/demo/raw/rag.webm, scripts/demo/raw/web.webm
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright, expect

BASE_URL = "http://localhost:3000"
RAW_DIR = pathlib.Path(__file__).parent / "raw"
VIEWPORT = {"width": 1280, "height": 800}

RAG_TITLE = "Aegis Architecture"
RAG_TEXT = (
    "Aegis is a ReAct research agent built on Next.js. Each turn it builds a "
    "plan, then either searches the web with Tavily or retrieves from its own "
    "pgvector-backed RAG store, calls OpenAI's Responses API to synthesize a "
    "cited answer, and falls back to a local template synthesizer or an "
    "in-process runtime store whenever Redis, Postgres, or OpenAI are "
    "unavailable."
)
RAG_QUESTION = (
    "According to the loaded document, what does Aegis fall back to when "
    "Redis or Postgres are unavailable?"
)
WEB_QUESTION = "What is the latest stable version of Node.js, and when was it released?"


def record_rag_segment(browser):
    context = browser.new_context(
        viewport=VIEWPORT,
        record_video_dir=str(RAW_DIR),
        record_video_size=VIEWPORT,
    )
    page = context.new_page()
    page.goto(BASE_URL)

    page.get_by_label("Attach sources").click()
    page.get_by_label("Source title").fill(RAG_TITLE)
    page.get_by_label("Explicit content for RAG search").fill(RAG_TEXT)
    page.get_by_role("button", name="Add to RAG").click()
    expect(page.locator(".source-ingest-status")).to_have_text(
        "Explicit content added to RAG.", timeout=30_000
    )
    page.wait_for_timeout(600)
    page.locator(".source-modal-close").click()

    page.get_by_placeholder("Message Aegis").fill(RAG_QUESTION)
    page.get_by_label("Send message").click()
    expect(page.locator(".agent-thinking")).to_be_hidden(timeout=60_000)
    expect(page.locator(".message-content").last).to_be_visible()
    page.wait_for_timeout(1500)

    context.close()
    video_path = page.video.path()
    return video_path


def record_web_segment(browser):
    context = browser.new_context(
        viewport=VIEWPORT,
        record_video_dir=str(RAW_DIR),
        record_video_size=VIEWPORT,
    )
    page = context.new_page()
    page.goto(BASE_URL)

    page.get_by_role("button", name="Smart Search").click()
    expect(page.get_by_role("button", name="Smart Search")).to_have_attribute(
        "aria-pressed", "true"
    )

    page.get_by_placeholder("Message Aegis").fill(WEB_QUESTION)
    page.get_by_label("Send message").click()
    expect(page.locator(".agent-thinking")).to_be_hidden(timeout=90_000)
    expect(page.locator(".source-chip").first).to_be_visible(timeout=10_000)
    page.wait_for_timeout(1500)

    context.close()
    video_path = page.video.path()
    return video_path


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        rag_video = record_rag_segment(browser)
        rag_target = RAW_DIR / "rag.webm"
        pathlib.Path(rag_video).rename(rag_target)
        print(f"RAG segment saved: {rag_target}")

        web_video = record_web_segment(browser)
        web_target = RAW_DIR / "web.webm"
        pathlib.Path(web_video).rename(web_target)
        print(f"Web segment saved: {web_target}")

        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Recording failed: {exc}", file=sys.stderr)
        sys.exit(1)
