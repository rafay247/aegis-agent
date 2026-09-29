"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { BriefResponse, ChatResponse, ConversationSummary, ResearchRun, ResearchSource } from "@/types";
import { BriefPanel } from "@/app/components/BriefPanel";
import { groupConversationsByDate, runsByAssistantMessage } from "@/lib/history";

const conversationsStorageKey = "aegis-conversations";
const modeStorageKey = "aegis-search-mode";
const maxPdfSources = 3;

type SearchMode = "docs" | "web";

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

function runMode(run: ResearchRun): SearchMode | null {
  if (run.plan.mode) {
    return run.plan.mode;
  }

  const tools = (run.steps ?? []).map((step) => step.tool);
  if (tools.includes("web_search") || run.plan.useSearch) {
    return "web";
  }

  if (tools.includes("search_knowledge") || run.plan.useRag) {
    return "docs";
  }

  return null;
}

// Shows where an answer came from and, collapsed, the searches behind it.
function AnswerMeta({ run }: { run: ResearchRun }) {
  const mode = runMode(run);
  const toolSteps = (run.steps ?? []).filter((step) => step.kind === "tool");
  const resultTotal = toolSteps.reduce((total, step) => total + (step.resultCount ?? 0), 0);

  return (
    <details className="answer-meta">
      <summary>
        <span className={`answer-mode-badge ${mode ?? "none"}`}>
          {mode === "web" ? <GlobeIcon /> : mode === "docs" ? <DocStepIcon /> : <CheckStepIcon />}
          {mode === "web" ? "From the web" : mode === "docs" ? "From your documents" : "No search needed"}
        </span>
        <span className={`answer-meta-detail ${toolSteps.length > 0 ? "expandable" : ""}`}>
          {toolSteps.length > 0
            ? `${toolSteps.length} search${toolSteps.length === 1 ? "" : "es"} · ${resultTotal} result${resultTotal === 1 ? "" : "s"}`
            : "answered without a new search"}
        </span>
      </summary>
      {toolSteps.length > 0 ? (
        <ul className="answer-meta-steps">
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
      ) : null}
    </details>
  );
}

