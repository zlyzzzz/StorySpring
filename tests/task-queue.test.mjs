import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { TaskQueue } from "../server/task-queue.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const identity = () => ({
  requestId: randomUUID(),
  token: randomUUID() + randomUUID(),
});

test("Streaming previews are token-protected and never persisted as completed results", async (t) => {
  const folder = await directory(t);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const queue = await new TaskQueue({
    directory: folder,
    concurrency: 1,
    runner: async (_, input, progress) => {
      progress({ text: "An unfinished opening", phase: "generating" });
      await gate;
      return { story: "A completed story" };
    },
  }).init();
  t.after(() => queue.close());
  const credentials = identity();
  const accepted = await queue.enqueue({
    type: "/api/generate",
    input: {},
    ...credentials,
  });
  while (!queue.get(accepted.jobId, credentials.token).previewText)
    await wait(5);
  assert.equal(
    queue.get(accepted.jobId, credentials.token).previewText,
    "An unfinished opening",
  );
  assert.throws(() => queue.get(accepted.jobId, "wrong"), /denied/);
  const stored = JSON.parse(
    await fs.readFile(path.join(folder, accepted.jobId + ".json"), "utf8"),
  );
  assert.equal(stored.previewText, undefined);
  assert.equal(stored.result, undefined);
  release();
  await finished(queue, [{ ...accepted, ...credentials }]);
  assert.equal(
    queue.get(accepted.jobId, credentials.token).previewText,
    undefined,
  );
  assert.equal(
    queue.get(accepted.jobId, credentials.token).result.story,
    "A completed story",
  );
});
async function directory(t) {
  const base = path.resolve(os.tmpdir());
  const folder = await fs.mkdtemp(path.join(base, "storyspring-queue-test-"));
  t.after(async () => {
    assert.ok(folder.startsWith(path.join(base, "storyspring-queue-test-")));
    await fs.rm(folder, { recursive: true, force: true });
  });
  return folder;
}
async function finished(queue, jobs) {
  const deadline = Date.now() + 15_000;
  while (
    queue.active ||
    jobs.some(
      (job) =>
        !["succeeded", "failed"].includes(
          queue.get(job.jobId, job.token).status,
        ),
    )
  ) {
    if (Date.now() > deadline) throw Error("Queue did not drain");
    await wait(20);
  }
}

test("One hundred simulated tasks queue and finish without exceeding twenty workers", async (t) => {
  let active = 0,
    peak = 0,
    calls = 0;
  const queue = await new TaskQueue({
    directory: await directory(t),
    concurrency: 20,
    runner: async (_, input) => {
      active++;
      peak = Math.max(peak, active);
      calls++;
      await wait(100);
      active--;
      return { value: input.value };
    },
  }).init();
  t.after(() => queue.close());
  const jobs = await Promise.all(
    Array.from({ length: 100 }, async (_, value) => {
      const credentials = identity();
      return {
        ...(await queue.enqueue({
          type: "test",
          input: { value },
          ...credentials,
        })),
        ...credentials,
      };
    }),
  );
  await finished(queue, jobs);
  assert.equal(calls, 100);
  assert.equal(peak, 20);
  jobs.forEach((job, i) =>
    assert.deepEqual(queue.get(job.jobId, job.token).result, { value: i }),
  );
});

test("Concurrent duplicate submissions execute once and task results require their token", async (t) => {
  let calls = 0;
  const queue = await new TaskQueue({
    directory: await directory(t),
    concurrency: 1,
    runner: async () => {
      calls++;
      await wait(25);
      return { ok: true };
    },
  }).init();
  t.after(() => queue.close());
  const credentials = identity();
  const input = { type: "test", input: { a: 1 }, ...credentials };
  const jobs = await Promise.all(
    Array.from({ length: 20 }, () => queue.enqueue(input)),
  );
  assert.equal(new Set(jobs.map((j) => j.jobId)).size, 1);
  assert.throws(() => queue.get(jobs[0].jobId, "wrong"), /denied/);
  await finished(queue, [{ ...jobs[0], ...credentials }]);
  assert.equal(calls, 1);
  const reused = await queue.enqueue(input);
  assert.equal(reused.status, "succeeded");
  await assert.rejects(
    queue.enqueue({ ...input, input: { a: 2 } }),
    /another request/,
  );
});

test("Failed jobs release their slot and persisted successful results survive restart", async (t) => {
  const folder = await directory(t);
  let calls = 0;
  const queue = await new TaskQueue({
    directory: folder,
    concurrency: 1,
    runner: async (_, input) => {
      calls++;
      if (input.fail) throw Error("Expected failure");
      return { ok: true };
    },
  }).init();
  const first = identity(),
    second = identity();
  const a = {
    ...(await queue.enqueue({ type: "test", input: { fail: true }, ...first })),
    ...first,
  };
  const b = {
    ...(await queue.enqueue({ type: "test", input: {}, ...second })),
    ...second,
  };
  await finished(queue, [a, b]);
  queue.close();
  // Wait for the final persistence write and slot release before restarting.
  while (queue.active) await wait(10);
  const next = await new TaskQueue({
    directory: folder,
    runner: async () => {
      throw Error("Must not run completed task");
    },
  }).init();
  t.after(() => next.close());
  assert.equal(next.get(a.jobId, a.token).status, "failed");
  assert.equal(next.get(b.jobId, b.token).status, "succeeded");
  assert.equal(calls, 2);
});

test("A persisted interrupted task resumes after restart and returns its result", async (t) => {
  const folder = await directory(t);
  const credentials = identity();
  const id = randomUUID();
  const job = {
    id,
    ...credentials,
    type: "test",
    input: { value: 7 },
    status: "running",
    digest: "test",
    createdAt: Date.now(),
  };
  await fs.writeFile(path.join(folder, id + ".json"), JSON.stringify(job));
  let calls = 0;
  const queue = await new TaskQueue({
    directory: folder,
    runner: async (_, input) => {
      calls++;
      return input;
    },
  }).init();
  t.after(() => queue.close());
  await finished(queue, [{ jobId: id, ...credentials }]);
  assert.equal(calls, 1);
  assert.equal(
    queue.get(id, credentials.token).status,
    "succeeded",
    queue.get(id, credentials.token).error,
  );
  assert.deepEqual(queue.get(id, credentials.token).result, { value: 7 });
});

test("A full waiting list rejects excess work but admits already accepted duplicates", async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const queue = await new TaskQueue({
    directory: await directory(t),
    concurrency: 1,
    maxWaiting: 1,
    runner: async () => {
      await gate;
      return {};
    },
  }).init();
  t.after(() => queue.close());
  const first = identity(),
    second = identity();
  const a = {
    ...(await queue.enqueue({ type: "test", input: {}, ...first })),
    ...first,
  };
  const accepted = { type: "test", input: { value: 2 }, ...second };
  const b = { ...(await queue.enqueue(accepted)), ...second };
  await assert.rejects(
    queue.enqueue({ type: "test", input: {}, ...identity() }),
    (error) => error.status === 429,
  );
  assert.equal((await queue.enqueue(accepted)).jobId, b.jobId);
  release();
  await finished(queue, [a, b]);
});
