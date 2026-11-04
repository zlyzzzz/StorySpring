// Branch deletion follows explicit answer links, not every contextual reference.
export function descendantIds(record, rootId, definitions) {
  const parents = new Map(
    definitions.map((question) => [
      question.id,
      record.answerParents?.[question.id] ||
        question.parentId ||
        record.optionSnapshots?.[question.id]?.parentId,
    ]),
  );
  const removed = new Set();
  const queue = [rootId];
  while (queue.length) {
    const parent = queue.shift();
    for (const [id, parentId] of parents) {
      if (id === rootId || removed.has(id) || parentId !== parent) continue;
      removed.add(id);
      queue.push(id);
    }
  }
  return [...removed];
}

export function pruneDescendants(record, rootId, definitions) {
  const removed = new Set(descendantIds(record, rootId, definitions));
  const answeredCount = [...removed].filter((id) =>
    record.answers?.[id]?.trim(),
  ).length;
  for (const field of [
    "answers",
    "answerParents",
    "optionSnapshots",
    "suggestionPools",
    "suggestionHistory",
    "answerEdits",
  ]) {
    for (const id of removed) if (record[field]) delete record[field][id];
  }
  record.adaptiveQuestions = (record.adaptiveQuestions || []).filter(
    (question) => !removed.has(question.id),
  );
  record.suggestionRefills = (record.suggestionRefills || []).filter(
    (item) => !removed.has(item.questionId),
  );
  for (const category of new Set(
    definitions.map((question) => question.category),
  )) {
    const core = definitions.filter(
      (question) => question.category === category && !question.extension,
    );
    const missingCore = core.findIndex(
      (question) => !record.answers?.[question.id]?.trim(),
    );
    let extraIndex = 0;
    while (record.answers?.[`${category}_adaptive_${extraIndex + 1}`]?.trim())
      extraIndex++;
    const previous = record.progress?.[category] || {};
    record.progress ||= {};
    record.progress[category] = {
      ...previous,
      phase: missingCore < 0 ? "extra" : "core",
      index: missingCore < 0 ? extraIndex : missingCore,
      extraCompleted: definitions.filter(
        (question) =>
          question.category === category &&
          question.extension &&
          record.answers?.[question.id]?.trim(),
      ).length,
      scratch: null,
    };
  }
  record.branchEdits ||= [];
  record.branchEdits.push({
    rootId,
    removedIds: [...removed],
    answeredCount,
    at: new Date().toISOString(),
  });
  return { removedIds: [...removed], answeredCount };
}
