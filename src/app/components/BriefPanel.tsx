import type { AgentStep, ResearchBrief } from "@/types";

function downloadTrace(steps: AgentStep[], filename: string) {
  const blob = new Blob([JSON.stringify(steps, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BriefPanel({ brief }: { brief: ResearchBrief }) {
  return (
    <div className="brief-panel" aria-label="Structured brief">
      <div className="brief-panel-header">
        <h3>{brief.title}</h3>
        <button
          type="button"
          className="composer-icon-button brief-export-button"
          onClick={() => downloadTrace(brief.steps, `aegis-brief-trace-${Date.now()}.json`)}
        >
          Export trace
        </button>
      </div>
      {brief.sections.map((section) => (
        <section key={section.heading} className="brief-section">
          <h4>{section.heading}</h4>
          <p>{section.content || "—"}</p>
        </section>
      ))}
      {brief.citations.length > 0 ? (
        <div className="source-strip" aria-label="Sources">
          {brief.citations.map((source, index) => (
            <span key={source.id} className="source-chip" title={source.title}>
              <span className="source-chip-index">{index + 1}</span>
              {source.domain}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
