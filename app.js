import { queuedRequest } from "./task-client.js";
import { descendantIds, pruneDescendants } from "./branch-state.js";
import {
  modificationInfo,
  modifiedAnswerCount,
  changedSegments,
} from "./answer-edits.js";
import {
  rotatingBatch,
  unseenBatch,
  ADAPTIVE_BATCH_SIZE,
  ADAPTIVE_OPTION_LIMIT,
  OPTION_BANK_SIZE,
  coreBankSize,
} from "./option-rules.js";
import { escape, icon, leaf } from "./ui.js";
import {
  loadLibrary,
  makeRecord,
  persistLibrary,
  forkStory,
  saveGeneratedVersion,
} from "./story-storage.js";
import { coreProgress } from "./core-progress.js";
import {
  contextChanged,
  suggestionBatch,
  answerProvenance,
  nextCountReminder,
} from "./answer-state.js";

const data = await fetch("questions.json").then((response) => response.json());
const presets = await fetch("core-options.json").then((response) =>
  response.json(),
);
const presetPool = (id) =>
  (presets.banks[id] || []).map((text, index) => ({
    id: `${id}_preset_${index}`,
    text,
    origin: "preset",
  }));
const categories = data.categories;
const questions = data.questions;

const app = document.querySelector("#app");
const library = loadLibrary();
// Pending network work cannot survive a page reload; saved alignment results can.
for (const record of library.records) delete record.annotationBusy;
document
  .querySelector("#refresh-dialog")
  .addEventListener("cancel", (event) => event.preventDefault());

// Keep the generation snapshot stable until the completed version has been saved.
document
  .querySelector("#generation-dialog")
  .addEventListener("cancel", (event) => {
    event.preventDefault();
  });
const state = {
  view: "home",
  category: "setting",
  phase: "core",
  index: 0,
  selected: -1,
  batch: 0,
  candidates: [],
  candidateMeta: [],
  own: "",
  editingId: null,
  reviewMode: innerWidth < 700 ? "list" : "map",
  reviewOrigin: null,
  editOrigin: null,
  continueOrigin: null,
  readerOrigin: null,
  pendingDelete: null,
  pendingRecordDelete: null,
  undo: null,
  marked: false,
  exportBusy: false,
  paused: false,
  lastTick: Date.now(),
  showDeleted: false,
  downloadRecordId: null,
  pendingFollowups: new Set(),
  followupErrors: {},
  generationBusy: false,
  refreshBusy: false,
  pendingBanks: new Set(),
  bankErrors: {},
  pendingEdit: null,
  reminderMode: "core",
  pendingExtraSave: false,
};

const categoryById = (id) => categories.find((category) => category[0] === id);
const questionById = (id) =>
  currentRecord()?.adaptiveQuestions?.find((question) => question.id === id) ||
  questions.find((question) => question.id === id);
const listFor = (category, phase) =>
  phase === "extra"
    ? (currentRecord()?.adaptiveQuestions || []).filter(
        (question) => question.category === category,
      )
    : questions.filter(
        (question) =>
          question.category === category &&
          question.extension === (phase === "extra"),
      );
const currentRecord = () =>
  library.records.find((record) => record.id === library.currentId);
const answers = () => currentRecord()?.answers || {};
const hasText = (value) => typeof value === "string" && value.trim().length > 0;
const answerCount = () =>
  Object.entries(answers()).filter(
    ([id, value]) => questionById(id) && hasText(value),
  ).length;
const canGenerate = () =>
  currentRecord()?.mode === "free"
    ? hasText(currentRecord()?.free)
    : coreProgress(questions, answers()).ready;

function minimumMessage() {
  const { remaining } = coreProgress(questions, answers(), state.category);
  return remaining
    ? `${remaining} required ${remaining === 1 ? "answer" : "answers"} left in this category`
    : "Minimum reached";
}

function requiredProgressBar() {
  const { completed, total } = coreProgress(questions, answers());
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return `<div class="required-progress"><div class="required-progress-label"><span>Required answers for story generation</span><strong>${completed} / ${total}</strong></div><div class="required-progress-track" role="progressbar" aria-label="Required answers for story generation" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}" aria-valuetext="${completed} of ${total} required answers completed"><span style="width:${percent}%"></span></div></div>`;
}

function editableRecord() {
  const record = currentRecord();
  if (!record?.story) return record;
  const draft = forkStory(record);
  library.records.unshift(draft);
  library.currentId = draft.id;
  return draft;
}

function ensureRecord(mode = "guided") {
  let record = currentRecord();
  if (!record || record.deletedAt || record.mode !== mode || record.story) {
    record = library.records.find(
      (item) => item.mode === mode && !item.story && !item.deletedAt,
    );
    if (!record) {
      record = makeRecord(mode);
      library.records.unshift(record);
    }
    library.currentId = record.id;
  }
  record.progress ||= {};
  if (record.coreSchemaVersion !== 6) {
    record.progress = {};
    record.coreSchemaVersion = 6;
  }
  record.optionSnapshots ||= {};
  record.answerParents ||= {};
  record.activeMs ||= 0;
  record.adaptiveQuestions ||= [];
  return record;
}

function persist(changed = false) {
  if (changed && currentRecord())
    currentRecord().updatedAt = new Date().toISOString();
  try {
    persistLibrary(library);
  } catch {
    toast(
      "This browser could not save the draft. Export your choices before closing.",
    );
  }
}

function toast(message, canUndo = false) {
  const element = document.querySelector("#toast");
  element.innerHTML =
    escape(message) +
    (canUndo ? ' <button id="undo" class="toast-undo">Undo</button>' : "");
  element.style.display = "block";
  clearTimeout(window.toastTimeout);
  window.toastTimeout = setTimeout(() => {
    element.style.display = "none";
  }, 5000);
}

function isTiming() {
  const editing =
    state.view === "free" ||
    (state.view === "question" &&
      !rawQuestion()?.loading &&
      optionBankReady(rawQuestion()));
  return (
    editing &&
    !document.hidden &&
    !state.paused &&
    !state.refreshBusy &&
    !document.querySelector("dialog[open]")
  );
}

function settleTime() {
  const now = Date.now();
  if (isTiming() && currentRecord())
    currentRecord().activeMs =
      (currentRecord().activeMs || 0) + Math.max(0, now - state.lastTick);
  state.lastTick = now;
}

