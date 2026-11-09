import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "./docx.mjs";
import {
  modificationInfo,
  modifiedAnswerCount,
  changedSegments,
} from "./answer-edits.js";

function paragraph(text, options = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text) })],
    spacing: { after: 160, line: 290 },
    ...options,
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return paragraph(text, { heading: level, keepNext: true });
}

export async function downloadWord(record, questions, kind) {
  const content = [];
  const freeMode = record.mode === "free";
  const combined = freeMode && kind === "prompt-and-story";
  if (combined) {
    content.push(heading(record.title || "My story", HeadingLevel.TITLE));
    content.push(heading("Original Free Writing prompt"));
    content.push(paragraph(record.free || "No prompt saved."));
    content.push(heading("Story"));
  }
  if (kind === "story" || combined) {
    const blocks = record.story
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean);
    content.push(heading(blocks.shift() || record.title, HeadingLevel.TITLE));
    if (record.sample)
      content.push(
        paragraph("Sample story for the StorySpring interface preview."),
      );
    for (const block of blocks) content.push(paragraph(block));
  } else {
    content.push(
      heading(
        `${record.title || "My story"} — ${freeMode ? "Free Writing prompt" : "Questions and choices"}`,
        HeadingLevel.TITLE,
      ),
    );
    content.push(
      paragraph(
        `Writing mode: ${record.mode === "free" ? "Free writing" : "Guided choices"}`,
      ),
    );
    if (record.name) content.push(paragraph(`Main character: ${record.name}`));
    if (record.mode === "free") {
      content.push(heading("Your original Free Writing prompt"));
      content.push(paragraph(record.free || "No instructions entered."));
    } else {
      content.push(
        paragraph(
          `Modified or self-written answers: ${modifiedAnswerCount(record)}`,
        ),
      );
      content.push(
        paragraph(
          "Yellow highlights show your changed wording. Entirely self-written answers are highlighted in full. Original wording is included when available.",
        ),
      );
      let index = 0;
      for (const [id, answer] of Object.entries(record.answers || {})) {
        const question = questions.find((item) => item.id === id);
        const snapshot = record.optionSnapshots?.[id];
        const modification = modificationInfo(record, id);
        content.push(
          heading(
            `${++index}. ${snapshot?.question || question?.question || id}${modification.modified ? ` [${modification.label}]` : ""}`,
            HeadingLevel.HEADING_2,
          ),
        );
        content.push(
          paragraph(`Your final answer: ${answer}`, {
            children: [
              new TextRun({ text: "Your final answer: ", bold: true }),
              ...(modification.modified
                ? changedSegments(modification.original, answer)
                : [{ text: answer, changed: false }]
              ).map(
                (segment) =>
                  new TextRun({
                    text: segment.text,
                    bold: true,
                    ...(segment.changed ? { highlight: "yellow" } : {}),
                  }),
              ),
            ],
          }),
        );
