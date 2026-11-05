import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validateSuggestions } from "../server/suggestions.mjs";
import { validateNames } from "../server/names.mjs";
import { validateFollowup } from "../server/followups.mjs";
import { rotatingBatch } from "../option-rules.js";
import { nextCountReminder } from "../answer-state.js";
import { coreProgress } from "../core-progress.js";

test("Milestones are inclusive and shown once per draft", () => {
  for (const threshold of [25, 35, 45]) {
    const previous = [25, 35, 45].filter((n) => n < threshold);
    assert.equal(nextCountReminder(threshold - 1, previous), undefined);
    assert.equal(nextCountReminder(threshold, previous), threshold);
    assert.equal(
      nextCountReminder(threshold + 1, [...previous, threshold]),
      undefined,
    );
  }
});

const pool = Array.from({ length: 50 }, (_, index) => ({
  text: `Creative possibility number ${index}`,
}));
test("AI bank validation rejects duplicates, incomplete banks and malformed wording", () => {
  assert.equal(validateSuggestions({ options: pool }).length, 50);
  assert.throws(() => validateSuggestions({ options: pool.slice(1) }));
  assert.throws(() =>
    validateSuggestions({ options: [...pool.slice(1), pool[1]] }),
  );
  assert.throws(() =>
    validateSuggestions({ options: [{ text: "Short" }, ...pool.slice(1)] }),
  );
  const result = validateSuggestions({
    options: pool.map((p) => ({ ...p, unwanted: true })),
  });
  assert.deepEqual(Object.keys(result[0]), ["text"]);
});

test("Random batches cover all fifty options before recycling without adjacent repeats", () => {
  let cycle = [],
    previous = [];
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const result = rotatingBatch(pool, cycle, previous, () => 0.4);
    const texts = result.batch.map((p) => p.text);
    assert.equal(new Set(texts).size, 3);
    assert.ok(texts.every((text) => !previous.includes(text)));
    if (i < 16) assert.ok(texts.every((text) => !seen.has(text)));
    texts.forEach((text) => seen.add(text));
    if (i === 16) assert.equal(seen.size, 50);
    cycle = result.cycleTexts;
    previous = texts;
  }
});

test("Names reject duplicates, numbering and executable markup", () => {
  const names = Array.from(
    { length: 50 },
    (_, i) =>
      `Ari ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
  );
  assert.equal(validateNames({ names }).length, 50);
  for (const invalid of [names[1], "Name 1", "<script>alert</script>"]) {
    assert.throws(() => validateNames({ names: [invalid, ...names.slice(1)] }));
  }
});

test("Follow-ups require an existing parent in the chosen category", () => {
  const question = "How does the old tree remember this particular visitor?";
  assert.equal(
    validateFollowup(
      { question, parentId: "role" },
      { role: "An old tree" },
      ["role"],
      [],
    ).parentId,
    "role",
  );
  assert.throws(() =>
    validateFollowup(
      { question, parentId: "place" },
      { place: "A park" },
      ["role"],
      [],
    ),
  );
  assert.throws(() =>
    validateFollowup(
      { question, parentId: "role" },
      { role: "Tree" },
      ["role"],
      [question],
    ),
  );
});

test("All fourteen required answers gate generation, with no fixed option content", async () => {
  const { questions } = JSON.parse(
    await fs.readFile(new URL("../questions.json", import.meta.url)),
  );
  assert.equal(questions.length, 14);
  assert.ok(
    questions.every((q) => !Object.hasOwn(q, "options") && !q.extension),
  );
  const answers = Object.fromEntries(
    questions.map((q) => [q.id, "A confirmed detail"]),
  );
  assert.equal(coreProgress(questions, answers).ready, true);
  delete answers[questions.at(-1).id];
  assert.equal(coreProgress(questions, answers).ready, false);
});
