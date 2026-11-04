export const STORAGE_KEY = "storyspring-layout-preview-v1";

export function makeRecord(mode = "guided") {
  return {
    id: crypto.randomUUID(),
    title: "Untitled story",
    mode,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    answers: {},
    name: "",
    free: "",
    progress: {},
    optionSnapshots: {},
    answerParents: {},
    activeMs: 0,
    story: "",
  };
}

export function loadLibrary() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (stored.version === 2 && Array.isArray(stored.records)) {
      for (const record of stored.records) {
        record.answerParents ||= {};
        record.optionSnapshots ||= {};
        if (record.story) {
          record.version ||= 1;
          record.familyId ||= record.id;
          record.baseTitle ||= record.title.replace(/\s*\(\d+\)$/, "");
          record.title = `${record.baseTitle} (${record.version})`;
        }
      }
      return stored;
    }

    // Keep drafts created by the first preview when upgrading its storage format.
    const record = makeRecord(
      stored.free && !Object.keys(stored.answers || {}).length
        ? "free"
        : "guided",
    );
    record.answers = stored.answers || {};
    record.name = stored.name || "";
    record.free = stored.free || "";
    const hasDraft = Object.keys(record.answers).length || record.free;
    return {
      version: 2,
      records: hasDraft ? [record] : [],
      currentId: hasDraft ? record.id : null,
    };
  } catch {
    return { version: 2, records: [], currentId: null };
  }
}

export function persistLibrary(library) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
}

// Generated versions are immutable snapshots; editing starts a separate draft.
export function forkStory(record) {
  const draft = structuredClone(record);
  draft.id = crypto.randomUUID();
  draft.familyId = record.familyId || record.id;
  draft.baseTitle = record.baseTitle || record.title.replace(/\s*\(\d+\)$/, "");
  draft.title = `${draft.baseTitle} · Editing`;
  draft.sourceVersion = record.id;
  draft.story = "";
  draft.createdAt = new Date().toISOString();
  draft.updatedAt = draft.createdAt;
  delete draft.deletedAt;
  delete draft.version;
  return draft;
}

export function saveGeneratedVersion(library, draftId, story) {
  const draft = library.records.find((record) => record.id === draftId);
  if (!draft || !story?.trim())
    throw new Error("A draft and a complete story are required.");
  const familyId = draft.familyId || draft.id;
  const version =
    Math.max(
      0,
      ...library.records
        .filter((record) => (record.familyId || record.id) === familyId)
        .map((record) => record.version || (record.story ? 1 : 0)),
    ) + 1;
  const generatedTitle = story.split("\n")[0].trim() || "Untitled story";
  const snapshot = structuredClone(draft);
  snapshot.id = crypto.randomUUID();
  snapshot.familyId = familyId;
  snapshot.baseTitle = draft.baseTitle || generatedTitle;
  snapshot.version = version;
  snapshot.title = `${snapshot.baseTitle} (${version})`;
  snapshot.story = story;
  snapshot.generatedAt = new Date().toISOString();
  snapshot.updatedAt = snapshot.generatedAt;
  delete snapshot.deletedAt;
  const draftIndex = library.records.findIndex(
    (record) => record.id === draftId,
  );
  if (draft.story) library.records.unshift(snapshot);
  else library.records.splice(draftIndex, 1, snapshot);
  library.currentId = snapshot.id;
  return snapshot;
}

export function sampleRecord() {
  const record = makeRecord("guided");
  record.title = "The Room Above the Bakery";
  record.sample = true;
  record.name = "Mara";
  record.answers = {
    role: "A newcomer in an unfamiliar place",
    goal: "Keep a promise to someone",
    place: "A quiet room with tall windows",
    action: "Explain what they need and listen",
    tone: "Warm and gently humorous",
  };
  record.story = `The Room Above the Bakery

A quiet room with tall windows was the last place Mara expected to find above a bakery. Below her feet, trays clattered and someone argued cheerfully with a stubborn oven. Upstairs, a folded letter waited beside a chipped blue cup.

“Keep a promise to someone,” her grandfather had written. It was the heading of a list he had never finished. The promise itself was simple: return the cup to his old friend before the bakery changed hands.

The woman downstairs recognised it immediately. She also insisted that it had been stolen thirty years ago. Mara, a newcomer in an unfamiliar place, had planned to stay for five minutes. She had not planned to solve a family argument older than she was.

Her grandfather had left one more line: “Explain what they need and listen.” Mara set the cup between them and asked what had happened. The woman described a farewell that had never taken place. Mara described the letter. Slowly, the missing years became something they could talk about.

The woman took the cup, inspected its broken handle and laughed. “He repaired everything except his timing.” Then she put on the kettle.

Mara stayed until the afternoon light crossed the floor. The room was still quiet, but it no longer felt empty.`;
  record.activeMs = 243000;
  return record;
}
