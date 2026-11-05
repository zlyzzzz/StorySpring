import { complete } from "./deepseek.mjs";
import { annotationInstructions } from "./prompts.mjs";

// Accept only exact passages from the immutable story and known answer IDs.
export function validateAnnotations(value, story, answers) {
  if (!Array.isArray(value?.matches))
    throw new Error("Invalid annotation response.");
  const matches = [];
  const seen = new Set();
  for (const item of value.matches) {
    if (
      !item ||
      !Object.hasOwn(answers, item.questionId) ||
      typeof item.quote !== "string" ||
      !item.quote.trim()
    )
      continue;
    const start = story.indexOf(item.quote);
    if (start < 0 || start <= story.indexOf("\n")) continue;
    const end = start + item.quote.length;
    const key = `${item.questionId}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      questionId: item.questionId,
      start,
      end,
      quote: item.quote,
    });
  }
  return matches;
}

export async function annotateStory(input) {
  if (
    typeof input.story !== "string" ||
    !input.story.trim() ||
    input.story.length > 100_000
  ) {
    throw new Error("A saved story is required for annotations.");
  }
  if (!Object.keys(input.answers).length) return { matches: [] };
  const matches = [];
  const entries = Object.entries(input.answers);
  // Bound each alignment request so long briefs do not silently truncate the mapping.
  for (let index = 0; index < entries.length; index += 20) {
    const answers = Object.fromEntries(entries.slice(index, index + 20));
    const raw = await complete(
      [
        { role: "system", content: annotationInstructions },
        {
          role: "user",
          content: JSON.stringify({
            story: input.story,
            answers,
            questions: input.definitions,
          }),
        },
      ],
      { json: true, maxTokens: 6500 },
    );
    matches.push(...validateAnnotations(JSON.parse(raw), input.story, answers));
  }
  return { matches };
}
