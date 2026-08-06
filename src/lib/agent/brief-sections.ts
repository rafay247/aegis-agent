import type { BriefSection, BriefSectionHeading } from "@/types";

export const REQUIRED_BRIEF_SECTIONS: BriefSectionHeading[] = [
  "Overview",
  "Key Findings",
  "Gaps & Limitations",
  "Conclusion"
];

function extractCitationIds(text: string): number[] {
  const ids = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    ids.add(Number(match[1]));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

// Splits the model's raw "## Heading" markdown brief into the four required
// sections. A heading not in REQUIRED_BRIEF_SECTIONS is dropped; a required
// section missing from the raw text comes back with empty content so
// completeness scoring can detect the gap instead of the parser crashing.
export function parseBriefSections(rawText: string): BriefSection[] {
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const matches = Array.from(rawText.matchAll(headingPattern));

  const found = new Map<string, string>();
  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1].trim();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? rawText.length : rawText.length;
    found.set(heading, rawText.slice(start, end).trim());
  }

  return REQUIRED_BRIEF_SECTIONS.map((heading) => {
    const content = found.get(heading) ?? "";
    return {
      heading,
      content,
      citationIds: extractCitationIds(content)
    };
  });
}