function duration(milliseconds = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function progressFor(category = state.category) {
  const record = currentRecord();
  record.progress ||= {};
  if (!record.progress[category]) {
    const core = listFor(category, "core");
    const index = core.findIndex(
      (question) => !hasText(record.answers[question.id]),
    );
    record.progress[category] = {
      phase: index < 0 ? "extra" : "core",
      index: index < 0 ? 0 : index,
      extraCompleted: listFor(category, "extra").filter((question) =>
        hasText(record.answers[question.id]),
      ).length,
      lastReminder: 0,
      coreNoticeShown: index < 0,
    };
  }
  return record.progress[category];
}

// Persist generated questions per category. There is no artificial question-count cap.
function rawQuestion() {
  if (state.editingId) return questionById(state.editingId);
  if (state.phase === "extra" && currentRecord()) {
    const id = `${state.category}_adaptive_${state.index + 1}`;
    const question = currentRecord().adaptiveQuestions.find(
      (item) => item.id === id,
    );
    if (
      question &&
      (hasText(answers()[id]) || !contextChanged(question, currentRecord()))
    )
      return question;
    return { id, category: state.category, loading: true, options: [] };
  }
  return listFor(state.category, state.phase)[state.index];
}

function answeredDefinitions(record) {
  return Object.keys(record.answers)
    .map(
      (id) =>
        record.adaptiveQuestions?.find((q) => q.id === id) ||
        questions.find((q) => q.id === id) || {
          id,
          question: record.optionSnapshots?.[id]?.question || id,
        },
    )
    .map(({ id, category, question, parentId, extension }) => ({
      id,
      category,
      question,
      extension,
      parentId: record.answerParents?.[id] || parentId,
    }));
}

async function postApi(endpoint, body) {
  return queuedRequest(endpoint, body);
}

async function requestFollowup() {
  const pending = rawQuestion();
  if (!pending?.loading) return;
  const record = currentRecord();
  const key = `${record.id}:${pending.id}`;
  if (state.pendingFollowups.has(key) || state.followupErrors[key]) return;
  state.pendingFollowups.add(key);
  const context = JSON.stringify(record.answers);
  try {
    const question = await postApi("/api/followup", {
      category: state.category,
      index: state.index,
      answers: { ...record.answers },
      name: record.name,
      definitions: answeredDefinitions(record),
    });
    if (JSON.stringify(record.answers) !== context) return;
    record.adaptiveQuestions = record.adaptiveQuestions.filter(
      (item) => item.id !== question.id,
    );
    record.adaptiveQuestions.push(question);
    // A regenerated question must not inherit a bank prepared for its old context.
    if (record.suggestionPools) delete record.suggestionPools[question.id];
    persist(true);
    if (
      currentRecord()?.id === record.id &&
      state.view === "question" &&
      rawQuestion()?.id === question.id
    ) {
      resetQuestion();
    }
  } catch (error) {
    state.followupErrors[key] = error.message;
  } finally {
    state.pendingFollowups.delete(key);
    if (state.view === "question" && currentRecord()?.id === record.id)
      render();
  }
}

function currentQuestion() {
  return rawQuestion();
}

function candidatePool(question) {
  return fullSuggestionPool(question).map((option) => option.text);
}

function fullSuggestionPool(question) {
  const pool =
    (!question.extension ? presetPool(question.id) : null) ||
    currentRecord()?.suggestionPools?.[question.id]?.pool ||
    question.pool ||
    [];
  // Preserve old answers while constraining legacy fifty-option extension banks to forty-five.
  return question.extension ? pool.slice(0, ADAPTIVE_OPTION_LIMIT) : pool;
}

function rememberShownOptions() {
  const question = currentQuestion();
  const record = currentRecord();
  if (!question || question.loading || !record || !optionBankReady(question))
    return;
  record.suggestionHistory ||= {};
  const history = (record.suggestionHistory[question.id] ||= {
    texts: [],
    cycleTexts: [],
  });
  const texts = [
    ...new Set([
      ...history.texts,
      ...state.candidates,
      ...state.candidateMeta.map((option) => option.text),
    ]),
  ];
  history.cycleTexts = [
    ...new Set([...(history.cycleTexts || []), ...state.candidates]),
  ];
  if (texts.length !== history.texts.length) {
    history.texts = texts;
    persist();
  }
}

function optionBankReady(question) {
  return Boolean(
    question &&
    !question.loading &&
    (question.extension
      ? fullSuggestionPool(question).length >= ADAPTIVE_BATCH_SIZE
      : fullSuggestionPool(question).length === coreBankSize(question.id)),
  );
}

async function requestOptionBank() {
  const question = currentQuestion();
  if (!question || question.loading || optionBankReady(question)) return;
  const record = currentRecord();
  const key = `${record.id}:${question.id}`;
  if (state.pendingBanks.has(key) || state.bankErrors[key]) return;
  state.pendingBanks.add(key);
  const context = JSON.stringify(record.answers);
  try {
    const result = await postApi("/api/suggestions", {
      question: {
        id: question.id,
        category: question.category,
        question: question.question,
      },
      answers: { ...record.answers },
      excludedTexts: [],
      name: record.name || "",
    });
    if (
      result.pool.length !==
      (question.extension ? ADAPTIVE_BATCH_SIZE : coreBankSize(question.id))
    )
      throw new Error("The suggestion batch is incomplete. Please retry.");
    if (JSON.stringify(record.answers) !== context) return;
    record.suggestionPools ||= {};
    record.suggestionPools[question.id] = result;
    persist(true);
    if (
      state.view === "question" &&
      currentRecord()?.id === record.id &&
      currentQuestion()?.id === question.id
    )
      resetQuestion(true);
  } catch (error) {
    state.bankErrors[key] = error.message;
  } finally {
    state.pendingBanks.delete(key);
    if (state.view === "question" && currentRecord()?.id === record.id)
      render();
  }
}

// Each question keeps its own browser-local batch history. Saving full editor
// snapshots lets users return without losing edits, selected options or free text.
function optionBatchHistory() {
  const question = currentQuestion();
  const record = currentRecord();
  if (!question || question.loading || !record) return null;
  record.suggestionHistory ||= {};
  const history = (record.suggestionHistory[question.id] ||= {
    texts: [],
    cycleTexts: [],
  });
  const context = JSON.stringify({
    bankVersion: presets.version,
    parent: question.adaptive ? question.contextSnapshot : null,
    name: question.adaptive ? question.contextName : null,
  });
  if (history.batchNavigation?.context !== context) {
    history.batchNavigation = { context, past: [], future: [] };
  }
  return history.batchNavigation;
}

function captureSuggestionBatch() {
  return structuredClone({
    candidates: state.candidates,
    candidateMeta: state.candidateMeta,
    selected: state.selected,
    own: state.own,
    batch: state.batch,
  });
}

function moveSuggestionBatch(direction) {
  if (state.refreshBusy || !optionBankReady(currentQuestion())) return;
  const history = optionBatchHistory();
  if (!history) return;
  const source = direction < 0 ? history.past : history.future;
  const destination = direction < 0 ? history.future : history.past;
  if (!source.length) return;
  destination.push(captureSuggestionBatch());
  Object.assign(state, source.pop());
  rememberShownOptions();
  rememberPosition();
  persist();
  questionView();
}

async function refreshSuggestions() {
  const question = currentQuestion();
  if (!optionBankReady(question) || state.refreshBusy) return;
  // Revisiting an existing batch never requests more AI suggestions.
  if (optionBatchHistory()?.future.length) {
    moveSuggestionBatch(1);
    return;
  }
  if (state.selected >= 0 || state.own.trim()) {
    settleTime();
    state.paused = true;
    const confirmed = confirm(
      "Replace these suggestions and clear the current unsaved wording?",
    );
    state.paused = false;
    state.lastTick = Date.now();
    if (!confirmed) return;
  }
  rememberShownOptions();
  const record = currentRecord();
  const history = record.suggestionHistory[question.id];
  let result;
  if (!question.extension) {
    result = rotatingBatch(
      fullSuggestionPool(question),
      history.cycleTexts || history.texts,
      state.candidates,
    );
    history.cycleTexts = result.cycleTexts;
  } else {
    let pool = fullSuggestionPool(question);
    let batch = unseenBatch(pool, history.texts);
    if (!batch && pool.length < ADAPTIVE_OPTION_LIMIT) {
      const dialog = document.querySelector("#refresh-dialog");
      const context = JSON.stringify(record.answers);
      settleTime();
      state.refreshBusy = true;
      dialog.showModal();
      try {
        const extra = await postApi("/api/suggestions", {
          question: {
            id: question.id,
            category: question.category,
            question: question.question,
          },
          answers: { ...record.answers },
          name: record.name || "",
          generatedCount: pool.length,
          excludedTexts: [
            ...new Set([
              ...pool.map((option) => option.text),
              ...history.texts,
            ]),
          ],
        });
        if (extra.pool?.length !== ADAPTIVE_BATCH_SIZE)
          throw new Error("The new batch is incomplete. Please retry.");
        if (JSON.stringify(record.answers) !== context)
          throw new Error("Your answers changed. Please reopen this question.");
        pool = [...pool, ...extra.pool];
        record.suggestionPools ||= {};
        record.suggestionPools[question.id] = { ...extra, pool };
        persist();
        batch = unseenBatch(pool, history.texts);
      } catch (error) {
        toast(error.message);
        return;
      } finally {
        state.refreshBusy = false;
        dialog.close();
        state.lastTick = Date.now();
      }
    }
    if (!batch) {
      toast(
        "All 45 suggestions have been shown. You can edit a suggestion or write your own answer.",
      );
      return;
    }
    result = { batch };
  }
  // Only add a history entry after a replacement batch is ready.
  // A failed request leaves the currently visible suggestions untouched.
  const navigation = optionBatchHistory();
  navigation.past.push(captureSuggestionBatch());
  navigation.future = [];
  state.candidateMeta = result.batch;
  state.candidates = result.batch.map((option) => option.text);
  state.selected = -1;
  state.own = "";
  state.batch++;
  rememberShownOptions();
  rememberPosition();
  persist();
  questionView();
}

function resetQuestion(useScratch = false) {
  const question = currentQuestion();
  state.selected = -1;
  state.batch = 0;
  state.own = "";
  const pool =
    question && !question.loading ? fullSuggestionPool(question) : [];
  const previousTexts =
    currentRecord()?.suggestionHistory?.[question?.id]?.texts || [];
  state.candidateMeta =
    pool.length >= 3
      ? question.extension
        ? unseenBatch(pool, previousTexts) || suggestionBatch(pool)
        : suggestionBatch(pool)
      : [];
  state.candidates = state.candidateMeta.map((option) => option.text);
  if (!question) return;
  if (question.loading) {
    requestFollowup();
    return;
  }

  const scratch = !state.editingId && useScratch ? progressFor().scratch : null;
  if (
    scratch?.questionId === question.id &&
    scratch.candidates?.length === 3 &&
    (!question.adaptive ||
      scratch.contextSignature === JSON.stringify(question.contextSnapshot))
  ) {
    Object.assign(state, {
      candidates: scratch.candidates,
      candidateMeta: scratch.candidateMeta || [],
      own: scratch.own,
      selected: scratch.selected,
      batch: scratch.batch,
    });
    return;
  }
  // Restore an edited suggestion in its original slot, independently of free input.
  const snapshot = currentRecord().optionSnapshots?.[question.id];
  if (snapshot?.options?.length === 3) {
    state.candidates = [...snapshot.options];
    state.candidateMeta = structuredClone(snapshot.suggestions || []);
    if (Number.isInteger(snapshot.selectedIndex)) {
      state.selected = snapshot.selectedIndex;
      state.own = snapshot.own || "";
      return;
    }
  }
  const previous = answers()[question.id];
  if (hasText(previous)) {
    const index = state.candidates.indexOf(previous);
    state.selected = index >= 0 ? index : 3;
    state.own = index >= 0 ? "" : previous;
  }
}

function rememberPosition() {
  if (state.view !== "question" || state.editingId || !currentRecord()) return;
  const progress = progressFor();
  currentRecord().lastCategory = state.category;
  progress.phase = state.phase;
  progress.index = state.index;
  const question = currentQuestion();
  progress.scratch = question
    ? {
        questionId: question.id,
        candidates: [...state.candidates],
        candidateMeta: structuredClone(state.candidateMeta),
        own: state.own,
        selected: state.selected,
        batch: state.batch,
        contextSignature: JSON.stringify(question.contextSnapshot || null),
      }
    : null;
}

function captureRoute() {
  return {
    view: state.view,
    reviewMode: state.reviewMode,
    showDeleted: state.showDeleted,
    marked: state.marked,
    recordId: library.currentId,
    category: state.category,
    phase: state.phase,
    index: state.index,
    selected: state.selected,
    candidates: [...state.candidates],
    candidateMeta: structuredClone(state.candidateMeta),
    own: state.own,
    batch: state.batch,
    scroll: window.scrollY,
    questionId: currentQuestion()?.id,
    questionContext: JSON.stringify(currentQuestion()?.contextSnapshot || null),
  };
}

function restoreRoute(route) {
  settleTime();
  if (
    !route ||
    (route.recordId &&
      !library.records.some((record) => record.id === route.recordId))
  ) {
    state.view = "home";
  } else {
    library.currentId = route.recordId;
    Object.assign(state, {
      view: route.view,
      reviewMode: route.reviewMode || state.reviewMode,
      showDeleted: route.showDeleted || false,
      marked: route.marked || false,
      category: route.category,
      phase: route.phase,
      index: route.index,
      selected: route.selected,
      candidates: [...route.candidates],
      candidateMeta: structuredClone(route.candidateMeta || []),
      own: route.own,
      batch: route.batch,
      editingId: null,
    });
  }
  if (
    route?.view === "question" &&
    currentQuestion()?.adaptive &&
    route.questionContext !== JSON.stringify(currentQuestion().contextSnapshot)
  ) {
    // Keep unsaved user wording as a custom answer when the parent context changes.
    const wording =
      route.selected === 3
        ? route.own
        : route.selected >= 0
          ? route.candidates[route.selected]
          : "";
    resetQuestion();
    if (hasText(wording)) {
      state.own = wording;
      state.selected = 3;
    }
  }
  render();
  requestAnimationFrame(() => window.scrollTo({ top: route?.scroll || 0 }));
}

function navigate(view) {
  if (view === "home" || view === "saved") state.continueOrigin = null;
  settleTime();
  rememberPosition();
  persist();
  state.editingId = null;
  if (view === "review") state.reviewOrigin = captureRoute();
  if (view === "free") ensureRecord("free");
  state.view = view;
  render();
}

function startNewStory(category) {
  state.continueOrigin = null;
  settleTime();
  rememberPosition();
  const record = makeRecord("guided");
  library.records.unshift(record);
  library.currentId = record.id;
  startCategory(category);
}

function startCategory(category) {
  settleTime();
  rememberPosition();
  if (state.view === "review" && currentRecord()?.story) editableRecord();
  ensureRecord("guided");
  state.category = category;
  currentRecord().lastCategory = category;
  state.editingId = null;
  const progress = progressFor(category);
  state.phase = progress.phase;
  state.index = progress.index;
  state.view = "question";
  resetQuestion(true);
  persist();
  render();
}

function renderNavigation() {
  document.querySelector("#page-home-container").hidden = state.view === "home";
  const saved = `<button data-view="saved">${icon("saved")}Saved stories</button>`;
  const active = ["question", "free"].includes(state.view);
  const hideSaved = ["saved", "read"].includes(state.view);
  document.querySelector("#main-navigation").innerHTML =
    `${hideSaved ? "" : saved}${active ? `<span class="timer" aria-label="Time spent">${icon("clock")} <span id="timer">${duration(currentRecord()?.activeMs)}</span></span>` : ""}`;
}

function categoryCards() {
  return `<div class="paths"><svg class="branch" viewBox="0 0 1100 140" preserveAspectRatio="none" aria-hidden="true"><path d="M0 75C100-25 170 150 270 70S430 5 520 72 700 138 790 65 1000 5 1100 75"/></svg>${categories.map(([id, name, , description, count]) => `<button class="category" ${state.view === "home" ? `data-new-category="${id}"` : `data-category="${id}"`}>${icon(id)}<strong>${name.replace(" & ", " &<br> ")}</strong><small>${description}</small><span class="count">${count} core details · Explore more if you wish</span></button>`).join("")}</div>`;
}

function home() {
  app.innerHTML = `<section class="hero"><div><p class="eyebrow">Your ideas, taking shape</p><h1>Every story starts<br>somewhere.</h1><p>Choose a starting point. Shape the suggestions in your own words, then follow your curiosity.</p></div>${leaf}</section><section><div class="section-head"><h2>Start a new story</h2><p>Choose a category to begin a new story.</p></div>${categoryCards()}</section><div class="how"><div><strong><b>01</b> Pick a starting point</strong>Begin with a person, a place, an idea or a voice.</div><div><strong><b>02</b> Make it yours</strong>Choose, edit or write your own details.</div><div><strong><b>03</b> See your story grow</strong>Connect your ideas, then turn them into a story.</div></div><div class="secondary-entry"><button class="link" data-view="free">Prefer to write your own brief? Try free writing →</button></div>`;
}

function categoryAnswerCount(category) {
  return Object.entries(answers()).filter(
    ([id, value]) => questionById(id)?.category === category && hasText(value),
  ).length;
}

function sidebar() {
  return `<aside class="sidebar">${categories.map(([id, name]) => `<button class="${id === state.category ? "active" : ""}" data-category="${id}">${icon(id)}<span>${name}<small>Required: ${listFor(id, "core").length}<br>Completed: ${categoryAnswerCount(id)}</small></span></button>`).join("")}<div class="foot"></div></aside>`;
}

function questionView() {
  rememberShownOptions();
  const question = currentQuestion();
  const category = categoryById(state.category);
  let card;

  if (question && !question.loading && !optionBankReady(question)) {
    requestOptionBank();
    const key = `${currentRecord().id}:${question.id}`;
    const error = state.bankErrors[key];
    card = `<div class="question-card">${requiredProgressBar()}
      <h2>${escape(question.question)}</h2>
      <p role="status">${error ? escape(error) : "Preparing suggestions for this question…"}</p>
      ${error ? '<button id="retry-bank">Try again</button>' : ""}
      <div class="actions"></div></div>`;
  } else if (question?.loading) {
    const key = `${currentRecord().id}:${question.id}`;
    const error = state.followupErrors[key];
    card = `<div class="question-card">${requiredProgressBar()}
      <h2>${error ? "Your answers are safe." : "Following your ideas…"}</h2>
      <p>${error ? escape(error) : "Finding a useful next question based on your answers."}</p>
      ${error ? '<button id="retry-followup">Try again</button>' : '<p role="status">Preparing suggestions…</p>'}
      <div class="actions"><button data-view="review">Review my choices</button>
      ${canGenerate() ? '<button class="primary" id="generate">Generate my story →</button>' : ""}</div></div>`;
  } else if (question) {
    const parentAnswer = question.adaptive
      ? question.contextSnapshot?.[question.parentId]
      : null;
    const context = parentAnswer
      ? `
      <div class="adaptive-context">
        <small>Following your answer</small>
        <p>${escape(parentAnswer)}</p>
      </div>`
      : "";
    const options = state.candidates
      .map(
        (value, index) => `
      <div class="option ${state.selected === index ? "selected" : ""}">
        <button class="select-dot" data-select="${index}"
          aria-label="Select suggestion ${index + 1}" aria-pressed="${state.selected === index}"></button>
        <textarea aria-label="Edit suggestion ${index + 1}" data-option="${index}" rows="1">${escape(value)}</textarea>
        <button data-edit-option="${index}">Edit</button>
      </div>`,
      )
      .join("");
    const nameField =
      question.id === "role"
        ? `
      <div class="name-row">
        <label for="name">Character name <span class="muted">(optional)</span></label>
        <input id="name" value="${escape(currentRecord().name)}" placeholder="Give them a name">
        <button id="name-suggestion">Suggest a name</button>
      </div>`
        : "";
    card = `
      <div class="question-card">
        ${requiredProgressBar()}
        <div class="row">
          <p class="category-minimum">${minimumMessage()}</p>
          <span class="chip">Total: ${answerCount()} answers</span>
        </div>
        ${context}
        <h2>${escape(question.question)}</h2>
        <p class="hint">Select one suggestion. Edit its wording, or write your own answer.</p>
        ${nameField}
        <div class="options">${options}</div>
        <div class="tools"><button id="previous-batch" ${!optionBatchHistory()?.past.length || state.refreshBusy ? "disabled" : ""}>← Previous suggestions</button><button id="refresh" ${!optionBatchHistory()?.future.length && question.extension && fullSuggestionPool(question).length >= ADAPTIVE_OPTION_LIMIT && !unseenBatch(fullSuggestionPool(question), currentRecord().suggestionHistory?.[question.id]?.texts || []) ? "disabled" : ""}>↻ New suggestions</button>${question.extension && fullSuggestionPool(question).length >= ADAPTIVE_OPTION_LIMIT && !unseenBatch(fullSuggestionPool(question), currentRecord().suggestionHistory?.[question.id]?.texts || []) ? '<span class="small-note">All 45 suggestions shown. You can still edit or write your own.</span>' : ""}</div>
        <div class="option own-option ${state.selected === 3 ? "selected" : ""}">
          <button class="select-dot" data-select="3" aria-label="Select your own answer" aria-pressed="${state.selected === 3}"></button>
          <div><label for="own">Your own answer</label><textarea rows="2" id="own" placeholder="Write your own answer…" aria-label="Your own answer">${escape(state.own)}</textarea></div>
        </div>
        <div class="actions">
          <button id="previous" ${!state.editingId && (categoryAnswerCount(state.category) === 0 || (state.phase === "core" && state.index === 0)) ? "disabled" : ""}>← Previous question</button>
          <button class="primary" id="next" ${!hasText(state.selected === 3 ? state.own : state.candidates[state.selected]) ? "disabled" : ""}>
            ${state.editingId ? "Save and return" : "Save and continue →"}
          </button>
        </div>
        ${canGenerate() ? '<div class="generate-footer"><button class="primary" id="generate">Generate my story →</button></div>' : ""}
      </div>`;
  } else {
    const characterLimit =
      state.category === "characters" && state.phase === "extra";
    card = `
      <div class="question-card">
        ${requiredProgressBar()}
        <h2>${characterLimit ? "Take a moment to see the whole picture." : "You have explored this category."}</h2>
        <p class="muted">${
          characterLimit
            ? `You have explored additional character details. Review what you have or explore another category.`
            : "Revisit your choices or explore another category."
        }</p>
        <div class="actions">
          <button data-view="categories">Continue editing</button>
          <button data-view="review">Review my story</button>
          ${canGenerate() ? '<button class="primary" id="generate">Generate my story →</button>' : ""}
        </div>
      </div>`;
  }

  app.innerHTML = `
    ${state.continueOrigin ? '<button id="editor-back" class="page-back" aria-label="Back to previous page">← Back</button>' : ""}
    <div class="workspace-head">
      <div><p class="eyebrow">Shape your story</p><h1>${category[1]}</h1></div>
      <button data-view="review">Story map ↗</button>
    </div>
    <div class="workspace">${sidebar()}<section>${card}</section></div>`;
}

function showCategoryReminder(
  core = false,
  threshold = null,
  pendingSave = false,
) {
  settleTime();
  state.reminderMode = threshold ? "count" : "core";
  state.pendingExtraSave = pendingSave;
  document.querySelector("#category-reminder-title").textContent = threshold
    ? "Take a moment to review your story"
    : "Would you like to explore further?";
  document.querySelector("#category-reminder-text").textContent = threshold
    ? `You have added at least ${threshold} answers. Further detail is optional. You can review your choices or keep exploring.`
    : "You have completed the required answers for this category. Continue only if you would like to add more detail.";
  const stop = document.querySelector("#switch-category");
  const keep = document.querySelector("#dismiss-reminder");
  stop.textContent = threshold ? "Review my choices" : "Do not explore further";
  keep.textContent = threshold ? "Keep exploring" : "Continue exploring";
  for (const button of [stop, keep])
    button.setAttribute("aria-pressed", "false");
  document.querySelector("#category-dialog").showModal();
  state.lastTick = Date.now();
}

function branchDefinitions(record = currentRecord()) {
  return [...questions, ...(record.adaptiveQuestions || [])].map(
    (question) => ({
      ...question,
      parentId: parentFor(question.id, record) || question.parentId,
    }),
  );
}

function requestEdit(id) {
  const record = currentRecord();
  const removed = descendantIds(record, id, branchDefinitions(record));
  const count = removed.filter((key) => hasText(record.answers[key])).length;
  state.pendingEdit = id;
  document.querySelector("#branch-edit-description").textContent = count
    ? `Changing this answer will delete ${count} connected follow-up ${count === 1 ? "answer" : "answers"} and their question banks. Other branches will stay. Nothing is deleted if you leave the answer unchanged.`
    : "Changing this answer will remove any follow-up details connected below it. Other branches will stay. Nothing is deleted if you leave the answer unchanged.";
  settleTime();
  document.querySelector("#branch-edit-dialog").showModal();
}

function answerMarkup(id, record = currentRecord()) {
  const info = modificationInfo(record, id);
  const value = record.answers[id];
  if (!info.modified) return escape(value);
  return changedSegments(info.original, value)
    .map((segment) =>
      segment.changed
        ? `<mark class="changed-wording">${escape(segment.text)}</mark>`
        : escape(segment.text),
    )
    .join("");
}

function detailRows(entries) {
  return entries
    .map(([id, value]) => {
      const question = questionById(id);
      return `<div class="detail-row ${modificationInfo(currentRecord(), id).modified ? "user-modified" : ""}"><span class="label">${escape(categoryById(question?.category)?.[1] || "Detail")}<br>${escape(question?.question || id)}${question && contextChanged(question, currentRecord()) ? '<br><em class="review-suggested">Review suggested: an earlier answer changed</em>' : ""}</span><span>${answerMarkup(id)}${modificationInfo(currentRecord(), id).modified ? `<small class="modified-badge">${modificationInfo(currentRecord(), id).label}</small>` : ""}</span><span class="controls"><button data-edit="${id}">Edit</button> <button data-delete="${id}">Delete</button></span></div>`;
    })
    .join("");
}

function parentFor(id, record = currentRecord()) {
  const question = questionById(id);
  if (!question?.extension) return null;
  const selected = record.answers || {};
  const candidate = record.answerParents?.[id] || question.parentId;
  if (
    candidate &&
    hasText(selected[candidate]) &&
    questionById(candidate)?.category === question.category
  )
    return candidate;
  return (
    listFor(question.category, "core").find((item) =>
      hasText(selected[item.id]),
    )?.id || null
  );
}

function categoryMap() {
  const selected = answers();
  function branch(id, children, visited = new Set()) {
    if (visited.has(id)) return "";
    const nextVisited = new Set([...visited, id]);
    const question = questionById(id);
    const parent = parentFor(id);
    const nested = (children[id] || [])
      .map((child) => branch(child, children, nextVisited))
      .join("");
    return `<div class="answer-branch"><div class="map-choice ${modificationInfo(currentRecord(), id).modified ? "user-modified" : ""}" data-node-id="${id}" data-parent-id="${parent || ""}"><button class="map-choice-body" data-edit="${id}"><small>${question.extension ? "Follow-up" : "Basic detail"} · ${escape(question.question)}${contextChanged(question, currentRecord()) ? " · Review suggested" : ""}</small><span>${answerMarkup(id)}${modificationInfo(currentRecord(), id).modified ? `<small class="modified-badge">${modificationInfo(currentRecord(), id).label}</small>` : ""}</span></button><button class="map-delete" data-delete="${id}">Delete</button></div>${nested ? `<div class="answer-children">${nested}</div>` : ""}</div>`;
  }
  return `<p class="map-scroll-hint">Scroll sideways to explore longer branches.</p><div class="category-map">${categories
    .map(([id, name]) => {
      const keys = Object.keys(selected).filter(
        (key) => questionById(key)?.category === id && hasText(selected[key]),
      );
      const children = {};
      const roots = [];
      for (const key of keys) {
        const parent = parentFor(key);
        if (parent && keys.includes(parent) && parent !== key)
          (children[parent] ||= []).push(key);
        else roots.push(key);
      }
      return `<section class="map-lane"><div class="map-scroll"><div class="map-canvas"><svg class="category-connections" aria-hidden="true"></svg><button class="map-category" ${state.view === "home" ? `data-new-category="${id}"` : `data-category="${id}"`}>${icon(id)}<strong>${name}</strong><small>${keys.length} answers completed</small></button><div class="map-core-branches">${roots.length ? roots.map((key) => branch(key, children)).join("") : '<p class="map-empty">Select this category to begin.</p>'}</div></div></div></section>`;
    })
    .join("")}</div>`;
}

let mapResizeObserver;
let mapFrame;

function watchMapLayout() {
  mapResizeObserver?.disconnect();
  mapResizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(mapFrame);
    mapFrame = requestAnimationFrame(drawConnections);
  });
  for (const node of document.querySelectorAll(
    ".map-canvas, .map-choice, .map-category",
  ))
    mapResizeObserver.observe(node);
  document.fonts.ready.then(drawConnections);
}

