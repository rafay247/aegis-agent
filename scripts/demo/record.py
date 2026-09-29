"""Record raw demo footage and README screenshots for Aegis.

Drives the real running app with Playwright (start it first, see README.md)
and records two segments:

  1. docs - upload a PDF in the My documents window, switch to "My
     documents" mode, ask a question answered only by that PDF: live search
     steps, the streamed answer, and a document citation card.
  2. web  - in "Web" mode, ask a live question: live search steps, the
     streamed answer, a web citation card, and the history sidebar.

Output: scripts/demo/raw/docs.webm, scripts/demo/raw/web.webm and
docs/screenshots/*.png
"""

import os
import pathlib
import sys

from playwright.sync_api import expect, sync_playwright

BASE_URL = os.environ.get("AEGIS_URL", "http://localhost:3000")
HERE = pathlib.Path(__file__).parent
RAW_DIR = HERE / "raw"
ASSETS_DIR = HERE / "assets"
SCREENSHOTS_DIR = HERE.parent.parent / "docs" / "screenshots"
VIEWPORT = {"width": 1280, "height": 800}

PDF_FILENAME = "RAG Pipeline Notes.pdf"
PDF_TEXT = (
    "Aegis chunks documents into roughly 1200-character pieces with a "
    "150-character overlap. Each chunk is embedded with OpenAI's "
    "text-embedding-3-small model, producing 1536-dimensional vectors, which "
    "are stored in a pgvector table behind an HNSW cosine-similarity index "
    "for fast retrieval."
)

DOCS_QUESTION = "How big is each chunk, and how much do chunks overlap?"
WEB_QUESTION = "What is the latest stable version of Node.js, and when was it released?"


def generate_sample_pdf(browser) -> pathlib.Path:
    """Render a one-page PDF with distinct content, used to demo PDF upload."""
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    pdf_path = ASSETS_DIR / PDF_FILENAME

    page = browser.new_page()
    page.set_content(
        f"""
        <html><body style="font-family: sans-serif; padding: 40px;">
          <h1>RAG Pipeline Notes</h1>
          <p>{PDF_TEXT}</p>
        </body></html>
        """
    )
    page.pdf(path=str(pdf_path), format="A4")
    page.close()
    return pdf_path


def new_recording_context(browser, storage_state=None):
    return browser.new_context(
        viewport=VIEWPORT,
        record_video_dir=str(RAW_DIR),
        record_video_size=VIEWPORT,
        storage_state=storage_state,
        color_scheme="dark",
    )


def ask(page, question: str, screenshot: str | None = None):
    composer = page.locator(".compact-composer textarea")
    composer.click()
    composer.press_sequentially(question, delay=18)
    page.wait_for_timeout(300)
    page.get_by_label("Send message").click()

    # Live search steps appear while the agent works...
    expect(page.locator(".live-steps li").first).to_be_visible(timeout=30_000)
    # ...then the answer streams in. A short answer can finish streaming
    # between polls, so only the screenshot depends on catching it mid-stream.
    streaming = page.locator(".message-content.streaming")
    try:
        expect(streaming).to_be_visible(timeout=60_000)
        if screenshot:
            page.screenshot(path=str(SCREENSHOTS_DIR / screenshot))
    except AssertionError:
        print("Answer finished before the streaming state was observed.")
    expect(page.locator(".live-answer")).to_be_hidden(timeout=90_000)
    page.wait_for_timeout(700)


def show_citation(page, selector: str):
    """Hover the first inline citation (or source chip) so its card shows."""
    refs = page.locator(f".message-content {selector}")
    if refs.count() > 0:
        refs.first.hover()
        page.wait_for_timeout(1800)
        return True
    return False


def record_docs_segment(browser, pdf_path: pathlib.Path):
    context = new_recording_context(browser)
    page = context.new_page()
    page.goto(BASE_URL)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SCREENSHOTS_DIR / "01-home.png"))

    # Upload a PDF through the My documents window.
    page.get_by_label("Manage my documents").click()
    page.wait_for_timeout(600)
    page.locator(".documents-dropzone input[type=file]").set_input_files(str(pdf_path))
    page.wait_for_timeout(700)
    page.locator(".documents-submit").click()
    expect(page.locator(".documents-status.success")).to_be_visible(timeout=60_000)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(SCREENSHOTS_DIR / "02-documents.png"))
    page.get_by_label("Close").click()
    page.wait_for_timeout(400)

    # Ask in My documents mode.
    page.get_by_role("radio", name="My documents").click()
    page.wait_for_timeout(500)
    ask(page, DOCS_QUESTION)
    show_citation(page, ".cite-ref.docs")
    page.mouse.move(5, 5)
    page.wait_for_timeout(600)

    state = context.storage_state()
    context.close()
    return page.video.path(), state


def record_web_segment(browser, storage_state):
    # Same browser workspace, so the history sidebar shows both chats.
    context = new_recording_context(browser, storage_state)
    page = context.new_page()
    page.goto(BASE_URL)
    page.wait_for_timeout(1000)

    page.get_by_text("New chat").click()
    page.get_by_role("radio", name="Web").click()
    page.wait_for_timeout(400)
    ask(page, WEB_QUESTION, screenshot="03-streaming.png")

    if show_citation(page, ".cite-ref.web"):
        page.screenshot(path=str(SCREENSHOTS_DIR / "04-citation.png"))
    page.mouse.move(5, 5)
    page.wait_for_timeout(800)

    # Light theme still, for the README.
    page.get_by_label("Switch to light theme").click()
    page.wait_for_timeout(700)
    page.screenshot(path=str(SCREENSHOTS_DIR / "05-light-theme.png"))
    page.wait_for_timeout(600)

    context.close()
    return page.video.path()


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch()

        pdf_path = generate_sample_pdf(browser)
        print(f"Sample PDF generated: {pdf_path}")

        docs_video, state = record_docs_segment(browser, pdf_path)
        docs_target = RAW_DIR / "docs.webm"
        pathlib.Path(docs_video).replace(docs_target)
        print(f"Docs segment saved: {docs_target}")

        web_video = record_web_segment(browser, state)
        web_target = RAW_DIR / "web.webm"
        pathlib.Path(web_video).replace(web_target)
        print(f"Web segment saved: {web_target}")

        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Recording failed: {exc}", file=sys.stderr)
        sys.exit(1)
