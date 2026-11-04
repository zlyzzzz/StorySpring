// Shared by browser and server so novelty checks follow the same rules.
export const OPTION_BANK_SIZE = 50;
export const CATEGORY_IDS = ["characters", "setting", "plot", "theme", "style"];
export function optionKey(text) {
  return String(text)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function repeatsOption(text, previousTexts) {
  const key = optionKey(text);
  const words = new Set(key.split(" "));
  return previousTexts.some((previous) => {
    const otherKey = optionKey(previous);
    if (otherKey === key) return true;
    const other = new Set(otherKey.split(" "));
    // Catch near-identical word rearrangements, without claiming semantic equivalence.
    if (Math.min(words.size, other.size) < 4) return false;
    const intersection = [...words].filter((word) => other.has(word)).length;
    return intersection / new Set([...words, ...other]).size >= 0.85;
  });
}

export function unseenBatch(pool, previousTexts, random = Math.random) {
  const available = [];
  for (const option of pool) {
    if (
      !repeatsOption(option.text, [
        ...previousTexts,
        ...available.map((item) => item.text),
      ])
    )
      available.push(option);
  }
  if (available.length < 3) return null;
  for (let index = available.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [available[index], available[other]] = [available[other], available[index]];
  }
  return available.slice(0, 3).map((option) => structuredClone(option));
}

export function rotatingBatch(
  pool,
  cycleTexts = [],
  previousTexts = [],
  random = Math.random,
) {
  const unique = [
    ...new Map(pool.map((option) => [optionKey(option.text), option])).values(),
  ];
  if (unique.length !== OPTION_BANK_SIZE)
    throw new Error("A complete 50-option bank is required.");
  const seen = new Set(cycleTexts.map(optionKey));
  const previous = new Set(previousTexts.map(optionKey));
  const shuffle = (items) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  };
  const unused = shuffle(
    unique.filter(
      (option) =>
        !seen.has(optionKey(option.text)) &&
        !previous.has(optionKey(option.text)),
    ),
  );
  if (unused.length >= 3) {
    const batch = unused.slice(0, 3);
    return {
      batch: structuredClone(batch),
      cycleTexts: [...cycleTexts, ...batch.map((option) => option.text)],
    };
  }
  // Fifty is not divisible by three: show the final two before starting a new cycle.
  const remainingKeys = new Set(unused.map((option) => optionKey(option.text)));
  const wrapped = shuffle(
    unique.filter(
      (option) =>
        !previous.has(optionKey(option.text)) &&
        !remainingKeys.has(optionKey(option.text)),
    ),
  ).slice(0, 3 - unused.length);
  const batch = [...unused, ...wrapped];
  return {
    batch: structuredClone(batch),
    cycleTexts: batch.map((option) => option.text),
  };
}
