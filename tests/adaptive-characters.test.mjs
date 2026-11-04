import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildCharacterQuestion,
  ensureCharacterQuestion,
  contextChanged,
  suggestionBatch,
  answerProvenance,
  CHARACTER_FOLLOWUP_LIMIT,
} from "../adaptive-characters.js";
import { coreProgress } from "../core-progress.js";

const catalog = JSON.parse(
  await fs.readFile(
    new URL("../character-catalog.json", import.meta.url),
    "utf8",
  ),
);
const definitions = JSON.parse(
  await fs.readFile(new URL("../questions.json", import.meta.url), "utf8"),
);
const record = (goal) => ({
  name: "Mara",
  answers: {
    role: "A newcomer",
    goal,
    motivation: "An old memory",
    trait: "Careful",
    relationship: "Siblings with different priorities",
  },
});

test("The first question and its source lookup change with the confirmed goal", () => {
  const promise = buildCharacterQuestion(record("Keep a promise"), 0, catalog);
  const rest = buildCharacterQuestion(
    record("Have a quiet day and rest"),
    0,
    catalog,
  );
  assert.match(promise.question, /promise/);
  assert.match(rest.question, /rest/);
  assert.notDeepEqual(promise.pool, rest.pool);
  assert.equal(promise.parentId, "goal");
  assert.equal(promise.contextSnapshot.goal, "Keep a promise");
});

test("All ten follow-ups have six distinct options and only real catalog references", () => {
  const draft = record("Keep a promise");
  const ids = new Set(Object.values(catalog.items).map((item) => item.id));
  for (let index = 0; index < CHARACTER_FOLLOWUP_LIMIT; index++) {
    const question = ensureCharacterQuestion(draft, index, catalog);
    assert.equal(new Set(question.pool.map((option) => option.text)).size, 6);
    for (const option of question.pool) {
      option.sourceIds.forEach((id) => assert.ok(ids.has(id)));
      if (option.origin === "authored") assert.deepEqual(option.sourceIds, []);
    }
    draft.answers[question.id] = question.pool[0].text;
  }
  assert.equal(
    ensureCharacterQuestion(draft, CHARACTER_FOLLOWUP_LIMIT, catalog),
    null,
  );
});

test("Refreshing shows exactly three alternatives without repeating the prior batch", () => {
  const { pool } = buildCharacterQuestion(record("Keep a promise"), 0, catalog);
  const first = suggestionBatch(pool, [], () => 0.3);
  const next = suggestionBatch(
    pool,
    first.map((item) => item.text),
    () => 0.8,
  );
  assert.equal(first.length, 3);
  assert.equal(next.length, 3);
  assert.ok(
    next.every(
      (option) => !first.some((previous) => previous.text === option.text),
    ),
  );
});

test("User-edited source wording preserves its original reference", () => {
  const question = buildCharacterQuestion(record("Keep a promise"), 0, catalog);
  const source = question.pool.find((option) => option.sourceIds.length);
  const provenance = answerProvenance(
    question,
    [source],
    0,
    "Make my younger sister smile",
  );
  assert.equal(provenance.origin, "user_edited");
  assert.deepEqual(provenance.sourceIds, source.sourceIds);
  assert.equal(provenance.originalSuggestion, source.text);
  assert.equal(
    answerProvenance(question, [], 3, "My own idea").origin,
    "user_written",
  );
});

test("Changing a parent refreshes an unanswered question but preserves confirmed history", () => {
  const draft = record("Keep a promise");
  const first = ensureCharacterQuestion(draft, 0, catalog);
  draft.answers.goal = "Find a lost letter";
  assert.ok(contextChanged(first, draft));
  const refreshed = ensureCharacterQuestion(draft, 0, catalog);
  assert.match(refreshed.question, /search/);
  draft.answers[refreshed.id] = "It has personal meaning";
  draft.answers.goal = "Get some rest";
  assert.deepEqual(ensureCharacterQuestion(draft, 0, catalog), refreshed);
  assert.ok(contextChanged(refreshed, draft));
});

test("Follow-ups branch from basic answers and earlier follow-ups", () => {
  const draft = record("Keep a promise");
  const first = ensureCharacterQuestion(draft, 0, catalog);
  draft.answers[first.id] = "To make someone happy";
  assert.equal(buildCharacterQuestion(draft, 1, catalog).parentId, first.id);
  assert.equal(
    buildCharacterQuestion(draft, 2, catalog).parentId,
    "relationship",
  );
});

test("Custom goals remain open and do not invent a conflict or a dataset source", () => {
  const question = buildCharacterQuestion(
    record("Observe clouds and sketch their shapes"),
    0,
    catalog,
  );
  assert.equal(question.route.rule, "open");
  assert.doesNotMatch(question.question, /conflict|failure|must succeed/);
  assert.equal(
    buildCharacterQuestion(record("Write a few words"), 0, catalog).route.rule,
    "open",
  );
  assert.equal(
    buildCharacterQuestion(record("Return home"), 0, catalog).route.rule,
    "new_start",
  );
});

test("Optional answers never replace missing required answers", () => {
  const answers = { characters_adaptive_1: "An optional answer" };
  assert.equal(coreProgress(definitions.questions, answers).completed, 0);
  const core = definitions.questions.filter((question) => !question.extension);
  core.forEach((question) => {
    answers[question.id] = "Confirmed";
  });
  assert.equal(coreProgress(definitions.questions, answers).ready, true);
  delete answers.role;
  assert.equal(coreProgress(definitions.questions, answers).ready, false);
});
