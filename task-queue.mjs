// Keep task credentials in this browser tab. Never put provider credentials in requests.
const pending = new Map();
const progress = new Map();
const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const storeKey = "storyspring-pending-tasks-v1";
const load = () => {
  try {
    return JSON.parse(sessionStorage.getItem(storeKey)) || {};
  } catch {
    return {};
  }
};
const save = (value) => {
  try {
    sessionStorage.setItem(storeKey, JSON.stringify(value));
  } catch {}
};

function update(key, value) {
  if (value) progress.set(key, value);
  else progress.delete(key);
  const jobs = [...progress.values()];
  document.dispatchEvent(
    new CustomEvent("storyspring:task-progress", { detail: jobs }),
  );
}

async function request(url, options) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json();
      if (!response.ok) {
        const error = Object.assign(
          new Error(data.error || "Please retry from your saved draft."),
          { status: response.status },
        );
        if (![429, 502, 503, 504].includes(response.status)) throw error;
        last = error;
      } else return data;
    } catch (error) {
      if (error.status && ![429, 502, 503, 504].includes(error.status))
        throw error;
      last = error;
    }
    if (attempt < 2) await wait(1000 * (attempt + 1) + Math.random() * 500);
  }
  throw last;
}

export async function queuedRequest(endpoint, body) {
  const serialized = JSON.stringify(body);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint + serialized),
  );
  const key = [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (pending.has(key)) return pending.get(key);
  const operation = run(key, endpoint, body).finally(() => {
    pending.delete(key);
    update(key, null);
  });
  pending.set(key, operation);
  return operation;
}

async function run(key, endpoint, body) {
  const stored = load();
  // A retry after a network failure reuses the same identity, avoiding duplicate AI calls.
  const identity = stored[key] || {
    requestId: crypto.randomUUID(),
    taskToken: crypto.randomUUID() + crypto.randomUUID(),
    startedAt: Date.now(),
  };
  stored[key] = identity;
  save(stored);
  update(key, { endpoint, status: "submitting", startedAt: identity.startedAt });
  let job;
  try {
    if (identity.jobId) {
      try {
        job = await request(`/api/tasks/${identity.jobId}`, {
          headers: { Authorization: `Bearer ${identity.taskToken}` },
        });
      } catch (error) {
        if (error.status === 404) {
          const all = load();
          delete all[key];
          save(all);
