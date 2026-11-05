import { TaskQueue } from "./task-queue.mjs";
import { annotateStory } from "./annotations.mjs";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFollowup } from "./followups.mjs";
import { generateStory } from "./story.mjs";
import { coreProgress } from "../core-progress.js";
import { generateSuggestions } from "./suggestions.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Credentials are loaded only by the server and never served as static assets.
const envFile = process.env.STORYSPRING_ENV_FILE || path.join(root, ".env");
try {
  process.loadEnvFile(envFile);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const presets = JSON.parse(
  await fs.readFile(path.join(root, "core-options.json"), "utf8"),
);
const definitions = JSON.parse(
  await fs.readFile(path.join(root, "questions.json"), "utf8"),
).questions;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};
const assets = new Set([
  "index.html",
  "app.js",
  "task-client.js",
  "styles.css",
  "ui.js",
  "questions.json",
  "core-options.json",
  "story-storage.js",
  "core-progress.js",
  "option-rules.js",
  "branch-state.js",
  "answer-edits.js",
  "answer-state.js",
  "word-download.js",
  "docx.mjs",
  "caveat.woff2",
]);
function setting(name, fallback, maximum) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new Error(`Invalid ${name} configuration.`);
  return value;
}
const queue = await new TaskQueue({
  directory: process.env.AI_TASK_DIR || path.join(root, ".runtime/tasks"),
  concurrency: setting("AI_MAX_CONCURRENCY", 20, 100),
  maxWaiting: setting("AI_MAX_QUEUE", 200, 1000),
  ttlMs: setting("AI_TASK_TTL_SECONDS", 3600, 86400) * 1000,
  runner: (endpoint, input, onProgress) =>
    endpoint === "/api/suggestions"
      ? generateSuggestions(input)
      : endpoint === "/api/followup"
        ? generateFollowup(input, { coreDefinitions: definitions })
        : endpoint === "/api/annotations"
          ? annotateStory(input)
          : generateStory(input, { onProgress }),
}).init();

function json(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 1_000_000)
      throw new Error("This brief is too large to send.");
  }
  const value = JSON.parse(body);
  if (
    !value.answers ||
    typeof value.answers !== "object" ||
    Array.isArray(value.answers) ||
    Object.values(value.answers).some((answer) => typeof answer !== "string")
  ) {
    throw new Error("Invalid story answers.");
  }
  return value;
}

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  try {
    if (pathname === "/api/status" && request.method === "GET") {
      return json(response, 200, {
        aiEnabled: Boolean(process.env.DEEPSEEK_API_KEY),
        candidateBankSize: 50,
        adaptiveBatchSize: 9,
        adaptiveOptionLimit: 45,
        targetWords: 2000,
        maxConcurrency: queue.concurrency,
      });
    }
    if (pathname.startsWith("/api/tasks/") && request.method === "GET") {
      const id = pathname.slice("/api/tasks/".length);
      const token = request.headers.authorization?.replace(/^Bearer /, "");
      return json(response, 200, queue.get(id, token));
    }
    if (pathname.startsWith("/api/") && request.method === "POST") {
      if (
        ![
          "/api/followup",
          "/api/generate",
          "/api/suggestions",
          "/api/names",
          "/api/annotations",
        ].includes(pathname)
      )
        return json(response, 404, { error: "Unknown endpoint." });
      const origin = request.headers.origin;
      // HTTPS may terminate at the hosting proxy before reaching this HTTP server.
      if (origin && new URL(origin).host !== request.headers.host)
        return json(response, 403, {
          error: "Use this website to send a request.",
        });
      const input = await readBody(request);
      if (
        pathname === "/api/generate" &&
        !(input.mode === "free"
          ? input.free?.trim()
          : coreProgress(definitions, input.answers).ready)
      ) {
        return json(response, 400, {
          error: "Complete the required answers first.",
        });
      }
      // Preset choices and names are independent of AI availability and concurrency.
      if (pathname === "/api/names")
        return json(response, 200, { names: presets.names });
      const fixed = definitions.find((q) => q.id === input.question?.id);
      if (pathname === "/api/suggestions" && fixed) {
        return json(response, 200, {
          questionId: fixed.id,
          pool: presets.banks[fixed.id].map((text, index) => ({
            id: `${fixed.id}_preset_${index}`,
            text,
            origin: "preset",
          })),
        });
      }
      if (!process.env.DEEPSEEK_API_KEY)
        return json(response, 503, {
          error: "AI is not configured on this server. Your answers are saved.",
        });
      const { requestId, taskToken, ...brief } = input;
      const accepted = await queue.enqueue({
        type: pathname,
        input: brief,
        requestId,
        token: taskToken,
      });
      return json(response, 202, accepted);
    }
    if (!["GET", "HEAD"].includes(request.method))
      return json(response, 405, { error: "Method not allowed." });
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    // An allowlist keeps logs, server scripts and environment files private.
    if (!assets.has(name))
      return json(response, 404, { error: "File not found." });
    const content = await fs.readFile(path.join(root, name));
    response.writeHead(200, {
      "Content-Type": types[path.extname(name)] || "text/plain",
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    json(response, error.status || 400, {
      error: error.message || "Unable to complete this request.",
    });
  }
});
server.listen(
  Number(process.env.PORT || 3013),
  process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  () => {
    console.log(`StorySpring: http://127.0.0.1:${process.env.PORT || 3013}`);
  },
);
