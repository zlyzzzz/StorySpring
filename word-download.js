import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "./docx.mjs";

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
  if (kind === "story") {
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
        `${record.title || "My story"} — Questions and choices`,
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
      content.push(heading("Your writing instructions"));
      content.push(paragraph(record.free || "No instructions entered."));
    } else {
      let index = 0;
      for (const [id, answer] of Object.entries(record.answers || {})) {
        const question = questions.find((item) => item.id === id);
        const snapshot = record.optionSnapshots?.[id];
        content.push(
          heading(
            `${++index}. ${snapshot?.question || question?.question || id}`,
            HeadingLevel.HEADING_2,
          ),
        );
        content.push(
          paragraph(`Your final answer: ${answer}`, {
            children: [
              new TextRun({ text: `Your final answer: ${answer}`, bold: true }),
            ],
          }),
        );
        if (snapshot?.options?.length) {
          content.push(
            paragraph("Suggestions shown when this answer was saved:"),
          );
          snapshot.options.forEach((option, optionIndex) =>
            content.push(
              paragraph(`${String.fromCharCode(65 + optionIndex)}. ${option}`),
            ),
          );
        } else {
          content.push(
            paragraph(
              "The original suggestion batch was not recorded for this entry.",
            ),
          );
        }
      }
    }
  }

  const document = new Document({
    title:
      kind === "story" ? record.title : "StorySpring questions and choices",
    creator: "StorySpring",
    styles: {
      default: {
        document: { run: { font: "Arial", size: 22, color: "222222" } },
      },
    },
    sections: [{ children: content }],
  });
  const blob = await Packer.toBlob(document);
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  const name = (record.title || "StorySpring")
    .replace(/[<>:"/\\|?*]/g, "")
    .slice(0, 90);
  anchor.download = `${name}-${kind}.docx`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
