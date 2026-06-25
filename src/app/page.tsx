"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { AgentStep, ChatResponse, ConversationSummary, ResearchSource } from "@/types";

const conversationsStorageKey = "aegis-conversations";
const maxPdfSources = 3;

type SavedConversation = ConversationSummary & {
  response?: ChatResponse;
};

function createSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function loadSavedConversations() {
  const saved = window.localStorage.getItem(conversationsStorageKey);
  if (!saved) {
    return [];
  }

  try {
    return (JSON.parse(saved) as SavedConversation[]).map((conversation) => ({
      sessionId: conversation.sessionId,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      response: conversation.response
    }));
  } catch {
    window.localStorage.removeItem(conversationsStorageKey);
    return [];
  }
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="send-icon">
      <path d="m5 12 14-7-4.4 14-3.1-5.6L5 12Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="composer-pill-icon">
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.6 9h16.8M3.6 15h16.8M12 3c2.2 2.3 3.4 5.3 3.4 9S14.2 18.7 12 21M12 3C9.8 5.3 8.6 8.3 8.6 12s1.2 6.7 3.4 9" />
    </svg>
  );
}

function AttachmentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="composer-action-icon">
      <path d="m8.5 12.4 5.9-5.9a3.1 3.1 0 0 1 4.4 4.4l-7.3 7.3a4.4 4.4 0 0 1-6.2-6.2l7.2-7.2" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sidebar-icon">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sidebar-icon">
      <path d="M5 6.5h14v10H8.5L5 20V6.5Z" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="sidebar-icon">
      <path d="M6 7h12M10 7V5h4v2M9 10v7M15 10v7M8 7l1 13h6l1-13" />
    </svg>
  );
}

function SearchStepIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="step-icon">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

function DocStepIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="step-icon">
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v4h4M10 12h6M10 16h6" />
    </svg>
  );
}

function CheckStepIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="step-icon">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