function SourceChips({ sources }: { sources: ResearchSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="source-strip" aria-label="Sources">
      {sources.slice(0, 8).map((source, index) => {
        const isDocument = source.kind === "knowledge";
        const content = (
          <>
            <span className="source-chip-index">{index + 1}</span>
            {isDocument ? <DocStepIcon /> : <GlobeIcon />}
            <span className="source-chip-label">{isDocument ? source.title : source.domain}</span>
          </>
        );

        return !isDocument && source.url.startsWith("http") ? (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="source-chip web"
            title={source.title}
          >
            {content}
          </a>
        ) : (
          <span key={source.id} className="source-chip document" title={source.title}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

function formatRelativeTime(isoDate: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(isoDate).getTime()) / 60000);
  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return new Date(isoDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const [notice, setNotice] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatResponse["messages"]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingSource, setIsSavingSource] = useState(false);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [mode, setMode] = useState<SearchMode>("web");
  const [briefMode, setBriefMode] = useState(false);
  const [briefResult, setBriefResult] = useState<BriefResponse | null>(null);
  const [isBriefLoading, setIsBriefLoading] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("aegis-theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    try {
      const storedMode = window.localStorage.getItem(modeStorageKey);
      if (storedMode === "docs" || storedMode === "web") {
        setMode(storedMode);
      }
    } catch {
      // Mode preference is a convenience; the default still works.
    }
  }, []);

  function chooseMode(nextMode: SearchMode) {
    setMode(nextMode);
    try {
      window.localStorage.setItem(modeStorageKey, nextMode);
    } catch {
      // Ignore storage failures (private windows, blocked storage).
    }
  }

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
  const runByMessage = useMemo(
    () => runsByAssistantMessage(response?.messages ?? [], response?.runs ?? (response?.run ? [response.run] : [])),
    [response]
  );
  const conversationGroups = useMemo(() => groupConversationsByDate(savedConversations), [savedConversations]);
  const needsDocuments = mode === "docs" && knowledgeSources.length === 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (briefMode) {
      await submitBrief(prompt);
    } else {
      await submitPrompt(prompt);
    }
  }

  async function submitPrompt(message: string) {
    const trimmedMessage = message.trim();
    if (!sessionId || isLoading || !trimmedMessage) {
      return;
    }

    setIsLoading(true);
    setError("");
    setNotice("");
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
          useWebSearch: mode === "web"
        })
      });

      if (!apiResponse.ok) {
        const body = (await apiResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Aegis could not complete the request.");
      }

      const data = (await apiResponse.json()) as ChatResponse;
      setResponse(data);
      saveConversation(data, trimmedMessage);
    } catch (submissionError) {
      // A dropped connection (e.g. ERR_NETWORK_CHANGED) can still leave the
      // answer saved on the server, so check before calling it a failure.
      const recovered = await recoverAnsweredTurn(sessionId, trimmedMessage);
      if (recovered) {
        setNotice("The connection dropped, but Aegis finished and saved your answer — it's shown above.");
      } else {
        setPrompt(trimmedMessage);
        setError(
          submissionError instanceof TypeError
            ? "Connection lost before Aegis could answer. Your question is back in the box — press Enter to retry."
            : submissionError instanceof Error
              ? submissionError.message
              : "Something went wrong while asking Aegis."
        );
      }
    } finally {
      setOptimisticMessages([]);
      setIsLoading(false);
    }
  }

  async function recoverAnsweredTurn(targetSessionId: string, question: string) {
    try {
      const apiResponse = await fetch(`/api/conversations/${encodeURIComponent(targetSessionId)}`);
      if (!apiResponse.ok) {
        return false;
      }

      const data = (await apiResponse.json()) as ChatResponse;
      const lastUserMessage = data.messages.filter((message) => message.role === "user").at(-1);
      if (lastUserMessage?.content !== question || data.messages.at(-1)?.role !== "assistant") {
        return false;
      }

      setResponse(data);
      saveConversation(data, question);
      return true;
    } catch {
      return false;
    }
  }

  async function submitBrief(topic: string) {
    const trimmedTopic = topic.trim();
    if (!sessionId || isBriefLoading || !trimmedTopic) {
      return;
    }

    setIsBriefLoading(true);
    setError("");
    setNotice("");
    setPrompt("");
    setBriefResult(null);

    try {
      const apiResponse = await fetch("/api/brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId, topic: trimmedTopic })
      });

      if (!apiResponse.ok) {
        const body = (await apiResponse.json()) as { error?: string };
        throw new Error(body.error ?? "Aegis could not generate the brief.");
      }

      const data = (await apiResponse.json()) as BriefResponse;
      setBriefResult(data);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while generating the brief."
      );
    } finally {
      setIsBriefLoading(false);
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
        setSourceStatus(`${sourcePdfFiles.length} PDF${sourcePdfFiles.length === 1 ? "" : "s"} added to your documents.`);
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
        setSourceStatus("Document added.");
      }
    } catch (sourceError) {
      setSourceStatus(sourceError instanceof Error ? sourceError.message : "Source could not be saved.");
    } finally {
      setIsSavingSource(false);
    }
  }

  async function removeKnowledgeSource(source: ResearchSource) {
    if (!window.confirm(`Remove "${source.title}" from your documents? This can't be undone.`)) {
      return;
    }

    try {
      const apiResponse = await fetch(`/api/sources/${encodeURIComponent(source.id)}`, { method: "DELETE" });
      const body = (await apiResponse.json().catch(() => ({}))) as { sources?: ResearchSource[]; error?: string };
      if (!apiResponse.ok) {
        throw new Error(body.error ?? "The document could not be removed.");
      }

      setKnowledgeSources(body.sources ?? knowledgeSources.filter((current) => current.id !== source.id));
      setSourceStatus(`Removed "${source.title}".`);
    } catch (removeError) {
      setSourceStatus(removeError instanceof Error ? removeError.message : "The document could not be removed.");
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
    setNotice("");
    setBriefResult(null);
  }

  async function openConversationById(nextSessionId: string, fallbackResponse: ChatResponse | null = null) {
    window.localStorage.setItem("aegis-session-id", nextSessionId);
    setSessionId(nextSessionId);
    setResponse(fallbackResponse);
    setOptimisticMessages([]);
    setPrompt("");
    setError("");
    setNotice("");
    setBriefResult(null);

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

        <div className="conversation-history-list">
          {conversationGroups.length > 0 ? (
            conversationGroups.map((group) => (
              <section key={group.label} className="history-group" aria-label={group.label}>
                <div className="history-section-title">{group.label}</div>
                {group.conversations.map((conversation) => (
                  <div
                    key={conversation.sessionId}
                    className={`conversation-history-row ${
                      conversation.sessionId === sessionId ? "active" : ""
                    }`}
                    title={conversation.title}
                  >
                    <button
                      type="button"
                      className="conversation-history-item"
                      onClick={() => openConversation(conversation)}
                      aria-current={conversation.sessionId === sessionId ? "page" : undefined}
                    >
                      <HistoryIcon />
                      <span className="conversation-history-text">
                        <span className="conversation-history-title">{conversation.title || "Untitled chat"}</span>
                        <span className="conversation-history-time">{formatRelativeTime(conversation.updatedAt)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="conversation-delete-control"
                      aria-label={`Delete ${conversation.title}`}
                      title="Delete chat"
                      onClick={() => void deleteConversation(conversation)}
                    >
                      <DeleteIcon />
                    </button>
                  </div>
                ))}
              </section>
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
                <h2 id="source-modal-title">My documents</h2>
                <p>
                  {knowledgeSources.length} document{knowledgeSources.length === 1 ? "" : "s"} · used when you ask in
                  &ldquo;My documents&rdquo; mode, never mixed with web results
                </p>
              </div>
              <button type="button" className="source-modal-close" onClick={() => setIsSourceModalOpen(false)}>
                Close
              </button>
            </div>

            <div className="source-modal-grid">
              <section className="source-modal-section">
                <h3>Your library</h3>
                <div className="rag-source-list modal-list" aria-label="Your documents">
                  {knowledgeSources.length > 0 ? (
                    knowledgeSources.map((source) => (
                      <article key={source.id} className="rag-source-item" title={source.title}>
                        <div className="rag-source-item-header">
                          <h3>{source.title}</h3>
                          <button
                            type="button"
                            className="rag-source-remove"
                            aria-label={`Remove ${source.title}`}
                            onClick={() => void removeKnowledgeSource(source)}
                          >
                            Remove
                          </button>
                        </div>
                        <p>{source.snippet}</p>
                      </article>
                    ))
                  ) : (
                    <p className="rag-source-empty">No documents yet. Paste text or upload a PDF to get started.</p>
                  )}
                </div>
              </section>

              <form className="source-ingest-form modal-form" onSubmit={handleSourceSubmit}>
                <h3>Add a document</h3>
                <input
                  value={sourceTitle}
                  onChange={(event) => setSourceTitle(event.target.value)}
                  placeholder="Source title"
                  aria-label="Source title"
                />
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder="Paste document text…"
                  aria-label="Document text"
                  rows={10}
                />
                <label className="pdf-source-picker">
                  <span>Or upload PDFs</span>
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    onChange={(event) => handlePdfSelection(event.target.files)}
                    aria-label={`Upload up to ${maxPdfSources} PDF sources`}
                  />
                  <small>Up to {maxPdfSources} PDFs at a time, under 4 MB total.</small>
                </label>
                {sourcePdfFiles.length > 0 ? (
                  <div className="pdf-source-list" aria-label="Selected PDF sources">
                    {sourcePdfFiles.map((file) => (
                      <span key={`${file.name}-${file.size}`}>{file.name}</span>
                    ))}
                  </div>
                ) : null}
                <button type="submit" disabled={isSavingSource || (!sourceText.trim() && sourcePdfFiles.length === 0)}>
                  {isSavingSource ? "Adding…" : "Add to my documents"}
                </button>
                <p className="source-ingest-status">
                  {sourceStatus || "Documents are split into passages and searched when you ask in My documents mode."}
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
                  A research agent that writes grounded answers with citations. Pick where it should look
                  using the switch under the message box — it never mixes the two.
                </p>
                <div className="capability-grid" aria-label="Where Aegis can look">
                  <button
                    type="button"
                    className={`capability-card mode-card ${mode === "web" ? "active" : ""}`}
                    onClick={() => chooseMode("web")}
                  >
                    <h4>
                      <GlobeIcon /> Web
                    </h4>
                    <p>Searches the live internet for current information and links every source.</p>
                  </button>
                  <button
                    type="button"
                    className={`capability-card mode-card ${mode === "docs" ? "active" : ""}`}
                    onClick={() => chooseMode("docs")}
                  >
                    <h4>
                      <DocStepIcon /> My documents
                    </h4>
                    <p>
                      Answers only from text and PDFs you add
                      {knowledgeSources.length > 0
                        ? ` (${knowledgeSources.length} added).`
                        : " — add some with the paperclip."}
                    </p>
                  </button>
                </div>
              </div>
            ) : (
              visibleMessages.map((message) => {
                const run = message.role === "assistant" ? runByMessage.get(message.id) : undefined;

                return (
                  <article
                    key={message.id}
                    className={`chat-message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}
                  >
                    <div className="message-body">
                      {run ? <AnswerMeta run={run} /> : null}
                      <div className="message-content">{renderMessageContent(message.content)}</div>
                      {run ? <SourceChips sources={run.citations} /> : null}
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
                      {mode === "web" ? "Searching the web…" : "Searching your documents…"}
                    </span>
                  </div>
                </div>
              </article>
            ) : null}
            <div ref={conversationEndRef} />
          </div>

          {briefResult ? (
            <div className="brief-panel-wrapper">
              <BriefPanel brief={briefResult.brief} />
            </div>
          ) : null}

          {isBriefLoading ? (
            <div className="agent-thinking brief-loading" aria-label="Generating brief">
              <div className="typing-bar">
                <span />
                <span />
                <span />
              </div>
              <span className="agent-thinking-label">Writing a brief from your documents…</span>
            </div>
          ) : null}

          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {notice ? <div className="notice-banner" role="status">{notice}</div> : null}

          <form onSubmit={handleSubmit} className="compact-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder={
                briefMode
                  ? "Brief topic (e.g. \"summarize the risk framework\")"
                  : mode === "web"
                    ? "Ask anything — Aegis will search the web"
                    : "Ask about your documents"
              }
            />
            {needsDocuments ? (
              <p className="composer-hint">
                You haven&rsquo;t added any documents yet.{" "}
                <button type="button" onClick={() => setIsSourceModalOpen(true)}>
                  Add documents
                </button>{" "}
                or{" "}
                <button type="button" onClick={() => chooseMode("web")}>
                  search the web
                </button>
                .
              </p>
            ) : null}
            <div className="composer-actions-row">
              <div className="composer-mode-pills">
                {briefMode ? (
                  <span className="mode-switch-static" title="Briefs are always written from your documents">
                    <DocStepIcon />
                    My documents
                  </span>
                ) : (
                  <div className="mode-switch" role="radiogroup" aria-label="Where to search">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === "web"}
                      className={mode === "web" ? "active" : ""}
                      onClick={() => chooseMode("web")}
                    >
                      <GlobeIcon />
                      <span>Web</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === "docs"}
                      className={mode === "docs" ? "active" : ""}
                      onClick={() => chooseMode("docs")}
                    >
                      <DocStepIcon />
                      <span>My documents</span>
                      <span className="mode-switch-count">{knowledgeSources.length}</span>
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={`composer-mode-pill ${briefMode ? "active" : ""}`}
                  aria-pressed={briefMode}
                  onClick={() => {
                    setBriefMode((current) => !current);
                    setBriefResult(null);
                  }}
                >
                  <DocStepIcon />
                  <span>Brief</span>
                </button>
              </div>
              <div className="composer-actions">
                <button
                  type="button"
                  className="composer-icon-button"
                  aria-label="Manage my documents"
                  title="Add or view my documents"
                  onClick={() => setIsSourceModalOpen(true)}
                >
                  <AttachmentIcon />
                </button>
                <button type="submit" className="composer-send-button" disabled={isLoading || isBriefLoading || !prompt.trim()} aria-label="Send message">
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
