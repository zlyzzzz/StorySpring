import { streamComplete } from "./streaming.mjs";
import { storyInstructions, TARGET_WORDS } from "./prompts.mjs";

export function wordCountOfStory(text) {
  return (text.match(/\b[A-Za-z]+(?:['’-][A-Za-z]+)*\b/g) || []).length;
}

export async function generateStory(
  input,
  { completeFn, streamFn = streamComplete, onProgress = () => {} } = {},
) {
  const requiredChoices = Object.entries(input.answers || {})
    .filter(([, value]) => value.trim())
    .map(([id, answer]) => ({
      id,
      answer,
      question: input.definitions?.find((q) => q.id === id)?.question || id,
    }));
  const brief = {
    name: input.name,
    answers: input.answers,
    free: input.free,
    questions: input.definitions,
    targetWords: TARGET_WORDS,
    requiredChoices,
  };
  async function write(messages, phase) {
    onProgress({ text: "", phase });
    // Injection supports deterministic offline tests without changing production streaming.
    if (completeFn) {
      const text = await completeFn(messages, { maxTokens: 8000 });
      onProgress({ text, phase });
      return text;
    }
    return streamFn(messages, {
      maxTokens: 8000,
      onText: (text) => onProgress({ text, phase }),
    });
  }
  let story = await write(
    [
      { role: "system", content: storyInstructions },
      { role: "user", content: JSON.stringify(brief) },
    ],
    "generating",
  );
  let count = wordCountOfStory(story);
  if (count < 1600 || count > 2400) {
    story = await write(
      [
        { role: "system", content: storyInstructions },
        {
          role: "user",
          content: JSON.stringify({
            brief,
            draft: story,
            instruction: `Revise the complete story to approximately 2000 words (1600-2400). Current length: ${count}. Preserve all confirmed choices. Output only title and story.`,
          }),
        },
      ],
      "revising",
    );
    count = wordCountOfStory(story);
  }
  if (count < 1600 || count > 2400)
    throw new Error(
      `The story did not reach the requested length (${count} words). Retry generation.`,
    );
  // Alignment is deliberately not called here: users request it from the reader.
  return { story, wordCount: count, targetWords: TARGET_WORDS };
}
