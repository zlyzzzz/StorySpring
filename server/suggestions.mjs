import { complete } from "./deepseek.mjs";
import {
  repeatsOption,
  OPTION_BANK_SIZE,
  CATEGORY_IDS,
} from "../option-rules.js";
import { optionInstructions, PROMPT_VERSION } from "./prompts.mjs";

export function validateSuggestions(value, excludedTexts = []) {
  if (
    !Array.isArray(value?.options) ||
    value.options.length !== OPTION_BANK_SIZE
  ) {
    throw new Error("Return exactly 50 distinct options.");
  }
  const seen = [...excludedTexts];
  return value.options.map((option) => {
    const text = typeof option?.text === "string" ? option.text.trim() : "";
    const words = text ? text.split(/\s+/).length : 0;
    if (words < 3 || words > 20 || /[<>\r\n]/.test(text)) {
      throw new Error(
        "Every option needs 3-20 words on one line, without markup.",
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
        { json: true, maxTokens: 9000 },
      );
      const options = validateSuggestions(JSON.parse(raw), excludedTexts);
      return {
        questionId: question.id,
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