function drawConnections() {
  for (const canvas of document.querySelectorAll(".map-canvas")) {
    const svg = canvas.querySelector(".category-connections");
    const bounds = canvas.getBoundingClientRect();
    const root = canvas.querySelector(".map-category");
    const nodes = [...canvas.querySelectorAll(".map-choice")];
    const byId = new Map(nodes.map((node) => [node.dataset.nodeId, node]));
    const groups = new Map();
    for (const node of nodes) {
      const parent = byId.get(node.dataset.parentId) || root;
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(node);
    }
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.width = `${bounds.width}px`;
    svg.style.height = `${bounds.height}px`;
    const paths = [];
    for (const [parent, children] of groups) {
      const start = parent.getBoundingClientRect();
      children.sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      );
      children.forEach((node, index) => {
        const end = node.getBoundingClientRect();
        const x1 = start.right - bounds.left;
        const x2 = end.left - bounds.left;
        // Give each child its own ordered source port to avoid merged connection lines.
        const y1 =
          start.top -
          bounds.top +
          (start.height * (index + 1)) / (children.length + 1);
        const y2 = end.top - bounds.top + end.height / 2;
        const bend = Math.max(8, (x2 - x1) * 0.45);
        paths.push(
          `<path data-from="${parent.dataset.nodeId || "category"}" data-to="${node.dataset.nodeId}" d="M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}"/>`,
        );
      });
    }
    svg.innerHTML = paths.join("");
  }
}

