"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ChatResponse, ResearchSource } from "@/types";

const starterPrompts = [
  "Summarize recent advancements in transformer models for medical imaging",
  "Map the key research streams in agent memory systems",
  "Compare RAG evaluation methods for enterprise assistants"
];

const topicNodes = [
  { label: "Deep Learning", x: 50, y: 18, size: 5 },
  { label: "Neural Architectures", x: 18, y: 36, size: 4 },
  { label: "Explainable AI", x: 77, y: 39, size: 5 },
  { label: "NLP", x: 34, y: 54, size: 4 },
  { label: "Medical Imaging", x: 62, y: 52, size: 4 },
  { label: "Optimization", x: 25, y: 78, size: 4 },
  { label: "Language Processing", x: 53, y: 85, size: 5 },
  { label: "Data Fusion", x: 75, y: 75, size: 4 },
  { label: "Trust Signals", x: 12, y: 69, size: 4 },
  { label: "Attention", x: 88, y: 62, size: 5 }
];

const topicEdges = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [0, 6],
  [0, 7],
  [0, 8],
  [0, 9],
  [1, 3],
  [1, 5],
  [1, 8],
  [2, 4],
  [2, 7],
  [2, 9],
  [3, 6],
  [3, 8],
  [4, 6],
  [4, 7],
  [5, 6],
  [6, 7],
  [7, 9]
];

const streamLabels = ["Deep Learning", "Neural Architectures", "NLP", "Explainable AI", "Attention"];

function createSessionId() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

function PanelMenu() {
  return (
    <span className="panel-menu" aria-hidden="true">
      ...
    </span>
  );
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="line-icon">
      <path d="M5 6.5h14v9H8.5L5 19V6.5Z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="send-icon">
      <path d="m5 12 14-7-4.4 14-3.1-5.6L5 12Z" />
    </svg>
  );
}

function SourceActions() {
  return (
    <div className="source-actions" aria-hidden="true">
      <span>PDF</span>
      <span>DL</span>
      <span>LINK</span>
    </div>
  );
}

