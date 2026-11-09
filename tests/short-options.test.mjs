import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { rotatingBatch, coreBankSize } from "../option-rules.js";
import { validateSuggestions } from "../server/suggestions.mjs";
import { validateFollowup } from "../server/followups.mjs";
import { optionInstructions, followupInstructions } from "../server/prompts.mjs";

test("Six grammatical persons cycle in fresh batches without adjacent repeats", async () => {
  const presets = JSON.parse(
    await fs.readFile(new URL("../core-options.json", import.meta.url), "utf8"),
  );
  const pool = presets.banks.narrator.map((text) => ({ text }));
  assert.equal(coreBankSize("narrator"), 6);
  assert.equal(coreBankSize("role"), 50);
  let cycle = [];
  let previous = [];
  const seen = new Set();
  for (let index = 0; index < 100; index++) {
    const next = rotatingBatch(pool, cycle, previous);
    const texts = next.batch.map((option) => option.text);
    assert.equal(texts.length, 3);
    assert.equal(new Set(texts).size, 3);
    assert.ok(texts.every((text) => !previous.includes(text)));
    texts.forEach((text) => seen.add(text));
    if (index === 1) assert.equal(seen.size, 6);
    cycle = next.cycleTexts;
    previous = texts;
  }
  assert.equal(seen.size, 6);
});

test("Generated options accept concise phrases and reject excessive length", () => {
  const validate = (text) =>
    validateSuggestions({ options: [{ text }] }, [], 1);
  assert.equal(validate("Quiet hope")[0].text, "Quiet hope");
  assert.equal(
    validate("A quiet, observant gardener")[0].text,
    "A quiet, observant gardener",
  );
  assert.doesNotThrow(() => validate("one two three four five six seven eight"));
  assert.throws(() => validate("one two three four five six seven eight nine"));
  assert.throws(() => validate("one " + "a".repeat(69)));
  assert.throws(() => validate("Hope"));
  assert.throws(() => validate("Quiet\nhope"));
  assert.throws(() => validate("<b>Quiet hope</b>"));
  assert.match(optionInstructions, /2-8 words/);
  assert.match(optionInstructions, /72 characters/);
});

test("Adaptive questions enforce the same concise limits as the prompt", () => {
  const validate = (question) =>
    validateFollowup({ question, parentId: "role" }, { role: "A gardener" }, ["role"], []);
  assert.doesNotThrow(() => validate("What worries the gardener?"));
  assert.doesNotThrow(() =>
    validate("Which small detail makes this familiar garden feel strange to the gardener today now?"),
  );
  assert.throws(() =>
    validate("Which small detail makes this familiar garden feel strange to the gardener today once again?"),
  );
  assert.throws(() => validate("Why?"));
  assert.throws(() => validate("What " + "a".repeat(93) + " is this?"));
  assert.match(followupInstructions, /4-14 words/);
  assert.match(followupInstructions, /100 characters/);
});

test("Required narration questions match the confirmed wording", async () => {
  const { questions } = JSON.parse(
    await fs.readFile(new URL("../questions.json", import.meta.url), "utf8"),
  );
  assert.equal(
    questions.find((question) => question.id === "narrator").question,
    "Which grammatical person should the story use?",
  );
  assert.equal(
    questions.find((question) => question.id === "focalization").question,
    "How would you like readers to discover what happens in the story?",
  );
});

