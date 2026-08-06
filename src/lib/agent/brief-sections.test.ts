import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBriefSections, REQUIRED_BRIEF_SECTIONS } from "./brief-sections";

test("parses all four required sections with their content and citation ids", () => {
  const raw = [
    "## Overview",
    "This is the overview [1].",
    "## Key Findings",
    "Finding one [1]. Finding two [2].",
    "## Gaps & Limitations",
    "No major gaps found.",
    "## Conclusion",
    "In summary [2]."
  ].join("\n\n");

  const sections = parseBriefSections(raw);

  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map((s) => s.heading), REQUIRED_BRIEF_SECTIONS);
  assert.equal(sections[0].content, "This is the overview [1].");
  assert.deepEqual(sections[0].citationIds, [1]);
  assert.deepEqual(sections[1].citationIds, [1, 2]);
  assert.equal(sections[3].content, "In summary [2].");
});

test("returns empty content and no citation ids for a required section missing from the raw text", () => {
  const raw = "## Overview\n\nJust an overview, no other sections.";
  const sections = parseBriefSections(raw);
  const gaps = sections.find((s) => s.heading === "Gaps & Limitations");
  assert.equal(gaps?.content, "");
  assert.deepEqual(gaps?.citationIds, []);
});

test("ignores headings that are not in the required set", () => {
  const raw = "## Random Aside\n\nIrrelevant text.\n\n## Overview\n\nReal content [3].";
  const sections = parseBriefSections(raw);
  const overview = sections.find((s) => s.heading === "Overview");
  assert.equal(overview?.content, "Real content [3].");
});
