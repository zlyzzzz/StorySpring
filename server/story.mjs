import { complete } from "./deepseek.mjs";
import { storyInstructions, TARGET_WORDS } from "./prompts.mjs";
import { annotateStory } from "./annotations.mjs";
export function wordCountOfStory(text) {
  return (text.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g) || []).length;
}

export async function generateStory(
  input,
  { completeFn = complete, annotateFn = annotateStory } = {},
) {
  const requiredChoices = Object.entries(input.answers || {})
    .filter(([, value]) => value.trim())
    .map(([id, value]) => ({
      id,
      question: input.definitions?.find((q) => q.id === id)?.question || id,
      answer: value,
    }));
  const brief = {
    name: input.name,
    answers: input.answers,
    free: input.free,
    questions: input.definitions,
    targetWords: TARGET_WORDS,
    requiredChoices,
  };
  const system = storyInstructions;
  let story = await completeFn(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(brief) },
    ],
    { maxTokens: 8000 },
  );
  let count = wordCountOfStory(story);
  async function audit(text) {
    if (!requiredChoices.length) return { matches: [], available: true };
    try {
      return {
        ...(await annotateFn({ ...input, story: text })),
        available: true,
      };
    } catch {
      return { matches: [], available: false };
    }
  }
  let alignment = await audit(story);
  const missing = () =>
    requiredChoices.filter(
      (choice) =>
        !alignment.matches.some((match) => match.questionId === choice.id),
    );
  if (
    count < 1600 ||
    count > 2400 ||
    (alignment.available && missing().length)
  ) {
    // One bounded repair addresses omissions and length together; never loop paid calls endlessly.
    story = await completeFn(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            brief,
            draft: story,
            missingChoices: alignment.available ? missing() : [],
            instruction: `Revise the complete story to approximately 2000 words (1600-2400). Current length: ${count}. Integrate every missing choice meaningfully, while preserving all choices already reflected, the exact confirmed name and the desired ending. Output only title and story.`,
          }),
        },
      ],
      { maxTokens: 8000 },
    );
    count = wordCountOfStory(story);
    alignment = await audit(story);
  }
  if (count < 1600 || count > 2400)
    throw new Error(
      `The story did not reach the requested length (${count} words). Retry generation.`,
    );
  return {
    story,
    wordCount: count,
    targetWords: TARGET_WORDS,
    ...(alignment.available ? { annotations: alignment.matches } : {}),
    coverage: {
      status: alignment.available ? "checked" : "unavailable",
      total: requiredChoices.length,
      located: new Set(alignment.matches.map((match) => match.questionId)).size,
      unlocatedIds: alignment.available
        ? missing().map((choice) => choice.id)
        : [],
    },
  };
}
