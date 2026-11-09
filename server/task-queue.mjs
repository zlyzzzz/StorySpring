import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";

export function taskError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// One queue owner per service instance. Use a persistent disk to survive Render restarts.
export class TaskQueue {
  constructor({
    directory,
    concurrency = 20,
    maxWaiting = 200,
    ttlMs = 3_600_000,
    runner,
  }) {
    this.directory = directory;
    this.concurrency = concurrency;
    this.maxWaiting = maxWaiting;
    this.ttlMs = ttlMs;
    this.runner = runner;
    this.jobs = new Map();
    this.requests = new Map();
    this.active = 0;
    this.lock = Promise.resolve();
    this.pumping = false;
    this.closed = false;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    for (const file of await fs.readdir(this.directory)) {
      if (file.endsWith(".tmp")) {
        const filename = path.join(this.directory, file);
        if (Date.now() - (await fs.stat(filename)).mtimeMs > this.ttlMs)
          await fs.unlink(filename);
        continue;
      }
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      const job = JSON.parse(
        await fs.readFile(path.join(this.directory, file), "utf8"),
      );
      if (Date.now() - job.createdAt > this.ttlMs) {
        await fs.unlink(path.join(this.directory, file));
        continue;
      }
      if (job.status === "running") {
        job.recoveries = (job.recoveries || 0) + 1;
        job.status = job.recoveries > 1 ? "failed" : "queued";
        job.error =
          job.status === "failed"
            ? "This task was interrupted repeatedly. Please submit again."
            : undefined;
        await this.write(job);
      }
      this.jobs.set(job.id, job);
      this.requests.set(job.requestId, job.id);
    }
    this.timer = setInterval(() => this.expire().catch(() => {}), 60_000);
    this.timer.unref();
    this.pump();
    return this;
  }

  async write(job) {
    const destination = path.join(this.directory, `${job.id}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
    // Windows can briefly lock a replaced file. Preserve atomic replacement with a bounded retry.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temporary, destination);
        break;
      } catch (error) {
        if (
          attempt >= 3 ||
          !["EPERM", "EACCES", "EBUSY"].includes(error.code)
        ) {
          await fs.unlink(temporary).catch(() => {});
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
    }
  }

  async enqueue({ type, input, requestId, token }) {
    // Serialize acceptance, so simultaneous retries cannot create duplicate tasks.
    const operation = this.lock.then(async () => {
      if (
        !/^[a-f0-9-]{36}$/.test(requestId || "") ||
        !/^[a-f0-9-]{72}$/.test(token || "")
      ) {
        throw taskError("Invalid task identity. Reload the page and retry.");
      }
      const digest = createHash("sha256")
        .update(JSON.stringify({ type, input }))
        .digest("hex");
      const previous = this.jobs.get(this.requests.get(requestId));
      if (previous) {
        this.authorize(previous, token);
        if (previous.digest !== digest)
          throw taskError(
            "This task identity belongs to another request.",
            409,
          );
        return this.publicJob(previous);
      }
      if (
        [...this.jobs.values()].filter((j) => j.status === "queued").length >=
        this.maxWaiting
      ) {
        throw taskError(
          "The waiting list is full. Your answers are saved; please retry shortly.",
          429,
        );
      }
      const job = {
        id: randomUUID(),
        requestId,
        token,
        digest,
        type,
        input,
        status: "queued",
        createdAt: Date.now(),
      };
      await this.write(job);
      this.jobs.set(job.id, job);
      this.requests.set(requestId, job.id);
      this.pump();
      return this.publicJob(job);
    });
    this.lock = operation.catch(() => {});
    return operation;
  }

  authorize(job, token) {
    const actual = Buffer.from(typeof token === "string" ? token : "");
    const expected = Buffer.from(job.token);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw taskError("Task not found or access denied.", 404);
    }
  }

  get(id, token) {
    const job = this.jobs.get(id);
    if (
      !job ||
      (job.status !== "running" && Date.now() - job.createdAt > this.ttlMs)
    ) {
      throw taskError(
        "This task expired. Your saved draft is unchanged; submit again.",
        404,
      );
    }
    this.authorize(job, token);
    return this.publicJob(job);
  }

  publicJob(job) {
    const waiting = [...this.jobs.values()]
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt);
    return {
      jobId: job.id,
      status: job.status,
      position:
        job.status === "queued"
          ? waiting.findIndex((j) => j.id === job.id) + 1
          : 0,
      pollAfterMs:
        job.type === "/api/generate" && job.status === "running" ? 700 : 2000,
      ...(job.status === "running" && job.previewText !== undefined
        ? { previewText: job.previewText, phase: job.phase || "generating" }
        : {}),
      ...(job.status === "succeeded" ? { result: job.result } : {}),
      ...(job.status === "failed" ? { error: job.error } : {}),
    };
  }

  async pump() {
    if (this.pumping || this.closed) return;
    this.pumping = true;
    try {
      while (this.active < this.concurrency && !this.closed) {
        const job = [...this.jobs.values()]
          .filter((j) => j.status === "queued")
          .sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!job) break;
        job.status = "running";
        this.active++;
        // run() owns the slot until the final result has been persisted.
        this.run(job).catch(() => {});
      }
    } finally {
      this.pumping = false;
    }
  }

  async run(job) {
    try {
      await this.write(job);
      job.result = await this.runner(job.type, job.input, (progress) => {
        // Preview is transient and protected by the task token; persist only completed text.
        job.previewText = progress.text;
        job.phase = progress.phase;
      });
      job.status = "succeeded";
    } catch (error) {
      job.status = "failed";
      job.error = error.message || "The task failed. Your answers are saved.";
    }
    delete job.previewText;
    delete job.phase;
    job.finishedAt = Date.now();
    // Do not retain the submitted prompt in completed task records unnecessarily.
    delete job.input;
    try {
      await this.write(job);
    } catch {
      job.status = "failed";
      job.error =
        "The server could not store this result. Please retry from your saved draft.";
    } finally {
      this.active--;
      this.pump();
    }
  }

  async expire() {
    for (const file of await fs.readdir(this.directory)) {
      if (!file.endsWith(".tmp")) continue;
      const filename = path.join(this.directory, file);
      const stat = await fs.stat(filename).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > this.ttlMs)
        await fs.unlink(filename).catch(() => {});
    }
    for (const [id, job] of this.jobs) {
      if (job.status === "running" || Date.now() - job.createdAt <= this.ttlMs)
        continue;
      this.jobs.delete(id);
      this.requests.delete(job.requestId);
      await fs.unlink(path.join(this.directory, `${id}.json`)).catch(() => {});
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
  }
}
