export function modificationInfo(record, id) {
  const provenance = record.optionSnapshots?.[id]?.provenance;
  const edit = record.answerEdits?.[id];
  const own = provenance?.origin === "user_written";
  const modified = Boolean(edit || own || provenance?.origin === "user_edited");
  return {
    modified,
    label: own ? "Your own answer" : "Modified by you",
    original: edit?.originalAnswer ?? provenance?.originalSuggestion ?? "",
  };
}

export function modifiedAnswerCount(record) {
  return Object.keys(record.answers || {}).filter(
    (id) => record.answers[id]?.trim() && modificationInfo(record, id).modified,
  ).length;
}

// Preserve matching word spans and highlight the replacement span, including custom input.
export function changedSegments(original, finalText) {
  const before = String(original).match(/\s+|\S+/g) || [];
  const after = String(finalText).match(/\s+|\S+/g) || [];
  if (original === finalText) return [{ text: finalText, changed: false }];
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const middle = after.slice(prefix, after.length - suffix).join("");
  if (!middle.trim()) return [{ text: finalText, changed: true }];
  return [
    { text: after.slice(0, prefix).join(""), changed: false },
    { text: middle, changed: true },
    { text: suffix ? after.slice(-suffix).join("") : "", changed: false },
  ].filter((segment) => segment.text);
}
