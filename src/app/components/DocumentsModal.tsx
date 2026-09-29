"use client";

import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import type { ResearchSource } from "@/types";

const maxPdfFiles = 3;
// Vercel rejects request bodies over 4.5 MB; stay under it with room for the form encoding.
const maxUploadBytes = 4 * 1024 * 1024;

type Tab = "pdf" | "text";
type Status = { kind: "idle" | "working" | "success" | "error"; message: string };

type DocumentsModalProps = {
  sources: ResearchSource[];
  onSourcesChange: (sources: ResearchSource[]) => void;
  onClose: () => void;
};

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="documents-icon">
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4M10 12h6M10 16h6" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="documents-icon">
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="documents-icon">
      <path d="M5 6h14M5 10h14M5 14h9M5 18h6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="documents-icon">
      <path d="M6 7h12M10 7V5h4v2M9 10v7M15 10v7M8 7l1 13h6l1-13" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="documents-icon">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

async function readJson(response: Response) {
  return (await response.json().catch(() => ({}))) as { sources?: ResearchSource[]; added?: ResearchSource[]; source?: ResearchSource; error?: string };
}

function describeFailure(error: unknown, fallback: string) {
  // fetch() rejects with a TypeError only when no response arrived at all.
  if (error instanceof TypeError) {
    return "Couldn't reach Aegis. Check your connection and try again.";
  }

  return error instanceof Error ? error.message : fallback;
}

