import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { validateSuggestions } from "../server/suggestions.mjs";
import { validateNames } from "../server/names.mjs";
import { chooseParentBranch } from "../server/followups.mjs";
import { validateAnnotations } from "../server/annotations.mjs";
import { TARGET_WORDS } from "../server/prompts.mjs";
import { forkStory, saveGeneratedVersion } from "../story-storage.js";

test("All fixed core banks and names contain fifty validated unique candidates", async () => {
  const presets = JSON.parse(
    await fs.readFile(new URL("../core-options.json", import.meta.url)),
  );
  const { questions } = JSON.parse(
    await fs.readFile(new URL("../questions.json", import.meta.url)),
  );
  assert.equal(Object.keys(presets.banks).length, 14);
  for (const question of questions) {
    assert.equal(
      validateSuggestions({
        options: presets.banks[question.id].map((text) => ({ text })),
      }).length,
      50,
    );
  }
  assert.equal(validateNames({ names: presets.names }).length, 50);
  assert.equal(TARGET_WORDS, 2000);
});

test("Balanced parent selection covers separate roots and permits children and siblings", () => {
  const definitions = ["role", "motivation", "concern"].map((id) => ({
    id,
    category: "characters",
    extension: false,
  }));
  const answers = Object.fromEntries(
    definitions.map((q) => [q.id, "Confirmed answer"]),
  );
  for (const root of ["role", "motivation", "concern"]) {
    const allowed = chooseParentBranch(definitions, answers, "characters");
    assert.deepEqual(allowed, [root]);
    const id = `${root}_adaptive_1`;
    definitions.push({
      id,
      category: "characters",
      extension: true,
      parentId: root,
    });
    answers[id] = "A child answer";
  }
  assert.deepEqual(chooseParentBranch(definitions, answers, "characters"), [
    "role",
    "role_adaptive_1",
  ]);
  definitions.push({
    id: "role_adaptive_2",
    category: "characters",
    extension: true,
    parentId: "role_adaptive_1",
  });
  answers.role_adaptive_2 = "A grandchild answer";
  // Other roots now take precedence, rather than endlessly extending the role chain.
  assert.deepEqual(chooseParentBranch(definitions, answers, "characters"), [
    "motivation",
    "motivation_adaptive_1",
  ]);
});

test("Markers validate paraphrase evidence against exact original passages", () => {
  const story =
    "The Garden\n\nShe gripped the envelope, unwilling to break her word.\n\nRain arrived.";
  const quote = "She gripped the envelope, unwilling to break her word.";
  const result = validateAnnotations(
    {
      matches: [
        { questionId: "motivation", quote },
        { questionId: "motivation", quote },
        { questionId: "unknown", quote },
        { questionId: "motivation", quote: "A passage that was invented." },
        { questionId: "motivation", quote: "The Garden" },
      ],
    },
    story,
    { motivation: "Keep a promise" },
  );
  assert.equal(result.length, 1);
  assert.equal(story.slice(result[0].start, result[0].end), quote);
});

test("New versions never inherit alignment offsets from an older story", () => {
  const record = {
    id: "original",
    title: "Garden (1)",
    story: "Garden\n\nOld text.",
    choiceAnnotations: [{ start: 8, end: 11 }],
    answers: {},
    version: 1,
  };
  const draft = forkStory(record);
  assert.equal(draft.choiceAnnotations, undefined);
  const library = { records: [record, draft] };
  const next = saveGeneratedVersion(library, draft.id, "Garden\n\nNew text.");
  assert.equal(next.choiceAnnotations, undefined);
  assert.equal(record.choiceAnnotations.length, 1);
});
