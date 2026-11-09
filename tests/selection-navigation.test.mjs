import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Run the actual app and its event handlers with a minimal page shell.
const nodes = new Map();
const handlers = new Map();
const node = (selector) => {
  if (!nodes.has(selector)) nodes.set(selector, {
    innerHTML: "", textContent: "", hidden: false,
    addEventListener() {}, setAttribute() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  });
  return nodes.get(selector);
};
globalThis.document = {
  hidden: false,
  querySelector: node,
  querySelectorAll: () => [],
  createElement: () => node("tooltip"),
  body: { append() {} },
  addEventListener(name, handler) {
    handlers.set(name, [...(handlers.get(name) || []), handler]);
  },
};
globalThis.window = { scrollY: 0, scrollTo() {}, addEventListener() {} };
globalThis.innerWidth = 1200;
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = () => 0;
const originalFetch = globalThis.fetch;
const originalInterval = globalThis.setInterval;
globalThis.fetch = async (path) => ({
  json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
});
globalThis.setInterval = () => 0;
let source = await readFile(new URL("../app.js", import.meta.url), "utf8");
source = source.replace(/from "(\.\/[^\"]+)"/g, (_, path) =>
  `from "${new URL(`../${path.slice(2)}`, import.meta.url).href}"`);
source += `\nexport { state, library, startNewStory, refreshSuggestions,
  moveSuggestionBatch, showCurrentSelection, resetQuestion, questionView,
  optionBatchHistory, rememberPosition, navigate, restoreRoute, captureRoute,
  reader, savedStories, highlightedStory, showOriginalPrompt };`;
const app = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
globalThis.fetch = originalFetch;
globalThis.setInterval = originalInterval;

async function click(dataset) {
  const button = { dataset };
  for (const handler of handlers.get("click")) {
    await handler({ target: { closest: (selector) => selector === "button" ? button : null } });
  }
}
function input(value, option) {
  for (const handler of handlers.get("input")) handler({ target: {
    id: option === undefined ? "own" : "",
    value, dataset: { option },
    matches: () => option !== undefined,
  } });
}
function begin() {
  app.startNewStory("characters");
}

test("Homepage and complete editor still render", () => {
  assert.match(node("#app").innerHTML, /Start a new story/);
  begin();
  const html = node("#app").innerHTML;
  for (const content of ["sidebar", "Character name", "Your own answer", "Save and continue", "Story map", "Current selection", "Next suggestions"]) {
    assert.ok(html.includes(content), content);
  }
  assert.equal((html.match(/data-option=/g) || []).length, 3);
  assert.doesNotMatch(html, /New suggestions/);
});

test("Only the latest chosen page is selected, including repeated back/forward navigation", async () => {
  begin();
  await click({ select: "0" });
  await app.refreshSuggestions();
  await click({ select: "1" });
  const chosen = structuredClone(app.state.candidates);
  app.moveSuggestionBatch(-1);
  assert.equal(app.state.selected, -1);
  assert.doesNotMatch(node("#app").innerHTML, /aria-pressed="true"/);
  app.showCurrentSelection();
  assert.deepEqual(app.state.candidates, chosen);
  assert.equal(app.state.selected, 1);
  app.moveSuggestionBatch(-1);
  await click({ select: "2" });
  app.moveSuggestionBatch(1);
  assert.equal(app.state.selected, -1);
  app.showCurrentSelection();
  assert.equal(app.state.batch, 0);
  assert.equal(app.state.selected, 2);
});

test("Current selection restores custom text and edited suggestions on their original pages", async () => {
  begin();
  input("My own answer on the first page");
  await app.refreshSuggestions();
  app.showCurrentSelection();
  assert.equal(app.state.batch, 0);
  assert.equal(app.state.selected, 3);
  assert.equal(app.state.own, "My own answer on the first page");
  app.moveSuggestionBatch(1);
  input("My edited suggestion", "1");
  app.moveSuggestionBatch(-1);
  assert.equal(app.state.selected, -1);
  app.showCurrentSelection();
  assert.equal(app.state.batch, 1);
  assert.equal(app.state.selected, 1);
  assert.equal(app.state.candidates[1], "My edited suggestion");
});

test("Reopening and serialized storage preserve the browsing position and latest choice", async () => {
  begin();
  await click({ select: "0" });
  await app.refreshSuggestions();
  input("Latest custom choice");
  app.moveSuggestionBatch(-1);
  app.rememberPosition();
  // Simulate localStorage's JSON round trip before reopening the question.
  const record = app.library.records.find((record) => record.id === app.library.currentId);
  record.suggestionHistory = JSON.parse(JSON.stringify(record.suggestionHistory));
  app.resetQuestion(true);
  app.questionView();
  assert.equal(app.state.batch, 0);
  assert.equal(app.state.selected, -1);
  app.showCurrentSelection();
  assert.equal(app.state.batch, 1);
  assert.equal(app.state.own, "Latest custom choice");
  assert.equal(app.state.selected, 3);
});

test("Legacy historical selections never override the current choice", async () => {
  begin();
  await click({ select: "0" });
  await app.refreshSuggestions();
  await click({ select: "2" });
  app.optionBatchHistory().past[0].selected = 0;
  app.moveSuggestionBatch(-1);
  assert.equal(app.state.selected, -1);
  app.moveSuggestionBatch(1);
  assert.equal(app.state.selected, 2);
});

test("Free Writing saved cards and reader use the original prompt, not choice labels", () => {
  const quote = "Mira left a lantern in the window.";
  const record = {
    id: "free-reader-test", mode: "free", title: "Lantern (1)",
    free: "End with hope. <Keep this verbatim>", answers: {},
    story: `Lantern\n\n${quote}`, updatedAt: new Date().toISOString(), activeMs: 22000,
    promptAnnotations: [{ start: 9, end: 9 + quote.length, quote, promptExcerpt: "End with hope." }],
  };
  app.library.records = [record];
  app.library.currentId = record.id;
  app.state.showDeleted = false;
  app.savedStories();
  assert.match(node("#app").innerHTML, />View prompt</);
  assert.doesNotMatch(node("#app").innerHTML, /0 answers|>View choices</);
  app.state.marked = true;
  app.reader();
  const html = node("#app").innerHTML;
  assert.match(html, /Show full prompt/);
  assert.match(html, /Your original prompt/);
  assert.match(html, /From your prompt: End with hope\./);
  assert.match(html, /Download prompt & story/);
  assert.doesNotMatch(html, /Show choice markers|View my choices|Download questions & choices|Selected option:/);
  assert.match(html, /&lt;Keep this verbatim&gt;/);
  app.showOriginalPrompt(record.id);
  assert.equal(node("#original-prompt-text").textContent, record.free);
  assert.equal(node("#prompt-dialog").open, true);
  app.state.marked = false;
  assert.doesNotMatch(app.highlightedStory(record), /<mark/);
  record.free = "A completely different prompt";
  app.state.marked = true;
  assert.doesNotMatch(app.highlightedStory(record), /<mark/);
});