function fallbackSources(): ResearchSource[] {
  return [
    {
      id: "fallback-1",
      title: "Attention Is All You Need",
      url: "https://arxiv.org/abs/1706.03762",
      domain: "arxiv.org",
      snippet: "Foundational transformer architecture and attention mechanism reference.",
      kind: "web"
    },
    {
      id: "fallback-2",
      title: "Medical Image Analysis using Convolutional Neural Networks",
      url: "https://www.sciencedirect.com/journal/medical-image-analysis",
      domain: "Medical Image Analysis",
      snippet: "Representative journal stream for clinical imaging and neural network methods.",
      kind: "knowledge"
    },
    {
      id: "fallback-3",
      title: "Medical Image Analysis using Convolutional Neural Networks with Transformers",
      url: "https://arxiv.org/",
      domain: "arxiv.org",
      snippet: "Hybrid CNN-transformer directions for segmentation, diagnosis, and multimodal fusion.",
      kind: "web"
    },
    {
      id: "fallback-4",
      title: "Vision Transformers for Medical Image Computing",
      url: "https://arxiv.org/",
      domain: "arxiv.org",
      snippet: "Recent survey themes across attention, inductive bias, and clinical imaging workflows.",
      kind: "web"
    }
  ];
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const existing = window.localStorage.getItem("aegis-session-id");
    if (existing) {
      setSessionId(existing);
      return;
    }

    const created = createSessionId();
    window.localStorage.setItem("aegis-session-id", created);
    setSessionId(created);
  }, []);

  const messages = response?.messages ?? [];
  const sources = response?.citations.length ? response.citations : fallbackSources();
  const modelLoad = response?.plan.requestedTools.length ? "72%" : "58%";
  const activePrompt = prompt || messages.findLast((message) => message.role === "user")?.content || starterPrompts[0];

  const statusTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(new Date()),
    []
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionId || !prompt.trim()) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          message: prompt
        })
      });

      if (!apiResponse.ok) {
        const body = (await apiResponse.json()) as { error?: string };
        throw new Error(body.error ?? "Aegis could not complete the request.");
      }

      const data = (await apiResponse.json()) as ChatResponse;
      setResponse(data);
      setPrompt("");
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while asking Aegis."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="aegis-workspace">
      <header className="system-bar">
        <div className="brand-lockup">
          <span className="brand-glyph">A</span>
          <span>AEGIS <strong>AGENT</strong></span>
        </div>
        <div className="system-status">
          <span>{statusTime}</span>
          <span className="wifi-icon" aria-hidden="true">)))</span>
          <span className="sync-icon" aria-hidden="true">+</span>
          <span className="agent-dot">A</span>
          <span className="cpu-chip">CPU 34%<br />RAM {modelLoad}</span>
        </div>
      </header>

      <section className="mission-grid">
        <aside className="insights-column" aria-label="Research visualization">
          <section className="glass-panel semantic-panel">
            <div className="panel-header">
              <h2>Semantic Data Visualization</h2>
              <PanelMenu />
            </div>
            <div className="panel-subhead">
              <div>
                <h3>Topic Evolution &amp; Connections</h3>
                <p>Real-time updates within research themes</p>
              </div>
              <span className="live-pill">Real-time</span>
            </div>

            <div className="network-stage">
              <svg viewBox="0 0 100 100" role="img" aria-label="Semantic topic network">
                <defs>
                  <radialGradient id="nodeGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#7dffe2" stopOpacity="1" />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.55" />
                  </radialGradient>
                </defs>
                {topicEdges.map(([from, to]) => (
                  <line
                    key={`${from}-${to}`}
                    x1={topicNodes[from].x}
                    y1={topicNodes[from].y}
                    x2={topicNodes[to].x}
                    y2={topicNodes[to].y}
                  />
                ))}
                {topicNodes.map((node) => (
                  <g key={node.label}>
                    <circle cx={node.x} cy={node.y} r={node.size} className="node-halo" />
                    <circle cx={node.x} cy={node.y} r={node.size / 2} className="topic-node" />
                  </g>
                ))}
              </svg>
              {topicNodes.slice(0, 8).map((node, index) => (
                <span
                  key={node.label}
                  className="node-label"
                  style={{ left: `${node.x}%`, top: `${node.y + (index % 2 === 0 ? -10 : 7)}%` }}
                >
                  {node.label}
                </span>
              ))}
            </div>

            <div className="carousel-dots" aria-hidden="true">
              <span />
              <span className="active" />
              <span />
              <span />
            </div>
          </section>

          <section className="glass-panel streams-panel">
            <div className="panel-header">
              <h2>Research Streams</h2>
              <PanelMenu />
            </div>
            <p className="muted-line">Conversation of ongoing analysis</p>
            <div className="stream-tabs">
              {streamLabels.map((label, index) => (
                <button key={label} type="button" className={index === 0 ? "active" : ""}>
                  {label}
                </button>
              ))}
            </div>
            <div className="stream-track">
              <span style={{ left: "18%" }} />
              <span style={{ left: "35%" }} />
              <span style={{ left: "63%" }} />
              <span style={{ left: "70%" }} />
            </div>
            <div className="stream-tags">
              <span>Conversational AI</span>
              <span>Explainable AI</span>
              <span>Attention</span>
            </div>
          </section>
        </aside>

        <section className="glass-panel chat-console" aria-label="Conversational agent">
          <div className="panel-header chat-heading">
            <h2>Conversational Agent</h2>
            <div className="heading-tools">
              <MessageIcon />
              <PanelMenu />
            </div>
          </div>

          <div className="conversation-scroll">
            {messages.length === 0 ? (
              <>
                <article className="chat-message user-message">
                  <p>{activePrompt}</p>
                </article>
                <article className="chat-message assistant-message">
                  <span className="assistant-badge">A</span>
                  <div>
                    <p>
                      AI Summarize recent advancements in transformer models for medical imaging,
                      with emphasis on compact architectures, multimodal reasoning, clinical
                      evaluation, and explainable decision support.
                    </p>
                    <p>
                      Transformer-based methods are increasingly combined with convolutional
                      backbones, anatomical priors, and retrieval pipelines to improve segmentation,
                      diagnosis, and report-grounded analysis.
                    </p>
                    <p>
                      Ask a focused question below and Aegis will route the request through the
                      available research tools, then return sources in the active citations panel.
                    </p>
                  </div>
                </article>
              </>
            ) : (
              messages.map((message) => (
                <article
                  key={message.id}
                  className={`chat-message ${message.role === "assistant" ? "assistant-message" : "user-message"}`}
                >
                  {message.role === "assistant" ? <span className="assistant-badge">A</span> : null}
                  <p>{message.content}</p>
                </article>
              ))
            )}

            {isLoading ? (
              <article className="chat-message assistant-message">
                <span className="assistant-badge">A</span>
                <div className="typing-bar">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            ) : null}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          <form onSubmit={handleSubmit} className="compact-composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={1}
              placeholder="Type a message..."
            />
            <button type="submit" disabled={isLoading || !prompt.trim()} aria-label="Send message">
              <SendIcon />
            </button>
          </form>
        </section>

        <aside className="glass-panel citations-column" aria-label="Active citations">
          <div className="panel-header">
            <h2>Active Citations</h2>
            <PanelMenu />
          </div>
          <div className="citation-list">
            {sources.slice(0, 5).map((source, index) => (
              <article key={source.id} className="citation-card">
                <div className="citation-index">{index + 1}.</div>
                <div className="citation-body">
                  <h3>{source.title}</h3>
                  <p>{source.snippet || `${source.kind} source from ${source.domain}`}</p>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.domain}
                  </a>
                  <SourceActions />
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
