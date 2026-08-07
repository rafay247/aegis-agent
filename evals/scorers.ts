import type { AgentStep, ResearchSource } from "../src/types";

export type CitationCheckInput = {
  text: string;
  citations: ResearchSource[];
};

// Every [n] reference in the text must resolve to a real, retrieved source.
export function scoreCitationValidity({ text, citations }: CitationCheckInput) {
  const used = Array.from(new Set(Array.from(text.matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1]))));

  if (used.length === 0) {
    return { name: "CitationValidity", score: 1 };
  }

  const validCount = used.filter((id) => id >= 1 && id <= citations.length).length;
  return { name: "CitationValidity", score: validCount / used.length };
}

export function scoreCompleteness(sections: Array<{ heading: string; content: string }>) {
  const requiredHeadings = ["Overview", "Key Findings", "Gaps & Limitations", "Conclusion"];
  const present = requiredHeadings.filter((heading) =>
    sections.some((section) => section.heading === heading && section.content.trim().length > 0)
  );

  return { name: "Completeness", score: present.length / requiredHeadings.length };
}

export function scoreSearchTrajectory(steps: AgentStep[], tags: string[]) {
  const queries = steps
    .filter((step) => step.kind === "tool")
    .map((step) => (step.input ?? "").trim().toLowerCase());
  const distinctQueries = new Set(queries);

  if (tags.includes("multi-hop")) {
    // Multi-hop questions should show real refinement: more than one search,
    // and not just the same query repeated.
    const score = queries.length >= 2 && distinctQueries.size >= 2 ? 1 : queries.length >= 2 ? 0.5 : 0;
    return { name: "SearchTrajectory", score };
  }

  if (tags.includes("not-in-doc")) {
    // Should not loop excessively trying to find something that isn't there.
    return { name: "SearchTrajectory", score: queries.length <= 3 ? 1 : 0.5 };
  }

  return { name: "SearchTrajectory", score: queries.length >= 1 ? 1 : 0 };
}
