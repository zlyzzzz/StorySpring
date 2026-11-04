import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateNames } from "./names.mjs";
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
  "styles.css",
  "ui.js",
  "questions.json",
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
let activeRequests = 0;

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
        targetWords: 3000,
      });
    }
    if (pathname.startsWith("/api/") && request.method === "POST") {
      if (
        ![
          "/api/followup",
          "/api/generate",
          "/api/suggestions",
          "/api/names",
        ].includes(pathname)
      )
        return json(response, 404, { error: "Unknown endpoint." });
      const origin = request.headers.origin;
      // HTTPS may terminate at the hosting proxy before reaching this HTTP server.
      if (origin && new URL(origin).host !== request.headers.host)
        return json(response, 403, {
          error: "Use this website to send a request.",
        });
      if (activeRequests >= 3)
        return json(response, 429, {
          error: "The server is busy. Please retry shortly.",
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
      activeRequests++;
      try {
        const result =
          pathname === "/api/suggestions"
            ? await generateSuggestions(input)
            : pathname === "/api/followup"
              ? await generateFollowup(input)
              : pathname === "/api/names"
                ? await generateNames(input)
                : await generateStory(input);
        return json(response, 200, result);
      } finally {
        activeRequests--;
      }
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
    json(response, 400, {
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