function AgentSteps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) {
    return null;
  }

  const toolSteps = steps.filter((step) => step.kind === "tool");
  if (toolSteps.length === 0) {
    return null;
  }

  return (
    <div className="agent-steps" aria-label="Agent steps">
      <div className="agent-steps-title">
        <CheckStepIcon />
        <span>
          Worked through {toolSteps.length} step{toolSteps.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul>
        {toolSteps.map((step) => (
          <li key={step.id}>
            {step.tool === "search_knowledge" ? <DocStepIcon /> : <SearchStepIcon />}
            <span className="agent-step-text">{step.summary}</span>
            {typeof step.resultCount === "number" ? (
              <span className="agent-step-count">
                {step.resultCount} result{step.resultCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="header-icon">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="header-icon">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}

function renderInlineContent(text: string) {
  // Split on links and **bold** so answers read naturally.
  const parts = text.split(/(https?:\/\/[^\s)]+|\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("http")) {
      return (
        <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`bold-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

function renderMessageContent(content: string) {
  const lines = content.split("\n");
  const blocks: Array<
    | { type: "heading"; text: string; key: string }
    | { type: "paragraph"; text: string; key: string }
    | { type: "list"; items: string[]; key: string }
  > = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }

    blocks.push({ type: "paragraph", text: paragraph.join("\n"), key: `paragraph-${blocks.length}` });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({ type: "list", items: listItems, key: `list-${blocks.length}` });
    listItems = [];
  }

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    const isBullet = /^[-*]\s+/.test(trimmedLine);
    const isNumberedList = /^\d+\.\s+/.test(trimmedLine);
    const isHeading = /^#{2,3}\s+\S/.test(trimmedLine);

    if (!trimmedLine) {
      flushParagraph();
      flushList();
      return;
    }

    if (isBullet || isNumberedList) {
      flushParagraph();
      listItems.push(trimmedLine.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      return;
    }

    flushList();

    if (isHeading) {
      flushParagraph();
      blocks.push({ type: "heading", text: trimmedLine.replace(/^#{2,3}\s+/, ""), key: `heading-${blocks.length}` });
      return;
    }

    paragraph.push(line);
  });

  flushParagraph();
  flushList();

  return blocks.map((block) => {
    if (block.type === "heading") {
      return <h3 key={block.key}>{block.text}</h3>;
    }

    if (block.type === "list") {
      return (
        <ul key={block.key} className="message-list">
          {block.items.map((item, index) => (
            <li key={`${item}-${index}`}>{renderInlineContent(item)}</li>
          ))}
        </ul>
      );
    }

    return <p key={block.key}>{renderInlineContent(block.text)}</p>;
  });
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<ResearchSource[]>([]);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourcePdfFiles, setSourcePdfFiles] = useState<File[]>([]);
  const [sourceStatus, setSourceStatus] = useState("");
  const [error, setError] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatResponse["messages"]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("aegis-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("aegis-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  useEffect(() => {
    const conversations = loadSavedConversations();
    setSavedConversations(conversations);
    void loadKnowledgeSources();
    void loadConversationHistory();

    const existing = window.localStorage.getItem("aegis-session-id");
    if (existing) {
      setSessionId(existing);
      const localConversation = conversations.find((conversation) => conversation.sessionId === existing);
      setResponse(localConversation?.response ?? null);
      void openConversationById(existing, localConversation?.response ?? null);
      return;
    }

    const created = createSessionId();
    window.localStorage.setItem("aegis-session-id", created);
    setSessionId(created);
  }, []);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [response?.messages.length, optimisticMessages.length, isLoading]);

  async function loadKnowledgeSources() {
    try {
      const apiResponse = await fetch("/api/sources");
      if (!apiResponse.ok) {
        return;
      }

      const data = (await apiResponse.json()) as { sources: ResearchSource[] };
      setKnowledgeSources(data.sources);
    } catch {
      // The source panel remains usable even if the first refresh fails.
    }
  }

  async function loadConversationHistory() {
    try {
      const apiResponse = await fetch("/api/conversations");
      if (!apiResponse.ok) {
        return;
      }

      const data = (await apiResponse.json()) as { conversations: SavedConversation[] };
      setSavedConversations(data.conversations);
      window.localStorage.setItem(conversationsStorageKey, JSON.stringify(data.conversations));
    } catch {
      // Local history stays visible if the server history endpoint is unavailable.
    }
  }

  const messages = response?.messages ?? [];
  const visibleMessages = optimisticMessages.length > 0 ? optimisticMessages : messages;
  const sources = response?.citations ?? [];
  const latestSteps = response?.run?.steps ?? [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt(prompt);
  }

  async function submitPrompt(message: string) {
    const trimmedMessage = message.trim();
    if (!sessionId || isLoading || !trimmedMessage) {
      return;
    }

    setIsLoading(true);
    setError("");
    const optimisticUserMessage = {
      id: `optimistic-${Date.now()}`,
      role: "user" as const,
      content: trimmedMessage,
      createdAt: new Date().toISOString()
    };
    setOptimisticMessages([...messages, optimisticUserMessage]);
    setPrompt("");

    try {
      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          message: trimmedMessage,
          useWebSearch
        })
      });

      if (!apiResponse.ok) {
        const body = (await apiResponse.json()) as { error?: string };
        throw new Error(body.error ?? "Aegis could not complete the request.");
      }

      const data = (await apiResponse.json()) as ChatResponse;
      setResponse(data);
      saveConversation(data, trimmedMessage);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while asking Aegis."
      );
    } finally {
      setOptimisticMessages([]);
      setIsLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }


  function handlePdfSelection(files: FileList | null) {
    if (!files) {
      setSourcePdfFiles([]);
      return;
    }

    const pdfFiles = Array.from(files).filter((file) => file.type === "application/pdf");
    const selectedFiles = pdfFiles.slice(0, maxPdfSources);

    setSourcePdfFiles(selectedFiles);

    if (pdfFiles.length > maxPdfSources) {
      setSourceStatus(`Only the first ${maxPdfSources} PDFs were selected.`);
      return;
    }

    if (selectedFiles.length > 0) {
      setSourceStatus(`${selectedFiles.length} PDF${selectedFiles.length === 1 ? "" : "s"} ready to add.`);
    }
  }

  async function handleSourceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceText.trim() && sourcePdfFiles.length === 0) {
      setSourceStatus("Paste document text or select up to 3 PDFs first.");
      return;
    }

    setIsSavingSource(true);
    setSourceStatus("");

    try {
      if (sourcePdfFiles.length > 0) {
        const pdfFormData = new FormData();
        sourcePdfFiles.forEach((file) => {
          pdfFormData.append("files", file);
        });

        const apiResponse = await fetch("/api/sources/pdf", {
          method: "POST",
          body: pdfFormData
        });

        if (!apiResponse.ok) {
          const body = (await apiResponse.json()) as { error?: string };
          throw new Error(body.error ?? "PDF sources could not be saved.");
        }

        const data = (await apiResponse.json()) as { sources: ResearchSource[] };
        setKnowledgeSources(data.sources);
        setSourcePdfFiles([]);
        setSourceStatus(`${sourcePdfFiles.length} PDF${sourcePdfFiles.length === 1 ? "" : "s"} added to RAG.`);
      } else {
        const apiResponse = await fetch("/api/sources", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: sourceTitle,
            text: sourceText
          })
        });

        if (!apiResponse.ok) {
          const body = (await apiResponse.json()) as { error?: string };
          throw new Error(body.error ?? "Source could not be saved.");
        }

        const data = (await apiResponse.json()) as { sources: ResearchSource[] };
        setKnowledgeSources(data.sources);
        setSourceTitle("");
        setSourceText("");
        setSourceStatus("Explicit content added to RAG.");
      }
    } catch (sourceError) {
      setSourceStatus(sourceError instanceof Error ? sourceError.message : "Source could not be saved.");
    } finally {
      setIsSavingSource(false);
    }
  }

  function saveConversation(data: ChatResponse, submittedPrompt: string) {
    const firstUserMessage =
      data.messages.find((message) => message.role === "user")?.content || submittedPrompt;
    const nextConversation: SavedConversation = {
      sessionId: data.sessionId,
      title: firstUserMessage.slice(0, 64),
      updatedAt: new Date().toISOString(),
      response: data
    };

    setSavedConversations((currentConversations) => {
      const nextConversations = [
        nextConversation,
        ...currentConversations.filter((conversation) => conversation.sessionId !== data.sessionId)
      ].slice(0, 24);

      window.localStorage.setItem(conversationsStorageKey, JSON.stringify(nextConversations));
      return nextConversations;
    });
  }

  function startNewChat() {
    const nextSessionId = createSessionId();
    window.localStorage.setItem("aegis-session-id", nextSessionId);
    setSessionId(nextSessionId);
    setResponse(null);
    setOptimisticMessages([]);
    setPrompt("");
    setError("");
  }

  async function openConversationById(nextSessionId: string, fallbackResponse: ChatResponse | null = null) {
    window.localStorage.setItem("aegis-session-id", nextSessionId);
    setSessionId(nextSessionId);
    setResponse(fallbackResponse);
    setOptimisticMessages([]);
    setPrompt("");
    setError("");

    try {
      const apiResponse = await fetch(`/api/conversations/${encodeURIComponent(nextSessionId)}`);
      if (!apiResponse.ok) {
        return;
      }

      const data = (await apiResponse.json()) as ChatResponse;
      setResponse(data);
    } catch {
      // Keep the fallback response visible if the server cannot load this chat.
    }
  }

  function openConversation(conversation: SavedConversation) {
    void openConversationById(conversation.sessionId, conversation.response ?? null);
  }

  async function deleteConversation(conversation: SavedConversation) {
    setSavedConversations((currentConversations) => {
      const nextConversations = currentConversations.filter(
        (currentConversation) => currentConversation.sessionId !== conversation.sessionId
      );
      window.localStorage.setItem(conversationsStorageKey, JSON.stringify(nextConversations));
      return nextConversations;
    });

    if (conversation.sessionId === sessionId) {
      startNewChat();
    }

    try {
      await fetch(`/api/conversations/${encodeURIComponent(conversation.sessionId)}`, {
        method: "DELETE"
      });
    } catch {
      setError("Conversation removed locally, but the server delete did not finish.");
    }
  }

  return (
    <main className="app-frame">
      <aside className="history-sidebar" aria-label="Conversation history">
        <div className="history-brand">
          <span>Aegis</span>
        </div>

        <button type="button" className="new-chat-control" onClick={startNewChat}>
          <NewChatIcon />
          <span>New chat</span>
        </button>

        <div className="history-section-title">History</div>
        <div className="conversation-history-list">
          {savedConversations.length > 0 ? (
            savedConversations.map((conversation) => (
              <div
                key={conversation.sessionId}
                className={`conversation-history-row ${
                  conversation.sessionId === sessionId ? "active" : ""
                }`}
                title={conversation.title}
              >
                <button type="button" className="conversation-history-item" onClick={() => openConversation(conversation)}>
                  <HistoryIcon />
                  <span>{conversation.title}</span>
                </button>
                <button
                  type="button"
                  className="conversation-delete-control"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => void deleteConversation(conversation)}
                >
                  <DeleteIcon />
                </button>
              </div>
            ))
          ) : (
            <p className="history-empty-state">Your conversations will appear here after you send a message.</p>
          )}
        </div>
      </aside>

      {isSourceModalOpen ? (
        <div className="source-modal-backdrop" role="presentation">
          <section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
            <div className="source-modal-header">
              <div>
                <h2 id="source-modal-title">RAG sources</h2>
                <p>{knowledgeSources.length} source{knowledgeSources.length === 1 ? "" : "s"} available for retrieval</p>
              </div>
              <button type="button" className="source-modal-close" onClick={() => setIsSourceModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="source-modal-grid">
              <section className="source-modal-section">
                <h3>Explicit content</h3>
                <div className="rag-source-list modal-list" aria-label="Loaded RAG sources">
                  {knowledgeSources.length > 0 ? (
                    knowledgeSources.map((source) => (
                      <article key={source.id} className="rag-source-item" title={source.title}>
                        <div>
                          <h3>{source.title}</h3>
                          <span>{source.domain}</span>
                        </div>
                        <p>{source.snippet}</p>
                      </article>
                    ))
                  ) : (
                    <p className="rag-source-empty">No explicit RAG content loaded yet.</p>
                  )}
                </div>
              </section>

              <form className="source-ingest-form modal-form" onSubmit={handleSourceSubmit}>
                <h3>Add or update content</h3>
                <input
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder="Source title"
                  aria-label="Source title"
                />
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="Paste source text for RAG search..."
                  aria-label="Explicit content for RAG search"
                  rows={10}
                />
                <label className="pdf-source-picker">
                  <span>PDF sources</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={(event) => handlePdfSelection(event.target.files)}
                    aria-label={`Upload up to ${maxPdfSources} PDF sources`}
                  />
                  <small>Upload up to {maxPdfSources} PDFs. Text will be extracted into RAG sources.</small>
                </label>
                {sourcePdfFiles.length > 0 ? (
                  <div className="pdf-source-list" aria-label="Selected PDF sources">
                    {sourcePdfFiles.map((file) => (
                      <span key={`${file.name}-${file.size}`}>{file.name}</span>
                    ))}
                  </div>
                ) : null}
                <button type="submit" disabled={isSavingSource || (!sourceText.trim() && sourcePdfFiles.length === 0)}>
                  {isSavingSource ? "Adding..." : "Add to RAG"}
                </button>
                <p className="source-ingest-status">
                  {sourceStatus || "Paste text or attach PDFs to update RAG."}
                </p>
              </form>
            </div>
          </section>
        </div>
      ) : null}

      <div className="aegis-workspace">
        <header className="top-header">
          <div className="top-header-title">
            Aegis
            <span className="top-header-tag">Research</span>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
        </header>
        <section className="chat-console" aria-label="Conversational agent">
          <div className="conversation-scroll">
            {visibleMessages.length === 0 ? (
              <div className="chat-empty-state">
                <h3>Meet Aegis</h3>
                <p>
                  A research agent that finds fresh information, reads your own sources, remembers the
                  conversation, and writes grounded answers with citations.
                </p>
                <div className="capability-grid" aria-label="What Aegis can do">
                  <div className="capability-card">
                    <h4>Live web research</h4>
                    <p>Turn on Smart Search and Aegis searches the web, then synthesizes an answer with linked sources.</p>
                  </div>
                  <div className="capability-card">
                    <h4>Your own sources</h4>
                    <p>Attach text or PDFs and Aegis answers from your documents using retrieval (RAG).</p>
                  </div>
                  <div className="capability-card">
                    <h4>Conversation memory</h4>
                    <p>Aegis keeps recent context so you can ask natural follow-up questions.</p>
                  </div>
                  <div className="capability-card">
                    <h4>Cited synthesis</h4>
                    <p>Answers come back as clear prose with inline [1] citations — not a list of links.</p>
                  </div>
                </div>
              </div>
            ) : (
              visibleMessages.map((message, messageIndex) => {
                const isLastAssistant =
                  message.role === "assistant" && messageIndex === visibleMessages.length - 1;

                return (
                  <article
                    key={message.id}
                    className={`chat-message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}
                  >
                    <div className="message-body">
                      {isLastAssistant && optimisticMessages.length === 0 ? (
                        <AgentSteps steps={latestSteps} />
                      ) : null}
                      <div className="message-content">{renderMessageContent(message.content)}</div>
                      {isLastAssistant && sources.length > 0 ? (
                        <div className="source-strip" aria-label="Sources">
                          {sources.slice(0, 6).map((source, index) =>
                            source.url.startsWith("http") ? (
                              <a
                                key={source.id}
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="source-chip"
                                title={source.title}
                              >
                                <span className="source-chip-index">{index + 1}</span>
                                {source.domain}
                              </a>
                            ) : (
                              <span key={source.id} className="source-chip" title={source.title}>
                                <span className="source-chip-index">{index + 1}</span>
                                {source.domain}
                              </span>
                            )
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })
            )}

            {isLoading ? (
              <article className="chat-message assistant-message">
                <div className="message-body">
                  <div className="agent-thinking" aria-label="Aegis is researching">
                    <div className="typing-bar">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="agent-thinking-label">
                      {useWebSearch ? "Researching the web…" : "Thinking…"}
                    </span>
                  </div>
                </div>
              </article>
            ) : null}
            <div ref={conversationEndRef} />
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <form onSubmit={handleSubmit} className="compact-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder="Message Aegis"
            />
            <div className="composer-actions-row">
              <div className="composer-mode-pills">
                <button
                  type="button"
                  className={`composer-mode-pill ${useWebSearch ? "active" : ""}`}
                  aria-pressed={useWebSearch}
                  onClick={() => setUseWebSearch((current) => !current)}
                >
                  <GlobeIcon />
                  <span>Smart Search</span>
                </button>
              </div>
              <div className="composer-actions">
                <button
                  type="button"
                  className="composer-icon-button"
                  aria-label="Attach sources"
                  onClick={() => setIsSourceModalOpen(true)}
                >
                  <AttachmentIcon />
                </button>
                <button type="submit" className="composer-send-button" disabled={isLoading || !prompt.trim()} aria-label="Send message">
                  <SendIcon />
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