function review() {
  const entries = Object.entries(answers());
  const { remaining } = coreProgress(questions, answers());
  const freeMode = currentRecord()?.mode === "free";
  app.innerHTML = `<button class="page-back" id="review-back">← Back</button><div class="row"><div><p class="eyebrow">Make the connections yours</p><h1>Saved story</h1></div>${!freeMode ? `<div class="toggle"><button id="map-mode" class="${state.reviewMode === "map" ? "active" : ""}">Story map</button><button id="list-mode" class="${state.reviewMode === "list" ? "active" : ""}">All choices</button></div>` : ""}</div><p class="muted">Basic answers connect to their follow-up details. Follow a branch to revisit an idea.</p><p class="modification-summary">${modifiedAnswerCount(currentRecord())} ${modifiedAnswerCount(currentRecord()) === 1 ? "answer uses your own wording or has" : "answers use your own wording or have"} been modified by you. Highlighted text shows your changes.</p>${freeMode ? `<div class="draft-summary"><h2>Your writing instructions</h2><p>${escape(currentRecord().free || "No instructions yet.")}</p></div>` : state.reviewMode === "map" ? categoryMap() : `<div class="detail-list">${detailRows(entries) || "<p>No choices yet. Continue editing to begin.</p>"}</div>`}${!freeMode ? requiredProgressBar() : ""}<div class="actions"><button id="continue-editing">Continue editing</button>${canGenerate() ? '<button class="primary" id="generate">Generate my story →</button>' : `<span class="minimum-note">${freeMode ? "Add your writing instructions to generate a story." : `${remaining} more core ${remaining === 1 ? "answer" : "answers"} needed across all categories.`}</span>`}</div>`;
  requestAnimationFrame(() => {
    drawConnections();
    watchMapLayout();
  });
}

