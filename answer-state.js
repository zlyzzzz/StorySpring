export function contextChanged(question, record) {
  return (
    question.adaptive &&
    (question.contextName !== (record.name || "") ||
      Object.entries(question.contextSnapshot || {}).some(
        ([id, value]) => record.answers?.[id] !== value,
      ))
  );
}

export function suggestionBatch(
  pool,
  previousTexts = [],
  random = Math.random,
) {
  const unique = [
    ...new Map(pool.map((option) => [option.text, option])).values(),
  ];
  if (unique.length < 3)
    throw new Error("At least three distinct suggestions are required.");
  let available = unique.filter(
    (option) => !previousTexts.includes(option.text),
  );
  if (available.length < 3) available = [...unique];
  for (let index = available.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [available[index], available[other]] = [available[other], available[index]];
  }
  return available.slice(0, 3).map((option) => structuredClone(option));
}

export function answerProvenance(question, batch, index, answer) {
  const option = index >= 0 && index < 3 ? batch[index] : null;
  return {
    origin: !option
      ? "user_written"
      : answer === option.text
        ? option.origin
        : "user_edited",
    originalSuggestion: option?.text || null,
    ruleVersion: question.ruleVersion || null,
    contextSnapshot: question.contextSnapshot || null,
  };
}

// Inclusive milestones are shown once per draft, including when an imported draft passes one.
export function nextCountReminder(count, shown = []) {
  return [25, 35, 45].find(
    (threshold) => count >= threshold && !shown.includes(threshold),
  );
}
