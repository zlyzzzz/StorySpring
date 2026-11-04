import { complete } from "./deepseek.mjs";
import { storyInstructions, TARGET_WORDS } from "./prompts.mjs";
export function wordCountOfStory(text) {
  return (text.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g) || []).length;
}

export async function generateStory(input) {
  const brief = {
    name: input.name,
    answers: input.answers,
    free: input.free,
    questions: input.definitions,
    targetWords: TARGET_WORDS,
  };
  const system = storyInstructions;
  let story = await complete(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(brief) },
    ],
    { maxTokens: 8000 },
  );
  let count = wordCountOfStory(story);
  if (count < 1600 || count > 2400) {
    // One bounded revision enforces the requested range without endless paid calls.
    story = await complete(
      [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({
            brief,
            draft: story,
            instruction: `Revise the whole draft to 1600-2400 words. It currently has ${count} words.`,
          }),
        },
      ],
      { maxTokens: 8000 },
    );
    count = wordCountOfStory(story);
  }
  if (count < 1600 || count > 2400)
    throw new Error(
      `The story did not reach the requested length (${count} words). Retry generation.`,
    );
  return { story, wordCount: count, targetWords: TARGET_WORDS };
}
