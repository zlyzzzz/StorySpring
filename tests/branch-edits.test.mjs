import test from "node:test";
import assert from "node:assert/strict";
import { pruneDescendants, descendantIds } from "../branch-state.js";
import {
  modificationInfo,
  modifiedAnswerCount,
  changedSegments,
} from "../answer-edits.js";

test("Changing one answer removes descendants and their banks, but preserves siblings", () => {
  const definitions = [
    { id: "role", category: "characters", extension: false },
    { id: "motivation", category: "characters", extension: false },
    {
      id: "characters_adaptive_1",
      category: "characters",
      extension: true,
      parentId: "role",
    },
    {
      id: "characters_adaptive_2",
      category: "characters",
      extension: true,
      parentId: "characters_adaptive_1",
    },
    {
      id: "characters_adaptive_3",
      category: "characters",
      extension: true,
      parentId: "motivation",
    },
    {
      id: "characters_adaptive_4",
      category: "characters",
      extension: true,
      parentId: "characters_adaptive_2",
    },
  ];
  const record = {
    answers: {
      role: "A visitor",
      motivation: "A memory",
      characters_adaptive_1: "A letter",
      characters_adaptive_2: "A clue",
      characters_adaptive_3: "A friend",
    },
    adaptiveQuestions: definitions.slice(2),
    progress: { characters: { exploreConsent: true } },
    answerEdits: { characters_adaptive_2: { originalAnswer: "Old clue" } },
    suggestionPools: { characters_adaptive_4: { pool: [] } },
    optionSnapshots: {},
    answerParents: {},
  };
  assert.equal(descendantIds(record, "role", definitions).length, 3);
  const removed = pruneDescendants(record, "role", definitions);
  assert.equal(removed.answeredCount, 2);
  assert.deepEqual(Object.keys(record.answers), [
    "role",
    "motivation",
    "characters_adaptive_3",
  ]);
  assert.equal(record.adaptiveQuestions.length, 1);
  assert.equal(record.answerEdits.characters_adaptive_2, undefined);
  assert.equal(record.suggestionPools.characters_adaptive_4, undefined);
  assert.equal(record.progress.characters.extraCompleted, 1);
  assert.equal(record.progress.characters.index, 0);
  assert.equal(record.progress.characters.exploreConsent, true);
});

test("Own wording is counted per answered question and highlights only the replacement span", () => {
  const record = {
    answers: {
      room: "A bright room",
      ending: "A quiet goodbye",
      tone: "Warm and playful",
    },
    optionSnapshots: {
      room: {
        provenance: {
          origin: "user_edited",
          originalSuggestion: "A quiet room",
        },
      },
      ending: { provenance: { origin: "user_written" } },
      tone: { provenance: { origin: "ai_generated" } },
    },
  };
  assert.equal(modifiedAnswerCount(record), 2);
  assert.equal(modificationInfo(record, "ending").label, "Your own answer");
  assert.deepEqual(changedSegments("A quiet room", "A bright room"), [
    { text: "A ", changed: false },
    { text: "bright", changed: true },
    { text: " room", changed: false },
  ]);
  delete record.answers.ending;
  assert.equal(modifiedAnswerCount(record), 1);
});
