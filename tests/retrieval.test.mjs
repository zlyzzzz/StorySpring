import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { openRetrieval } from "../server/retrieval.mjs";
import {
  validateFollowup,
  wordCountOfStory,
  TARGET_WORDS,
} from "../server/followups.mjs";

test("Database retrieval returns source-bearing records without interpreting FTS operators", () => {
  const database = openRetrieval(
    fileURLToPath(new URL("../server/data/materials.sqlite", import.meta.url)),
  );
  try {
    assert.equal(database.count, 235607);
    const found = database.find("keep a promise to a friend");
    assert.ok(found.length > 0 && found.length <= 12);
    for (const row of found) {
      assert.match(row.id, /^SCM_/);
      assert.ok(row.source_file && row.source_row && row.sentence);
      assert.equal(row.acceptance, "owner_batch_accepted_2026-11-04");
      assert.equal(row.original_review_status, "pending");
    }
    assert.doesNotThrow(() =>
      database.find('" OR * NEAR() ; DROP TABLE materials;'),
    );
  } finally {
    database.close();
  }
});

test("Follow-ups require an answered parent, six distinct options and real retrieved IDs", () => {
  const value = {
    question: "What makes this quiet moment feel different to them?",
    parentId: "concern",
    options: Array.from({ length: 6 }, (_, index) => ({
      text: `A familiar detail number ${index}`,
      sourceIds: [],
    })),
  };
  const answers = { concern: "Taking time to rest" };
  assert.equal(validateFollowup(value, answers, [], []), value);
  assert.throws(() =>
    validateFollowup({ ...value, parentId: "unknown" }, answers, [], []),
  );
  assert.throws(() => validateFollowup(value, answers, [], [value.question]));
  assert.throws(() =>
    validateFollowup(
      { ...value, options: value.options.slice(0, 3) },
      answers,
      [],
      [],
    ),
  );
  const forged = structuredClone(value);
  forged.options[0].sourceIds = ["invented"];
  assert.throws(() => validateFollowup(forged, answers, [], []));
});

test("Generation counts English words rather than tokens or characters", () => {
  assert.equal(TARGET_WORDS, 5000);
  assert.equal(wordCountOfStory("Mara's well-kept garden. 123"), 3);
});
