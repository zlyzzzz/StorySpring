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