function savedStories() {
  const deletedCount = library.records.filter(
    (record) => record.deletedAt,
  ).length;
  const records = library.records
    .filter((record) => Boolean(record.deletedAt) === state.showDeleted)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  app.innerHTML = `<p class="eyebrow">Saved on this browser</p><h1>Saved stories</h1><p class="muted">View your choices, read a story, download your work or restore a deleted record.</p><div class="toggle saved-tabs"><button id="active-records" class="${state.showDeleted ? "" : "active"}">Saved stories</button><button id="deleted-records" class="${state.showDeleted ? "active" : ""}">Recently deleted (${deletedCount})</button></div><div class="saved-list">${records.map((record) => `<article class="saved-card" data-record-id="${record.id}"><div><p class="eyebrow">${record.sample ? "Sample story" : record.story ? "Story" : "Draft"} · ${record.mode === "free" ? "Free writing" : "Guided choices"}</p><h2>${escape(record.title || "Untitled story")}</h2><p class="small-note">${Object.keys(record.answers || {}).length} answers · Planning time: ${duration(record.activeMs)} · ${new Date(record.updatedAt).toLocaleDateString("en-GB")}</p></div><div class="record-actions">${state.showDeleted ? `<button data-restore-record="${record.id}">Restore</button>` : `<button data-view-choices="${record.id}">View choices</button><button data-open="${record.id}" ${record.story ? "" : "disabled"}>View story</button><button data-download="${record.id}">Download</button><button data-delete-record="${record.id}">Delete</button>`}</div></article>`).join("") || `<div class="empty-records"><p>${state.showDeleted ? "No deleted records." : "Your saved stories will appear here."}</p></div>`}</div>`;
}

function highlightedStory(record) {
  const text = record.story || "";
  const choices = Object.entries(record.answers || {});
  const matches = (record.choiceAnnotations || []).filter(
    (match) =>
      text.slice(match.start, match.end) === match.quote &&
      hasText(record.answers[match.questionId]),
  );
  let offset = 0;
  return text
    .split(/\n\s*\n/)
    .map((paragraph, index) => {
      const start = text.indexOf(paragraph, offset);
      const end = start + paragraph.length;
      offset = end;
      let html = escape(paragraph);
      if (state.marked && index > 0) {
        const relevant = matches.filter(
          (match) => match.start < end && match.end > start,
        );
        const points = [
          ...new Set([
            start,
            end,
            ...relevant.flatMap((match) => [
              Math.max(start, match.start),
              Math.min(end, match.end),
            ]),
          ]),
        ].sort((a, b) => a - b);
        html = points
          .slice(0, -1)
          .map((position, part) => {
            const next = points[part + 1];
            const ids = [
              ...new Set(
                relevant
                  .filter(
                    (match) => match.start <= position && match.end >= next,
                  )
                  .map((match) => match.questionId),
              ),
            ];
            const passage = escape(text.slice(position, next));
            if (!ids.length) return passage;
            const tooltip = ids
              .map(
                (id) =>
                  `Question: ${record.optionSnapshots?.[id]?.question || questionById(id)?.question || id}\nSelected option: ${record.answers[id]}`,
              )
              .join("\n\n");
            const numbers = ids.map(
              (id) => choices.findIndex(([key]) => key === id) + 1,
            );
            return `<mark tabindex="0" data-tooltip="${escape(tooltip)}" aria-label="${escape(tooltip)}">${passage}<sup>[${numbers.join(", ")}]</sup></mark>`;
          })
          .join("");
      }
      return index === 0 ? `<h2>${html}</h2>` : `<p>${html}</p>`;
    })
    .join("");
}

async function prepareChoiceMarkers() {
  const record = currentRecord();
  if (!record?.story) return;
  state.marked = true;
  if (
    record.choiceAnnotations !== undefined ||
    !Object.keys(record.answers).length
  ) {
    reader();
    return;
  }
  if (record.annotationBusy) return;
  record.annotationBusy = true;
  delete record.annotationError;
  reader();
  try {
    const result = await postApi("/api/annotations", {
      story: record.story,
      answers: record.answers,
      definitions: answeredDefinitions(record),
    });
    record.choiceAnnotations = result.matches;
    persist();
  } catch (error) {
    record.annotationError = error.message;
  } finally {
    delete record.annotationBusy;
    if (currentRecord()?.id === record.id && state.view === "read") reader();
  }
}

