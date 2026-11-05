import { complete } from "./deepseek.mjs";
import { CATEGORY_IDS } from "../option-rules.js";
import { generateSuggestions } from "./suggestions.mjs";
import { followupInstructions, PROMPT_VERSION } from "./prompts.mjs";

// Visit core roots in their configured order. Each new round deepens the latest
// answered child on that root, so parent choice is deterministic rather than model-selected.
export function chooseParentBranch(
  definitions,
  answers,
  category,
  coreDefinitions = [],
) {
  const relevant = definitions.filter(
    (q) => q.category === category && answers[q.id]?.trim(),
  );
  const byId = new Map(relevant.map((q) => [q.id, q]));
  const configured = coreDefinitions.filter(
    (q) => q.category === category && !q.extension,
  );
  const roots = (
    configured.length
      ? configured
      : relevant.filter((q) => !q.extension && !q.id.includes("_adaptive_"))
  ).filter((q) => answers[q.id]?.trim());
  const rootOf = (id) => {
    const visited = new Set();
    let current = byId.get(id);
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
    return roots.some((q) => q.id === current?.id) ? current.id : null;
  };
  if (!roots.length) return [];
  const branches = roots.map((root) => {
    const children = relevant
      .filter((q) => q.id !== root.id && rootOf(q.id) === root.id)
      .sort(
        (a, b) =>
          Number(a.id.split("_").at(-1)) - Number(b.id.split("_").at(-1)),
      );
    return { root, children };
  });
  const minimum = Math.min(...branches.map((branch) => branch.children.length));
  const branch = branches.find((item) => item.children.length === minimum);
  return [branch.children.at(-1)?.id || branch.root.id];
}

export function validateFollowup(
  value,
  answers,
  allowedParents,
  previousQuestions,
) {
  const question =
    typeof value?.question === "string" ? value.question.trim() : "";
  const words = question ? question.split(/\s+/).length : 0;
  if (words < 6 || words > 22 || /[<>\r\n]/.test(question)) {
    throw new Error("Ask one question in 6-22 words, without markup.");
  }
  if (
    !allowedParents.includes(value.parentId) ||
    !answers[value.parentId]?.trim()
  ) {
    throw new Error(
      "Connect the question to an answered parent in the selected category.",
    );
  }
  const key = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (previousQuestions.some((text) => key(text) === key(question))) {
    throw new Error(
      "This question was already asked. Deepen a different detail.",
    );
  }
  return { question, parentId: value.parentId };
}

export async function generateFollowup(input, { coreDefinitions = [] } = {}) {
  const { answers, category, index, definitions = [], name = "" } = input;
  if (
    !CATEGORY_IDS.includes(category) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !Array.isArray(definitions)
  )
    throw new Error("Invalid follow-up request.");
  const allowedParents = chooseParentBranch(
    definitions,
    answers,
    category,
    coreDefinitions,
  );
  if (!allowedParents.length)
    throw new Error("Answer a core question in this category first.");
  const previousQuestions = definitions
    .map((q) => q.question)
    .filter((text) => typeof text === "string");
  let result;
  let correction = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await complete(
        [
          { role: "system", content: followupInstructions },
          {
            role: "user",
            content: JSON.stringify({
              category,
              answers,
              name,
              allowedParents,
              parentDetails: definitions
                .filter((q) => allowedParents.includes(q.id))
                .map((q) => ({
                  id: q.id,
                  question: q.question,
                  answer: answers[q.id],
                })),
              previousQuestions,
              correction,
            }),
          },
        ],
        { json: true, maxTokens: 1200 },
      );
      result = validateFollowup(
        JSON.parse(raw),
        answers,
        allowedParents,
        previousQuestions,
      );
      break;
    } catch (error) {
      correction = error.message;
      if (attempt === 2) throw error;
    }
  }
  // Prepare the bank only after validating the question and its parent link.
  const id = `${category}_adaptive_${index + 1}`;
  const bank = await generateSuggestions({
    question: { id, category, question: result.question },
    answers,
    name,
  });
  return {
    id,
    category,
    extension: true,
    adaptive: true,
    ...result,
    pool: bank.pool,
    options: bank.pool.slice(0, 3).map((option) => option.text),
    contextSnapshot: { ...answers },
    contextName: name,
    ruleVersion: PROMPT_VERSION,
    optionPolicyVersion: 2,
    batchSize: 9,
    maxOptions: 45,
  };
}
