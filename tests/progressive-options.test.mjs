import test from "node:test";
import assert from "node:assert/strict";
import { unseenBatch } from "../option-rules.js";
import {
  validateSuggestions,
  generateSuggestions,
} from "../server/suggestions.mjs";
import { chooseParentBranch } from "../server/followups.mjs";

test("A sixth batch is rejected before any provider request", async () => {
  await assert.rejects(
    generateSuggestions({
      question: {
        id: "characters_adaptive_1",
        category: "characters",
        question: "What else matters here?",
      },
      answers: {},
      generatedCount: 45,
    }),
    /maximum 45/,
  );
});

test("Five nine-option batches expose forty-five unique suggestions in fifteen displays", () => {
  let pool = [],
    seen = [];
  for (let group = 0; group < 5; group++) {
    const options = Array.from({ length: 9 }, (_, i) => ({
      text: `A possibility number ${group * 9 + i}`,
    }));
    validateSuggestions({ options }, seen, 9);
    pool.push(...options);
    for (let display = 0; display < 3; display++) {
      const batch = unseenBatch(pool, seen);
      assert.equal(batch.length, 3);
      assert.ok(batch.every((option) => !seen.includes(option.text)));
      seen.push(...batch.map((option) => option.text));
    }
    assert.equal(unseenBatch(pool, seen), null);
  }
  assert.equal(new Set(seen).size, 45);
  assert.throws(
    () => validateSuggestions({ options: pool.slice(0, 9) }, seen, 9),
    /repeat/,
  );
});

test("Root order comes from the actual core definitions, then each round uses its previous child", () => {
  const core = ["role", "motivation", "concern"].map((id) => ({
    id,
    category: "characters",
    extension: false,
  }));
  const definitions = [...core].reverse();
  const answers = Object.fromEntries(
    core.map((q) => [q.id, "Answered core detail"]),
  );
  const tips = core.map((q) => q.id);
  for (let index = 0; index < 12; index++) {
    const rootIndex = index % 3;
    assert.deepEqual(
      chooseParentBranch(definitions, answers, "characters", core),
      [tips[rootIndex]],
    );
    const id = `characters_adaptive_${index + 1}`;
    definitions.push({
      id,
      parentId: tips[rootIndex],
      category: "characters",
      extension: true,
    });
    answers[id] = "A newly confirmed detail";
    tips[rootIndex] = id;
  }
  assert.equal(tips[0], "characters_adaptive_10");
});
