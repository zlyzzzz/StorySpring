import test from "node:test";
import assert from "node:assert/strict";
import { generateStory } from "../server/story.mjs";
const story = (title) => title + "\n\n" + Array(1999).fill("word").join(" ");
test("All confirmed choices are supplied without automatic alignment calls", async () => {
  let calls = 0;
  const result = await generateStory(
    { answers: { role: "A gardener", place: "A roof" }, definitions: [] },
    {
      completeFn: async (messages) => {
        calls++;
        assert.equal(JSON.parse(messages[1].content).requiredChoices.length, 2);
        return story("Garden");
      },
      annotateFn: async () => {
        throw Error("Unexpected annotation call");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.annotations, undefined);
});
test("One bounded streamed revision resets the preview when length is outside range", async () => {
  const phases = [];
  let writes = 0;
  const result = await generateStory(
    { answers: {} },
    {
      onProgress: (p) => phases.push(p),
      streamFn: async (_, options) => {
        const text = ++writes === 1 ? "Short\n\nToo short." : story("Garden");
        options.onText(text);
        return text;
      },
    },
  );
  assert.equal(writes, 2);
  assert.ok(phases.some((p) => p.phase === "revising" && p.text === ""));
  assert.equal(result.wordCount, 2000);
});
test("Repeated invalid lengths fail without saving a partial story", async () => {
  await assert.rejects(
    generateStory({ answers: {} }, { completeFn: async () => "Too short" }),
    /requested length/,
  );
});
