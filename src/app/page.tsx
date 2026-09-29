"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStep, AgentStreamEvent, ChatResponse, ConversationSummary, ResearchRun, ResearchSource } from "@/types";
import { DocumentsModal } from "@/app/components/DocumentsModal";
import { apiFetch, createSessionId, ensureWorkspaceId, readEventStream } from "@/lib/client/api";
import { groupConversationsByDate, runsByAssistantMessage } from "@/lib/history";

const conversationsStorageKey = "aegis-conversations";
const modeStorageKey = "aegis-search-mode";

type SearchMode = "docs" | "web";

type SavedConversation = ConversationSummary & {
  response?: ChatResponse;
};

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

function excerpt(text: string, maxLength = 240) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength).replace(/\s+\S*$/, "")}…` : compact;
}

// An inline [n] reference with a preview card of the source it cites.
function Citation({ index, source }: { index: number; source?: ResearchSource }) {
  const cardRef = useRef<HTMLSpanElement | null>(null);
  const [shift, setShift] = useState(0);
  const [below, setBelow] = useState(false);

  if (!source) {
    return <>{`[${index}]`}</>;
  }

  const isDocument = source.kind === "knowledge";
  const isLink = !isDocument && source.url.startsWith("http");

  // Keep the card fully visible: shift it sideways near the edges, and open it
  // below the reference when there isn't room above inside the chat area.
  function position() {
    const card = cardRef.current;
    if (!card) {
      return;
    }

    card.style.setProperty("--cite-shift", "0px");
    const rect = card.getBoundingClientRect();
    const margin = 12;
    const anchor = card.parentElement?.getBoundingClientRect();
    const scrollArea = card.closest(".conversation-scroll")?.getBoundingClientRect();
    const spaceAbove = (anchor?.top ?? rect.top) - (scrollArea?.top ?? 0);
    setBelow(spaceAbove < rect.height + margin + 8);

    let next = 0;
    if (rect.right > window.innerWidth - margin) {
      next = window.innerWidth - margin - rect.right;
    } else if (rect.left < margin) {
      next = margin - rect.left;
    }

    setShift(next);
  }

  const card = (
    <span
      ref={cardRef}
      className={`cite-card ${below ? "below" : ""}`}
      role="tooltip"
      style={{ "--cite-shift": `${shift}px` } as React.CSSProperties}
    >
      <span className={`cite-card-meta ${isDocument ? "docs" : "web"}`}>
        {isDocument ? <DocStepIcon /> : <GlobeIcon />}
        {isDocument ? "Your document" : source.domain}
      </span>
      <strong className="cite-card-title">{source.title}</strong>
      <span className="cite-card-excerpt">{excerpt(source.content || source.snippet || "")}</span>
      {isLink ? <span className="cite-card-open">Open source ↗</span> : null}
    </span>
  );

  return (
    <span className="cite" onMouseEnter={position} onFocus={position}>
      {isLink ? (
        <a className={`cite-ref web`} href={source.url} target="_blank" rel="noreferrer" aria-label={`Source ${index}: ${source.title}`}>
          {index}
        </a>
      ) : (
        <button type="button" className={`cite-ref ${isDocument ? "docs" : "web"}`} aria-label={`Source ${index}: ${source.title}`}>
          {index}
        </button>
      )}
      {card}
    </span>
  );
}

function renderInlineContent(text: string, sources: ResearchSource[] = []) {
  // Split on links, **bold** and [n] citations so answers read naturally.
  const parts = text.split(/(https?:\/\/[^\s)]+|\*\*[^*]+\*\*|\[\d+\])/g);

  return parts.map((part, index) => {
    const citation = /^\[(\d+)\]$/.exec(part);
    if (citation) {
      const number = Number(citation[1]);
      return <Citation key={`cite-${index}`} index={number} source={sources[number - 1]} />;
    }

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

function renderMessageContent(content: string, sources: ResearchSource[] = []) {
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
            <li key={`${item}-${index}`}>{renderInlineContent(item, sources)}</li>
          ))}
        </ul>
      );
    }

    return <p key={block.key}>{renderInlineContent(block.text, sources)}</p>;
  });
}

type LiveTurn = {
  steps: Array<{ id: string; tool: "web_search" | "search_knowledge"; query: string; step?: AgentStep }>;
  text: string;
  sources: ResearchSource[];
};

// The assistant turn while it is still streaming: live search steps, then
// the answer text as it arrives.
function LiveAnswer({ live, mode }: { live: LiveTurn; mode: SearchMode }) {
  const waiting = live.text.length === 0;
  const running = live.steps.some((entry) => !entry.step);

  return (
    <div className="live-answer" aria-live="polite">
      {live.steps.length > 0 ? (
        <ul className="live-steps">
          {live.steps.map((entry) => (
            <li key={entry.id} className={entry.step ? "done" : "running"}>
              {entry.step ? <CheckStepIcon /> : <span className="live-spinner" aria-hidden="true" />}
              <span className="agent-step-text">
                {entry.tool === "web_search" ? "Searching the web for" : "Searching your documents for"} &ldquo;
                {entry.query}&rdquo;
              </span>
              {entry.step ? (
                <span className="agent-step-count">
                  {entry.step.resultCount ?? 0} result{entry.step.resultCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {waiting ? (
        <div className="agent-thinking" aria-label="Aegis is working">
          <div className="typing-bar">
            <span />
            <span />
            <span />
          </div>
          <span className="agent-thinking-label">
            {running
              ? "Reading results…"
              : live.steps.length > 0
                ? "Writing the answer…"
                : mode === "web"
                  ? "Planning a web search…"
                  : "Looking through your documents…"}
          </span>
        </div>
      ) : (
        <div className="message-content streaming">{renderMessageContent(live.text, live.sources)}</div>
      )}
    </div>
  );
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [savedConversations, setSavedConversations] = useState<SavedConversation[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<ResearchSource[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<ChatResponse["messages"]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const closeDocuments = useCallback(() => setIsSourceModalOpen(false), []);
  const [mode, setMode] = useState<SearchMode>("web");
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
    const { created: isNewWorkspace } = ensureWorkspaceId();
    void (async () => {
      // First visit since workspaces were introduced: bring this browser's
      // earlier conversations along before listing history.
      if (isNewWorkspace) {
        const ids = [
          ...conversations.map((conversation) => conversation.sessionId),
          window.localStorage.getItem("aegis-session-id") ?? ""
        ].filter(Boolean);
        if (ids.length > 0) {
          await apiFetch("/api/workspace/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionIds: ids })
          }).catch(() => undefined);
        }
      }

      await loadConversationHistory();
    })();
    void loadKnowledgeSources();

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
  }, [response?.messages.length, optimisticMessages.length, isLoading, live?.steps.length, live?.text.length]);

  async function loadKnowledgeSources() {
    try {
      const apiResponse = await apiFetch("/api/sources");
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
      const apiResponse = await apiFetch("/api/conversations");
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
    await submitPrompt(prompt);
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

    setLive({ steps: [], text: "", sources: [] });

    try {
      const apiResponse = await apiFetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson"
        },
        body: JSON.stringify({
          sessionId,
          message: trimmedMessage,
          useWebSearch: mode === "web"
        })
      });

      if (!apiResponse.ok || !apiResponse.body) {
        const body = (await apiResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Aegis could not complete the request.");
      }

      let finished: ChatResponse | null = null;
      let streamError = "";
      await readEventStream(apiResponse.body, (event: AgentStreamEvent) => {
        switch (event.type) {
          case "tool_start":
            setLive((current) =>
              current && { ...current, steps: [...current.steps, { id: event.id, tool: event.tool, query: event.query }] }
            );
            break;
          case "tool_end":
            setLive((current) =>
              current && {
                ...current,
                steps: current.steps.map((entry) => (entry.id === event.step.id ? { ...entry, step: event.step } : entry))
              }
            );
            break;
          case "sources":
            setLive((current) => current && { ...current, sources: event.sources });
            break;
          case "delta":
            setLive((current) => current && { ...current, text: current.text + event.text });
            break;
          case "reset":
            setLive((current) => current && { ...current, text: "" });
            break;
          case "done":
            finished = event.response;
            break;
          case "error":
            streamError = event.error;
            break;
        }
      });

      if (streamError) {
        throw new Error(streamError);
      }

      if (!finished) {
        // The stream ended early: treat it like a dropped connection.
        throw new TypeError("The answer stream ended unexpectedly.");
      }

      setResponse(finished);
      saveConversation(finished, trimmedMessage);
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
      setLive(null);
      setIsLoading(false);
    }
  }

  async function recoverAnsweredTurn(targetSessionId: string, question: string) {
    try {
      const apiResponse = await apiFetch(`/api/conversations/${encodeURIComponent(targetSessionId)}`);
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
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
  }

  async function openConversationById(nextSessionId: string, fallbackResponse: ChatResponse | null = null) {
    window.localStorage.setItem("aegis-session-id", nextSessionId);
    setSessionId(nextSessionId);
    setResponse(fallbackResponse);
    setOptimisticMessages([]);
    setPrompt("");
    setError("");
    setNotice("");

    try {
      const apiResponse = await apiFetch(`/api/conversations/${encodeURIComponent(nextSessionId)}`);
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
      await apiFetch(`/api/conversations/${encodeURIComponent(conversation.sessionId)}`, {
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
        <DocumentsModal sources={knowledgeSources} onSourcesChange={setKnowledgeSources} onClose={closeDocuments} />
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
                      <div className="message-content">{renderMessageContent(message.content, run?.citations)}</div>
                      {run ? <SourceChips sources={run.citations} /> : null}
                    </div>
                  </article>
                );
              })
            )}

            {isLoading && live ? (
              <article className="chat-message assistant-message">
                <div className="message-body">
                  <LiveAnswer live={live} mode={mode} />
                </div>
              </article>
            ) : null}
            <div ref={conversationEndRef} />
          </div>

          {error ? <div className="error-banner" role="alert">{error}</div> : null}
          {notice ? <div className="notice-banner" role="status">{notice}</div> : null}

          <form onSubmit={handleSubmit} className="compact-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder={mode === "web" ? "Ask anything — Aegis will search the web" : "Ask about your documents"}
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
