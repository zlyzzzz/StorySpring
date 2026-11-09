import test from "node:test";
import assert from "node:assert/strict";
import { consumeStoryStream } from "../server/streaming.mjs";
import { generateStory } from "../server/story.mjs";

function body(events, width = 7) {
  const bytes = new TextEncoder().encode(events);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + width));
      offset += width;
    },
  });
}
const event = (choice) =>
  `data: ${JSON.stringify({ choices: [choice] })}\r\n\r\n`;
test("SSE parsing emits text before completion and handles split UTF-8 and CRLF", async () => {
  const parts = [];
  const result = await consumeStoryStream(
    body(
      event({ delta: { content: "A café" } }) +
        event({ delta: { content: " beside the sea." } }) +
        event({ delta: {}, finish_reason: "stop" }) +
        "data: [DONE]\r\n\r\n",
      1,
    ),
    (_, text) => parts.push(text),
  );
  assert.equal(parts[0], "A café");
  assert.equal(result, "A café beside the sea.");
});
test("Truncated or length-limited streams never become completed stories", async () => {
  await assert.rejects(
    consumeStoryStream(body(event({ delta: { content: "unfinished" } }))),
    /incomplete/,
  );
  await assert.rejects(
    consumeStoryStream(
      body(
        event({ delta: { content: "too long" }, finish_reason: "length" }) +
          "data: [DONE]\n",
      ),
    ),
    /incomplete/,
  );
});
test("Story generation streams a preview and never automatically requests annotations", async () => {
  const progress = [];
  const final = "Garden\n\n" + Array(1999).fill("word").join(" ");
  const result = await generateStory(
    { answers: { role: "A gardener" } },
    {
      onProgress: (value) => progress.push(value),
      streamFn: async (_, options) => {
        options.onText("Garden\n\nFirst words");
        options.onText(final);
        return final;
      },
      annotateFn: () => {
        throw Error("Must not call annotations");
      },
    },
  );
  assert.ok(progress.some((p) => p.text === "Garden\n\nFirst words"));
  assert.equal(result.story, final);
  assert.equal(result.annotations, undefined);
  assert.equal(result.coverage, undefined);
});