function annotationSummary(record) {
  if (!state.marked) return "";
  if (record.annotationBusy)
    return '<p class="annotation-status" role="status">Locating passages that reflect your choices… You can continue reading.</p>';
  if (record.annotationError)
    return `<p role="alert">${escape(record.annotationError)} <button id="retry-markers">Retry markers</button></p>`;
  const ids = new Set(
    (record.choiceAnnotations || []).map((match) => match.questionId),
  );
  const entries = Object.entries(record.answers || {});
  const missing = entries.filter(([id]) => !ids.has(id));
  return `<p class="annotation-status">Passages located for ${ids.size} / ${entries.length} choices. Markers indicate interpreted connections, not an automatic quality score.</p>${missing.length ? `<details class="annotation-missing"><summary>Choices without a located passage (${missing.length})</summary><ul>${missing.map(([id, answer]) => `<li>${escape(record.optionSnapshots?.[id]?.question || questionById(id)?.question || id)}: ${escape(answer)}</li>`).join("")}</ul></details>` : ""}`;
}

function reader() {
  const record = currentRecord();
  if (!record) {
    state.view = "saved";
    savedStories();
    return;
  }
  app.innerHTML = `<button class="page-back" id="reader-back">← Back to saved stories</button><div class="reader-heading"><div><p class="eyebrow">${record.sample ? "Sample story" : record.mode === "free" ? "Free writing" : "Guided choices"}</p><h1>${escape(record.title)}</h1></div>${record.story ? `<div class="toggle"><button id="story-only" class="${state.marked ? "" : "active"}">Story only</button><button id="show-markers" class="${state.marked ? "active" : ""}">Show choice markers</button></div>` : ""}</div><p class="small-note">Planning time: ${duration(record.activeMs)}${record.wordCount ? ` · ${record.wordCount.toLocaleString("en-GB")} words` : ""}${record.version ? ` · Version ${record.version}` : ""}</p>${record.story ? `${record.choiceCoverage?.status === "checked" && record.choiceCoverage.total ? `<p class="choice-coverage">Choice review: passages located for ${record.choiceCoverage.located} / ${record.choiceCoverage.total} choices. Use the markers to inspect the connections.</p>` : ""}<p class="marker-instructions">Choose Show choice markers, then hover over, tap or focus a highlighted passage to see its question and selected option.</p><article class="story-text">${highlightedStory(record)}</article>${annotationSummary(record)}` : `<div class="draft-summary"><h2>Your draft is saved.</h2><p>${record.mode === "free" ? escape(record.free || "No brief yet.") : `${Object.keys(record.answers || {}).length} story details are ready to revisit.`}</p></div>`}<div class="actions reader-actions"><button data-view="review">View my choices</button>${!record.story ? `<button data-continue="${record.id}">Continue writing →</button>` : ""}<button data-export-story="${record.id}" ${record.story ? "" : "disabled"}>Download story as Word</button><button data-export-choices="${record.id}">Download questions & choices</button></div>`;
}

function render() {
  document.querySelector("#choice-tooltip")?.setAttribute("hidden", "");
  renderNavigation();
  if (state.view === "home") home();
  if (state.view === "question") {
    questionView();
    requestFollowup();
  }
  if (state.view === "review") review();
  if (state.view === "saved") savedStories();
  if (state.view === "read") reader();
  if (state.view === "categories")
    app.innerHTML = `<p class="eyebrow">Follow your curiosity</p><h1>Where shall we go next?</h1><p class="muted">Return to any category to continue where you left off.</p>${categoryCards()}<button data-view="review">Story map →</button>`;
  if (state.view === "free")
    app.innerHTML = `${state.continueOrigin ? '<button id="editor-back" class="page-back" aria-label="Back to previous page">← Back</button>' : ""}<p class="eyebrow">Free writing</p><h1>Start with your own words.</h1><p class="muted">Describe the story you would like to create. Your brief is saved on this browser.</p><textarea id="free" class="free-area" placeholder="A character, a place, a moment…">${escape(currentRecord().free)}</textarea><div class="actions"><button class="primary" id="free-generate">Generate my story →</button></div>`;
  window.scrollTo({ top: 0 });
  state.lastTick = Date.now();
}

function saveAnswer() {
  const question = currentQuestion();
  const answer = (
    state.selected === 3 ? state.own : state.candidates[state.selected] || ""
  ).trim();
  if (!question || !answer) return;
  if (
    !state.editingId &&
    (state.phase === "extra" || progressFor().awaitingExplore) &&
    !progressFor().exploreConsent
  ) {
    showCategoryReminder(true, null, true);
    return;
  }
  settleTime();
  const record = currentRecord();
  const previousAnswer = record.answers[question.id];
  const isNew = !hasText(previousAnswer);
  if (state.editingId && hasText(previousAnswer) && previousAnswer !== answer) {
    const removed = pruneDescendants(
      record,
      question.id,
      branchDefinitions(record),
    );
    record.answerEdits ||= {};
    record.answerEdits[question.id] = {
      originalAnswer:
        record.answerEdits[question.id]?.originalAnswer || previousAnswer,
      updatedAt: new Date().toISOString(),
    };
    for (const id of removed.removedIds) {
      delete state.bankErrors[`${record.id}:${id}`];
      delete state.followupErrors[`${record.id}:${id}`];
    }
    if (removed.removedIds.includes(state.reviewOrigin?.questionId))
      state.reviewOrigin = null;
  }
  record.answers[question.id] = answer;
  record.answerParents ||= {};
  const parent = parentFor(question.id, record);
  if (parent) record.answerParents[question.id] = parent;
  record.optionSnapshots ||= {};
  const oldSnapshot = record.optionSnapshots[question.id];
  const provenance = answerProvenance(
    question,
    state.candidateMeta,
    state.selected,
    answer,
  );
  if (
    oldSnapshot?.answer === answer &&
    state.selected === 3 &&
    oldSnapshot.provenance
  ) {
    Object.assign(provenance, oldSnapshot.provenance, {
      contextSnapshot: question.contextSnapshot || null,
      route: question.route || null,
    });
  }
  record.optionSnapshots[question.id] = {
    question: question.question,
    options: [...state.candidates],
    answer,
    selectedIndex: state.selected,
    own: state.own,
    provenance,
    suggestions: structuredClone(state.candidateMeta),
    parentId: question.parentId || parent,
    savedAt: new Date().toISOString(),
  };
  if (question.adaptive) {
    record.adaptiveQuestions = record.adaptiveQuestions.filter(
      (item) => item.id !== question.id,
    );
    record.adaptiveQuestions.push(structuredClone(question));
  }
  if (record.title === "Untitled story" && record.name)
    record.title = `${record.name}’s story`;

  if (state.editingId) {
    const editedId = state.editingId;
    state.editingId = null;
    // Returning from an edit must retain the review page's original destination.
    if (state.reviewOrigin?.questionId === editedId) {
      state.reviewOrigin.own = answer;
      state.reviewOrigin.selected = 3;
    }
    persist(true);
    restoreRoute(state.editOrigin);
    toast(
      "Detail saved. Connected follow-ups and answer counts have been updated.",
    );
    return;
  }

  const progress = progressFor();
  progress.scratch = null;
  let coreReminder = false;
  let extraReminder = false;
  if (state.phase === "core") {
    state.index++;
    if (state.index >= listFor(state.category, "core").length) {
      coreReminder = !progress.coreNoticeShown || progress.awaitingExplore;
      progress.coreNoticeShown = true;
      if (coreReminder && !progress.exploreConsent) {
        progress.awaitingExplore = true;
        state.index = listFor(state.category, "core").length - 1;
      } else {
        state.phase = "extra";
        state.index = 0;
      }
    }
  } else {
    state.index++;
    while (
      hasText(record.answers[`${state.category}_adaptive_${state.index + 1}`])
    )
      state.index++;
    if (isNew) progress.extraCompleted++;
  }
  progress.phase = state.phase;
  progress.index = state.index;
  resetQuestion();
  persist(true);
  render();
  record.countReminders ||= [];
  const threshold = nextCountReminder(answerCount(), record.countReminders);
  if (threshold) {
    record.countReminders.push(threshold);
    persist();
    showCategoryReminder(false, threshold);
  } else if (coreReminder) showCategoryReminder(true);
}

function editDetail(id) {
  settleTime();
  const question = questionById(id);
  if (!question) return;
  state.editOrigin = captureRoute();
  const draft = editableRecord();
  state.editOrigin.recordId = draft.id;
  state.editingId = id;
  state.category = question.category;
  state.view = "question";
  resetQuestion();
  render();
}

