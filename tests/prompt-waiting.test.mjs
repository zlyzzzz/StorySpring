import test from "node:test";
import assert from "node:assert/strict";
import { TaskQueue } from "../server/task-queue.mjs";
import { validatePromptAnnotations } from "../server/annotations.mjs";
import { forkStory, saveGeneratedVersion } from "../story-storage.js";

test("Prompt links require exact evidence in both the story and original prompt", () => {
  const story = "The Lantern\n\nMira lit a candle before entering the dark room.";
  const prompt = "Mira is afraid of the dark. End with hope.";
  const valid = { quote: "Mira lit a candle before entering the dark room.", promptExcerpt: "Mira is afraid of the dark." };
  const matches = validatePromptAnnotations({ matches: [valid, valid,
    { ...valid, quote: "Invented evidence" },
    { ...valid, promptExcerpt: "An invented instruction" },
    { ...valid, quote: "The Lantern" },
  ] }, story, prompt);
  assert.equal(matches.length, 1);
  assert.equal(story.slice(matches[0].start, matches[0].end), valid.quote);
  assert.equal(matches[0].promptExcerpt, valid.promptExcerpt);
});

test("ETA stays unavailable until enough real endpoint samples exist", () => {
  const queue = new TaskQueue({ directory: "unused", concurrency: 1 });
  const now = Date.now();
  const job = { id: "current", type: "/api/followup", status: "running", startedAt: now - 1000 };
  assert.equal(queue.estimate(job, []), null);
  for (let i = 0; i < 5; i++) queue.jobs.set(String(i), {
    id: String(i), type: job.type, status: "succeeded", startedAt: now - 30_000,
    finishedAt: now - 20_000,
  });
  const estimate = queue.estimate(job, []);
  assert.equal(estimate.samples, 5);
  assert.ok(estimate.maxMs > 8500 && estimate.maxMs <= 9000);
  assert.equal(estimate.overdue, false);
  assert.equal(queue.estimate({ ...job, startedAt: now - 15_000 }, []).overdue, true);
  assert.equal(queue.estimate({ ...job, type: "/api/generate" }, []), null);
});

test("Queued ETA accounts for occupied workers and refuses unknown mixed workloads", () => {
  const queue = new TaskQueue({ directory: "unused", concurrency: 1 });
  const now = Date.now();
  for (let i = 0; i < 5; i++) queue.jobs.set(String(i), {
    type: "/api/followup", status: "succeeded", startedAt: now - 30_000, finishedAt: now - 20_000,
  });
  const active = { id: "active", type: "/api/followup", status: "running", startedAt: now - 2000 };
  queue.jobs.set(active.id, active);
  const first = { id: "first", type: active.type, status: "queued" };
  const next = { id: "next", type: active.type, status: "queued" };
  const estimate = queue.estimate(next, [first, next]);
  assert.ok(estimate.maxMs > 27_000 && estimate.maxMs <= 28_000);
  active.type = "/api/generate";
  assert.equal(queue.estimate(next, [first, next]), null);
});

test("Free Writing versions never reuse highlights from another story", () => {
  const original = { id: "original", title: "Lantern", mode: "free", free: "A hopeful ending.",
    story: "Old story", answers: {}, promptAnnotations: [{ start: 2, end: 7 }] };
  const draft = forkStory(original);
  assert.equal(draft.promptAnnotations, undefined);
  const library = { records: [original, draft] };
  assert.equal(saveGeneratedVersion(library, draft.id, "New story").promptAnnotations, undefined);
  assert.equal(original.promptAnnotations.length, 1);
});
