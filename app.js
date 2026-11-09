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