async function exportRecord(id, kind, button) {
  if (state.exportBusy) return;
  const record = library.records.find((item) => item.id === id);
  if (!record || (kind === "story" && !record.story)) return;
  state.exportBusy = true;
  button.disabled = true;
  try {
    const { downloadWord } = await import("./word-download.js");
    await downloadWord(
      record,
      [...questions, ...(record.adaptiveQuestions || [])],
      kind,
    );
    toast(
      kind === "story"
        ? "Story Word document downloaded."
        : "Questions and choices Word document downloaded.",
    );
  } catch (error) {
    console.error(error);
    toast("The Word export failed. Please try again.");
  } finally {
    state.exportBusy = false;
    button.disabled = false;
  }
}

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.matches("[data-option]")) {
    state.selected = Number(target.dataset.option);
    state.candidates[state.selected] = target.value;
  }
  if (target.id === "own") {
    state.own = target.value;
    state.selected = target.value.trim() ? 3 : -1;
  }
  if (target.id === "name") {
    currentRecord().name = target.value;
    persist(true);
  }
  if (target.id === "free") {
    currentRecord().free = target.value;
    persist(true);
  }
  rememberPosition();
  if (state.view === "question") persist();
  const next = document.querySelector("#next");
  if (next)
    next.disabled = !hasText(
      state.selected === 3 ? state.own : state.candidates[state.selected],
    );
  document.querySelectorAll(".option").forEach((node, index) => {
    node.classList.toggle("selected", index === state.selected);
    node
      .querySelector(".select-dot")
      .setAttribute("aria-pressed", index === state.selected);
  });
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) {
    navigate(button.dataset.view);
    return;
  }
  if (button.dataset.newCategory) {
    startNewStory(button.dataset.newCategory);
    return;
  }
  if (button.dataset.category) {
    startCategory(button.dataset.category);
    return;
  }
  if (button.dataset.select !== undefined) {
    state.selected = Number(button.dataset.select);
    rememberPosition();
    persist();
    questionView();
    return;
  }
  if (button.dataset.editOption !== undefined) {
    const input = document.querySelector(
      `[data-option="${button.dataset.editOption}"]`,
    );
    input.focus();
    input.select();
    return;
  }
  if (button.id === "retry-followup") {
    delete state.followupErrors[`${currentRecord().id}:${rawQuestion().id}`];
    requestFollowup();
    render();
    return;
  }
  if (button.id === "next") {
    saveAnswer();
    return;
  }
  if (button.id === "continue-editing") {
    state.continueOrigin = captureRoute();
    const origin = state.reviewOrigin;
    if (
      origin?.view === "question" &&
      origin.recordId === library.currentId &&
      !currentRecord()?.story
    )
      restoreRoute(origin);
    else {
      const record = editableRecord();
      if (record?.mode === "free") {
        state.view = "free";
        render();
      } else
        startCategory(record?.lastCategory || state.category || "characters");
    }
    return;
  }
  if (button.id === "editor-back") {
    settleTime();
    rememberPosition();
    persist();
    const origin = state.continueOrigin;
    state.continueOrigin = null;
    restoreRoute(origin);
    return;
  }
  if (button.id === "previous") {
    if (button.disabled) return;
    if (state.editingId) {
      state.editingId = null;
      restoreRoute(state.editOrigin);
      return;
    }
    settleTime();
    if (state.index > 0) state.index--;
    else if (state.phase === "extra") {
      state.phase = "core";
      state.index = listFor(state.category, "core").length - 1;
    } else {
      navigate("categories");
      return;
    }
    Object.assign(progressFor(), {
      phase: state.phase,
      index: state.index,
      scratch: null,
    });
    resetQuestion();
    persist();
    render();
    return;
  }
  if (button.id === "retry-bank") {
    delete state.bankErrors[`${currentRecord().id}:${currentQuestion().id}`];
    requestOptionBank();
    render();
    return;
  }
  if (button.id === "previous-batch") {
    moveSuggestionBatch(-1);
    return;
  }
  if (button.id === "refresh") {
    await refreshSuggestions();
    return;
  }
  if (button.id === "name-suggestion" || button.id === "more-names") {
    await suggestNames(button);
    return;
  }
  if (button.dataset.nameChoice !== undefined) {
    const record = currentRecord();
    record.name = button.dataset.nameChoice;
    document.querySelector("#name").value = record.name;
    document.querySelector("#names-dialog").close();
    persist(true);
    return;
  }
  if (button.id === "close-names") {
    document.querySelector("#names-dialog").close();
    return;
  }
  if (button.id === "cancel-branch-edit") {
    state.pendingEdit = null;
    document.querySelector("#branch-edit-dialog").close();
    state.lastTick = Date.now();
    return;
  }
  if (button.id === "confirm-branch-edit") {
    const id = state.pendingEdit;
    state.pendingEdit = null;
    document.querySelector("#branch-edit-dialog").close();
    editDetail(id);
    return;
  }
  if (button.id === "dismiss-reminder" || button.id === "switch-category") {
    button.setAttribute("aria-pressed", "true");
    const continueExploring = button.id === "dismiss-reminder";
    const pendingSave = state.pendingExtraSave;
    state.pendingExtraSave = false;
    document.querySelector("#category-dialog").close();
    state.lastTick = Date.now();
    if (state.reminderMode === "count") {
      if (!continueExploring) navigate("review");
    } else {
      progressFor().exploreConsent = continueExploring;
      persist();
      if (continueExploring && progressFor().awaitingExplore) {
        Object.assign(progressFor(), {
          awaitingExplore: false,
          phase: "extra",
          index: 0,
          scratch: null,
        });
        state.phase = "extra";
        state.index = 0;
        resetQuestion();
        persist();
        render();
      } else if (continueExploring && pendingSave) saveAnswer();
    }
    return;
  }
  if (button.id === "review-back") {
    const origin = state.reviewOrigin;
    state.reviewOrigin = null;
    restoreRoute(origin);
    return;
  }
  if (button.id === "map-mode" || button.id === "list-mode") {
    state.reviewMode = button.id === "map-mode" ? "map" : "list";
    review();
    return;
  }
  if (button.dataset.edit) {
    requestEdit(button.dataset.edit);
    return;
  }
  if (button.dataset.delete) {
    state.pendingDelete = button.dataset.delete;
    settleTime();
    document.querySelector("#delete-dialog").showModal();
    return;
  }
  if (button.id === "cancel-delete") {
    document.querySelector("#delete-dialog").close();
    state.lastTick = Date.now();
    return;
  }
  if (button.id === "confirm-delete") {
    const key = state.pendingDelete;
    const question = questionById(key);
    const record = editableRecord();
    record.optionSnapshots ||= {};
    const pool = candidatePool(question).filter(
      (value) => value !== record.answers[key],
    );
    state.undo = {
      recordId: record.id,
      key,
      value: record.answers[key],
      snapshot: record.optionSnapshots?.[key],
    };
    record.answers[key] = pool[Math.floor(Math.random() * pool.length)];
    const replacement = question.pool?.find(
      (option) => option.text === record.answers[key],
    );
    record.optionSnapshots[key] = {
      question: question.question,
      options: question.options,
      answer: record.answers[key],
      provenance: replacement
        ? answerProvenance(question, [replacement], 0, record.answers[key])
        : { origin: "ai_generated" },
    };
    if (state.reviewOrigin?.questionId === key) {
      state.reviewOrigin.own = record.answers[key];
      state.reviewOrigin.selected = 3;
    }
    persist(true);
    document.querySelector("#delete-dialog").close();
    review();
    toast(
      "Detail replaced from the generated pool. Review related choices.",
      true,
    );
    return;
  }
  if (button.id === "undo" && state.undo) {
    const undo = state.undo;
    const record = library.records.find((item) => item.id === undo.recordId);
    if (record) {
      record.answers[undo.key] = undo.value;
      record.optionSnapshots[undo.key] = undo.snapshot;
      persist(true);
    }
    state.undo = null;
    if (state.view === "review") review();
    toast("Original detail restored.");
    return;
  }
  if (button.dataset.open) {
    settleTime();
    rememberPosition();
    persist();
    state.readerOrigin = captureRoute();
    library.currentId = button.dataset.open;
    state.view = "read";
    state.marked = false;
    render();
    return;
  }
  if (button.dataset.viewChoices) {
    settleTime();
    rememberPosition();
    persist();
    state.reviewOrigin = captureRoute();
    library.currentId = button.dataset.viewChoices;
    state.view = "review";
    state.reviewMode = "map";
    render();
    return;
  }
  if (button.dataset.download) {
    const record = library.records.find(
      (item) => item.id === button.dataset.download,
    );
    if (!record) return;
    document.querySelector("#download-options").innerHTML =
      `<button data-export-choices="${record.id}">Questions & choices</button><button data-export-story="${record.id}" ${record.story ? "" : "disabled"}>Story</button>`;
    document.querySelector("#download-dialog").showModal();
    return;
  }
  if (button.id === "close-download") {
    document.querySelector("#download-dialog").close();
    return;
  }
  if (button.id === "active-records" || button.id === "deleted-records") {
    state.showDeleted = button.id === "deleted-records";
    savedStories();
    return;
  }
  if (button.dataset.restoreRecord) {
    const record = library.records.find(
      (item) => item.id === button.dataset.restoreRecord,
    );
    if (record) {
      delete record.deletedAt;
      persist();
    }
    savedStories();
    toast("Saved story restored.");
    return;
  }
  if (button.id === "reader-back") {
    restoreRoute(state.readerOrigin || { ...captureRoute(), view: "saved" });
    return;
  }
  if (button.dataset.continue) {
    state.continueOrigin = captureRoute();
    settleTime();
    library.currentId = button.dataset.continue;
    const record = currentRecord();
    if (record.mode === "free") {
      state.view = "free";
      render();
    } else {
      const lastCategory =
        record.lastCategory ||
        Object.keys(record.progress || {}).at(-1) ||
        questionById(Object.keys(record.answers || {}).at(-1))?.category ||
        "characters";
      startCategory(lastCategory);
    }
    return;
  }
  if (button.dataset.deleteRecord) {
    state.pendingRecordDelete = button.dataset.deleteRecord;
    document.querySelector("#record-delete-dialog").showModal();
    return;
  }
  if (button.id === "keep-record") {
    document.querySelector("#record-delete-dialog").close();
    return;
  }
  if (button.id === "delete-record") {
    const deleted = state.pendingRecordDelete;
    const record = library.records.find((item) => item.id === deleted);
    if (record) record.deletedAt = new Date().toISOString();
    if (library.currentId === deleted) library.currentId = null;
    persistLibrary(library);
    document.querySelector("#record-delete-dialog").close();
    savedStories();
    toast("Moved to Recently deleted. You can restore it.");
    return;
  }
  if (button.id === "show-markers" || button.id === "retry-markers") {
    await prepareChoiceMarkers();
    return;
  }
  if (button.id === "story-only") {
    state.marked = false;
    reader();
    return;
  }
  if (button.dataset.exportStory) {
    await exportRecord(button.dataset.exportStory, "story", button);
    return;
  }
  if (button.dataset.exportChoices) {
    await exportRecord(button.dataset.exportChoices, "choices", button);
    return;
  }
  if (button.id === "generate" || button.id === "free-generate") {
    if (!canGenerate()) {
      toast("Complete the core answers in every category before generating.");
      return;
    }
    if (state.generationBusy) return;
    settleTime();
    state.generationBusy = true;
    state.paused = true;
    const record = currentRecord();
    const snapshot = structuredClone(record);
    persist();
    const live = document.querySelector("#live-story");
    live.textContent = "";
    live.hidden = true;
    document.querySelector("#generation-dialog p").textContent =
      "Submitting your story request…";
    document.querySelector("#generation-dialog").showModal();
    try {
      const result = await postApi("/api/generate", {
        mode: snapshot.mode,
        name: snapshot.name,
        free: snapshot.free,
        answers: snapshot.answers,
        definitions: answeredDefinitions(snapshot),
      });
      const version = saveGeneratedVersion(library, record.id, result.story);
      version.wordCount = result.wordCount;
      version.targetWords = result.targetWords;
      state.marked = false;
      persist(true);
      state.view = "read";
    } catch (error) {
      toast(error.message);
    } finally {
      document.querySelector("#generation-dialog").close();
      state.generationBusy = false;
      state.paused = false;
      render();
    }
  }
});

