import { complete } from "./deepseek.mjs";
import { nameInstructions } from "./prompts.mjs";
import { OPTION_BANK_SIZE } from "../option-rules.js";

export function validateNames(value) {
  if (!Array.isArray(value?.names) || value.names.length !== OPTION_BANK_SIZE) {
    throw new Error("Return exactly 50 distinct names.");
  }
  const seen = new Set();
  return value.names.map((name) => {
    const text =
      typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
    const key = text.normalize("NFKC").toLowerCase();
    if (
      !text ||
      text.length > 60 ||
      text.split(" ").length > 3 ||
      !/^[\p{L}\p{M}][\p{L}\p{M} '\u2019-]*$/u.test(text) ||
      seen.has(key)
    ) {
      throw new Error(
        "Use 50 unique names, each 1-3 words, using letters and name punctuation only.",
      );
    }
    seen.add(key);
    return text;
  });
}

export async function generateNames({ answers }) {
  let correction = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await complete(
        [
          { role: "system", content: nameInstructions },
          { role: "user", content: JSON.stringify({ answers, correction }) },
        ],
        { json: true, maxTokens: 3000 },
      );
      return { names: validateNames(JSON.parse(raw)) };
    } catch (error) {
      correction = error.message;
      if (attempt === 2) throw error;
    }
  }
}
