import test from "node:test";
import assert from "node:assert/strict";
import { generateStory } from "../server/story.mjs";
const story = (title) => title + "\n\n" + Array(1999).fill("word").join(" ");

test("Story generation repairs omitted choices once and returns final alignment", async () => {
  let writes = 0,
    audits = 0;
  const result = await generateStory(
    { answers: { role: "A gardener", place: "A roof" }, definitions: [] },
    {
      completeFn: async (messages) => {
        writes++;
        const payload = JSON.parse(messages[1].content);
        if (writes === 1) assert.equal(payload.requiredChoices.length, 2);
        else
          assert.deepEqual(
            payload.missingChoices.map((c) => c.id),
            ["place"],
          );
        return story("Garden");
      },
      annotateFn: async () => ({
        matches:
          ++audits === 1
            ? [{ questionId: "role" }]
            : [{ questionId: "role" }, { questionId: "place" }],
      }),
    },
  );
  assert.equal(writes, 2);
  assert.equal(audits, 2);
  assert.equal(result.coverage.located, 2);
  assert.deepEqual(result.coverage.unlocatedIds, []);
});

test("Unavailable auditing preserves a valid story without claiming full coverage", async () => {
  const result = await generateStory(
    { answers: { role: "A gardener" } },
    {
      completeFn: async () => story("Garden"),
      annotateFn: async () => {
        throw Error("Offline");
      },
    },
  );
  assert.equal(result.coverage.status, "unavailable");
  assert.equal(result.annotations, undefined);
});

test("Remaining omissions are exposed after a bounded repair, never hidden", async () => {
  let writes = 0;
  const result = await generateStory(
    { answers: { role: "A gardener", place: "A roof" } },
    {
      completeFn: async () => {
        writes++;
        return story("Garden");
      },
      annotateFn: async () => ({ matches: [{ questionId: "role" }] }),
    },
  );
  assert.equal(writes, 2);
  assert.deepEqual(result.coverage.unlocatedIds, ["place"]);
});