// External generation events also create immutable saved versions.
document.addEventListener("storyspring:story-generated", (event) => {
  const { draftId, story } = event.detail || {};
  if (
    typeof draftId !== "string" ||
    typeof story !== "string" ||
    !story.trim() ||
    !library.records.some((record) => record.id === draftId)
  )
    return;
  settleTime();
  saveGeneratedVersion(library, draftId, story);
  persist();
  state.view = "saved";
  state.showDeleted = false;
  render();
});

document.addEventListener("visibilitychange", () => {
  // Only accrue time while the editor is visible, never while the tab is hidden.
  state.lastTick = Date.now();
  persist();
});

const choiceTooltip = document.createElement("div");
choiceTooltip.id = "choice-tooltip";
choiceTooltip.setAttribute("role", "tooltip");
choiceTooltip.hidden = true;
document.body.append(choiceTooltip);

function showChoiceTooltip(mark) {
  choiceTooltip.textContent = mark.dataset.tooltip;
  choiceTooltip.hidden = false;
  const target = mark.getBoundingClientRect();
  const tip = choiceTooltip.getBoundingClientRect();
  choiceTooltip.style.left = `${Math.max(10, Math.min(target.left, innerWidth - tip.width - 10))}px`;
  choiceTooltip.style.top = `${Math.max(10, target.top >= tip.height + 15 ? target.top - tip.height - 8 : Math.min(innerHeight - tip.height - 10, target.bottom + 8))}px`;
}

document.addEventListener("pointerover", (event) => {
  const mark = event.target.closest("mark[data-tooltip]");
  if (mark) showChoiceTooltip(mark);
});
document.addEventListener("pointerout", (event) => {
  if (
    event.target.closest("mark[data-tooltip]") &&
    !event.relatedTarget?.closest?.("mark[data-tooltip]")
  )
    choiceTooltip.hidden = true;
});
document.addEventListener("focusin", (event) => {
  if (event.target.matches("mark[data-tooltip]"))
    showChoiceTooltip(event.target);
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches("mark[data-tooltip]")) choiceTooltip.hidden = true;
});
window.addEventListener(
  "scroll",
  () => {
    choiceTooltip.hidden = true;
  },
  { passive: true },
);
window.addEventListener("pagehide", () => {
  settleTime();
  rememberPosition();
  persist();
});
window.addEventListener("resize", drawConnections);
setInterval(() => {
  settleTime();
  const timer = document.querySelector("#timer");
  if (timer) timer.textContent = duration(currentRecord()?.activeMs);
  if (isTiming()) persist();
}, 500);

render();

async function suggestNames(button) {
  const record = currentRecord();
  const context = JSON.stringify(record.answers);
  button.disabled = true;
  const label = button.textContent;
  button.textContent = "Preparing names…";
  state.paused = true;
  try {
    if (record.nameBank?.version !== "preset-1") {
      const result = { names: presets.names };
      if (result.names?.length !== OPTION_BANK_SIZE)
        throw new Error("The name bank is incomplete. Please retry.");
      record.nameBank = {
        version: "preset-1",
        context,
        pool: result.names.map((text) => ({ text })),
        cycle: [],
        previous: [],
      };
    }
    if (
      currentRecord()?.id !== record.id ||
      JSON.stringify(record.answers) !== context
    )
      return;
    const bank = record.nameBank;
    const result = rotatingBatch(bank.pool, bank.cycle, bank.previous);
    bank.cycle = result.cycleTexts;
    bank.previous = result.batch.map((item) => item.text);
    document.querySelector("#name-options").innerHTML = result.batch
      .map(
        ({ text }) =>
          `<button data-name-choice="${escape(text)}">${escape(text)}</button>`,
      )
      .join("");
    const dialog = document.querySelector("#names-dialog");
    if (!dialog.open) dialog.showModal();
    persist();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = label;
    state.paused = false;
    state.lastTick = Date.now();
  }
}

document.addEventListener("click", (event) => {
  const marker = event.target.closest("mark[data-tooltip]");
  if (marker) marker.focus();
});

document.addEventListener("storyspring:task-progress", (event) => {
  const jobs = event.detail;
  const waiting = jobs.find((job) => job.status === "queued");
  const task =
    jobs.find((job) => job.endpoint === "/api/generate") || waiting || jobs[0];
  const label = !task
    ? ""
    : task.status === "queued"
      ? `Your request is waiting. Queue position: ${task.position}. Please keep this page open.`
      : task.status === "submitting"
        ? "Submitting your request…"
        : task.phase === "revising"
          ? "Adjusting the story length. This preview will be replaced by the completed version."
          : "Your request is being prepared. You can wait here; no need to submit again.";
  const banner = document.querySelector("#task-status");
  banner.textContent = label;
  banner.hidden = !task;
  const modal = document.querySelector("#generation-dialog[open] p");
  if (modal && task) modal.textContent = label;
  const live = document.querySelector("#live-story");
  if (
    modal &&
    task?.endpoint === "/api/generate" &&
    task.previewText !== undefined
  ) {
    live.textContent = task.previewText;
    live.hidden = !task.previewText;
  }
});
