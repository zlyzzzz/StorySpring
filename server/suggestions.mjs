import { complete } from "./deepseek.mjs";
import {
  repeatsOption,
  OPTION_BANK_SIZE,
  ADAPTIVE_BATCH_SIZE,
  ADAPTIVE_OPTION_LIMIT,
  CATEGORY_IDS,
  OPTION_MIN_WORDS,
  OPTION_MAX_WORDS,
  OPTION_MAX_CHARACTERS,
} from "../option-rules.js";
import { optionInstructions, PROMPT_VERSION } from "./prompts.mjs";

export function validateSuggestions(
  value,
  excludedTexts = [],
  expectedCount = OPTION_BANK_SIZE,
) {
  if (
    !Array.isArray(value?.options) ||
    value.options.length !== expectedCount
  ) {
    throw new Error(`Return exactly ${expectedCount} distinct options.`);
  }
  const seen = [...excludedTexts];
  return value.options.map((option) => {
    const text = typeof option?.text === "string" ? option.text.trim() : "";
    const words = text ? text.split(/\s+/).length : 0;
    if (
      words < OPTION_MIN_WORDS ||
      words > OPTION_MAX_WORDS ||
      text.length > OPTION_MAX_CHARACTERS ||
      /[<>\r\n]/.test(text)
    ) {
      throw new Error(
        `Every option needs ${OPTION_MIN_WORDS}-${OPTION_MAX_WORDS} words and at most ${OPTION_MAX_CHARACTERS} characters on one line, without markup.`,
      );
    }
    if (repeatsOption(text, seen)) {
      throw new Error(
        "Options repeat. Provide more varied creative directions.",
      );
    }
    seen.push(text);
    // Copy only validated fields, never arbitrary model-supplied properties.
    return { text };
  });
}

export async function generateSuggestions({
  question,
  answers,
  name = "",
  excludedTexts = [],
  generatedCount = 0,
}) {
  if (
    !question ||
    !CATEGORY_IDS.includes(question.category) ||
    typeof question.id !== "string" ||
    typeof question.question !== "string" ||
    !Array.isArray(excludedTexts) ||
    excludedTexts.some((text) => typeof text !== "string")
  ) {
    throw new Error("Invalid suggestion request.");
  }
  if (
    !Number.isSafeInteger(generatedCount) ||
    generatedCount < 0 ||
    generatedCount % ADAPTIVE_BATCH_SIZE !== 0 ||
    generatedCount + ADAPTIVE_BATCH_SIZE > ADAPTIVE_OPTION_LIMIT
  ) {
    throw new Error(
      "This question already has its maximum 45 suggestions, or the batch count is invalid.",
    );
  }
  let correction = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await complete(
        [
          { role: "system", content: optionInstructions },
          {
            role: "user",
            content: JSON.stringify({
              question,
              answers,
              name,
              excludedTexts,
              correction,
            }),
          },
        ],
        { json: true, maxTokens: 1800 },
      );
      const options = validateSuggestions(
        JSON.parse(raw),
        excludedTexts,
        ADAPTIVE_BATCH_SIZE,
      );
      return {
        questionId: question.id,
        batchSize: ADAPTIVE_BATCH_SIZE,
        totalPrepared: generatedCount + ADAPTIVE_BATCH_SIZE,
        maxOptions: ADAPTIVE_OPTION_LIMIT,
        pool: options.map((option, index) => ({
          ...option,
          id: `${question.id}_${Date.now()}_${index}`,
          origin: "ai_generated",
        })),
        generation: { provider: "deepseek", promptVersion: PROMPT_VERSION },
      };
    } catch (error) {
      correction = error.message;
      if (attempt === 2) throw error;
    }
  }
}