export function DocumentsModal({ sources, onSourcesChange, onClose }: DocumentsModalProps) {
  const [tab, setTab] = useState<Tab>("pdf");
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [isDragging, setIsDragging] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const isWorking = status.kind === "working";
  const totalBytes = files.reduce((total, file) => total + file.size, 0);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming) {
      return;
    }

    const list = Array.from(incoming);
    const pdfs = list.filter(isPdf);
    const merged = [...files];
    for (const file of pdfs) {
      if (!merged.some((existing) => existing.name === file.name && existing.size === file.size)) {
        merged.push(file);
      }
    }

    const notes: string[] = [];
    if (pdfs.length < list.length) {
      notes.push("Only PDF files can be uploaded here — use Paste text for anything else.");
    }

    if (merged.length > maxPdfFiles) {
      notes.push(`You can add up to ${maxPdfFiles} PDFs at a time.`);
    }

    setFiles(merged.slice(0, maxPdfFiles));
    setStatus(notes.length > 0 ? { kind: "error", message: notes.join(" ") } : { kind: "idle", message: "" });
  }

  function removeFile(target: File) {
    setFiles((current) => current.filter((file) => file !== target));
    setStatus({ kind: "idle", message: "" });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function markAdded(added: ResearchSource[]) {
    setRecentIds(added.map((source) => source.id));
  }

  async function uploadPdfs() {
    if (files.length === 0) {
      setStatus({ kind: "error", message: "Choose at least one PDF first." });
      return;
    }

    if (totalBytes > maxUploadBytes) {
      setStatus({
        kind: "error",
        message: `These files add up to ${formatBytes(totalBytes)}. Keep uploads under 4 MB — try one PDF at a time.`
      });
      return;
    }

    setStatus({
      kind: "working",
      message: `Reading ${files.length === 1 ? files[0].name : `${files.length} PDFs`}… this can take a few seconds.`
    });

    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await apiFetch("/api/sources/pdf", { method: "POST", body: formData });
      const body = await readJson(response);

      if (body.sources) {
        onSourcesChange(body.sources);
      }

      if (!response.ok) {
        throw new Error(
          response.status === 413
            ? "That upload is too large. Keep PDFs under 4 MB in total."
            : (body.error ?? "Those PDFs couldn't be added. Please try again.")
        );
      }

      markAdded(body.added ?? []);
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      const count = body.added?.length ?? files.length;
      setStatus({ kind: "success", message: `Added ${count} PDF${count === 1 ? "" : "s"} to your library.` });
    } catch (error) {
      setStatus({ kind: "error", message: describeFailure(error, "Those PDFs couldn't be added. Please try again.") });
    }
  }

  async function saveText() {
    if (!text.trim()) {
      setStatus({ kind: "error", message: "Paste some text first." });
      return;
    }

    setStatus({ kind: "working", message: "Saving your document…" });

    try {
      const response = await apiFetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text })
      });
      const body = await readJson(response);

      if (!response.ok) {
        throw new Error(body.error ?? "The document couldn't be saved. Please try again.");
      }

      if (body.sources) {
        onSourcesChange(body.sources);
      }

      markAdded(body.source ? [body.source] : []);
      setTitle("");
      setText("");
      setStatus({ kind: "success", message: `Added "${body.source?.title ?? "your document"}" to your library.` });
    } catch (error) {
      setStatus({ kind: "error", message: describeFailure(error, "The document couldn't be saved. Please try again.") });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void (tab === "pdf" ? uploadPdfs() : saveText());
  }

  async function removeSource(source: ResearchSource) {
    if (!window.confirm(`Remove "${source.title}" from your documents? This can't be undone.`)) {
      return;
    }

    setRemovingId(source.id);
    try {
      const response = await apiFetch(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
      const body = await readJson(response);
      if (!response.ok) {
        throw new Error(body.error ?? "The document couldn't be removed.");
      }

      onSourcesChange(body.sources ?? sources.filter((current) => current.id !== source.id));
      setStatus({ kind: "success", message: `Removed "${source.title}".` });
    } catch (error) {
      setStatus({ kind: "error", message: describeFailure(error, "The document couldn't be removed.") });
    } finally {
      setRemovingId("");
    }
  }

  const canSubmit = !isWorking && (tab === "pdf" ? files.length > 0 : text.trim().length > 0);

  return (
    <div
      className="documents-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="documents-modal" role="dialog" aria-modal="true" aria-labelledby="documents-title">
        <header className="documents-header">
          <div>
            <h2 id="documents-title">My documents</h2>
            <p>Aegis answers from these in &ldquo;My documents&rdquo; mode — never mixed with web results.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="documents-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="documents-body">
          <section className="documents-library" aria-labelledby="documents-library-title">
            <div className="documents-section-title">
              <h3 id="documents-library-title">Library</h3>
              <span className="documents-count">{sources.length}</span>
            </div>

            {sources.length > 0 ? (
              <ul className="rag-source-list documents-list">
                {sources.map((source) => (
                  <li
                    key={source.id}
                    className={`documents-item ${recentIds.includes(source.id) ? "is-new" : ""} ${
                      removingId === source.id ? "is-removing" : ""
                    }`}
                  >
                    <span className="documents-item-icon">
                      <DocumentIcon />
                    </span>
                    <div className="documents-item-text">
                      <h4 title={source.title}>{source.title}</h4>
                      <p>{source.snippet}</p>
                    </div>
                    <button
                      type="button"
                      className="documents-item-remove"
                      aria-label={`Remove ${source.title}`}
                      title="Remove"
                      disabled={removingId === source.id}
                      onClick={() => void removeSource(source)}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="documents-empty">
                <DocumentIcon />
                <p>No documents yet</p>
                <span>Upload a PDF or paste text, then ask about it in My documents mode.</span>
              </div>
            )}
          </section>

          <form className="documents-add" onSubmit={handleSubmit}>
            <div className="documents-section-title">
              <h3>Add a document</h3>
            </div>

            <div className="documents-tabs" role="tablist" aria-label="How to add a document">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "pdf"}
                className={tab === "pdf" ? "active" : ""}
                onClick={() => {
                  setTab("pdf");
                  setStatus({ kind: "idle", message: "" });
                }}
              >
                <UploadIcon />
                Upload PDF
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "text"}
                className={tab === "text" ? "active" : ""}
                onClick={() => {
                  setTab("text");
                  setStatus({ kind: "idle", message: "" });
                }}
              >
                <TextIcon />
                Paste text
              </button>
            </div>

            {tab === "pdf" ? (
              <div className="documents-panel" role="tabpanel">
                <div
                  className={`documents-dropzone ${isDragging ? "is-dragging" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <UploadIcon />
                  <strong>Drop PDFs here or click to browse</strong>
                  <span>Up to {maxPdfFiles} files · 4 MB total · named after the file</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </div>

                {files.length > 0 ? (
                  <ul className="documents-files">
                    {files.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        <DocumentIcon />
                        <span className="documents-file-name" title={file.name}>
                          {file.name}
                        </span>
                        <span className="documents-file-size">{formatBytes(file.size)}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name} from the upload`}
                          disabled={isWorking}
                          onClick={() => removeFile(file)}
                        >
                          <CloseIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="documents-panel" role="tabpanel">
                <input
                  className="documents-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Title (optional)"
                  aria-label="Document title"
                />
                <textarea
                  className="documents-input"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Paste notes, an article, meeting minutes…"
                  aria-label="Document text"
                  rows={9}
                />
                <span className="documents-hint">{text.trim().length.toLocaleString()} characters</span>
              </div>
            )}

            <button type="submit" className="documents-submit" disabled={!canSubmit}>
              {isWorking ? <span className="documents-spinner" aria-hidden="true" /> : null}
              {isWorking
                ? tab === "pdf"
                  ? "Adding PDFs…"
                  : "Saving…"
                : tab === "pdf"
                  ? files.length > 1
                    ? `Add ${files.length} PDFs`
                    : "Add PDF"
                  : "Add document"}
            </button>

            <p className={`documents-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.message}
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
