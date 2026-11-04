// A bounded, inspectable pilot: authored question rules + curated source lookups.
// No LLM call, universal psychological claim, or automatic corpus-wide approval.
export const CHARACTER_FOLLOWUP_LIMIT = 10;

const routeRules = [
  ["promise", /\b(promise|promises|promised|pledge|commitment)\b/i],
  [
    "search",
    /\b(find|search|lost|missing|disappeared|recover)\b|\breturn something\b/i,
  ],
  ["rest", /\b(rest|sleep|tired|quiet|peace|relax)\b/i],
  ["new_start", /\b(start|begin|change|home|new|belong)\b/i],
];

export function characterRoute(text = "") {
  const match = routeRules.find(([, expression]) => expression.test(text));
  return {
    kind: match?.[0] || "open",
    matchedText: match ? text.match(match[1])[0] : "",
  };
}

function authored(text) {
  return { text, origin: "authored", sourceIds: [] };
}

function fromCatalog(catalog, key) {
  const source = catalog.items[key];
  if (!source?.id || !source.adapted_text)
    throw new Error(`Missing curated source: ${key}`);
  return {
    text: source.adapted_text,
    origin: "source_adaptation",
    sourceIds: [source.id],
  };
}

function optionsForMeaning(route, catalog) {
  const source = (key) => fromCatalog(catalog, key);
  if (route === "promise")
    return [
      source("make_happy"),
      source("help_friend"),
      authored("To honour a shared memory"),
      authored("To show that their words matter"),
      authored("To offer reassurance"),
      authored("To decide what this commitment means to them"),
    ];
  if (route === "search")
    return [
      authored("It has a personal meaning"),
      authored("Someone else is waiting for it"),
      authored("It could answer an old question"),
      authored("Finding it would restore a familiar routine"),
      authored("They want to understand why it matters"),
      authored("It connects them to someone they miss"),
    ];
  if (route === "rest")
    return [
      authored("Have enough energy for an ordinary day"),
      authored("Enjoy being alone for a while"),
      authored("Notice something they have been overlooking"),
      authored("Spend unhurried time with someone"),
      authored("Feel comfortable doing nothing"),
      authored("Discover what they want to do next"),
    ];
  if (route === "new_start")
    return [
      source("belonging"),
      source("support_success"),
      authored("To make room for a different routine"),
      authored("To keep something familiar while moving forward"),
      authored("To try something at their own pace"),
      authored("To decide what they want to carry with them"),
    ];
  return [
    source("make_happy"),
    source("belonging"),
    source("rest"),
    authored("To understand something about themselves"),
    authored("To enjoy a small everyday moment"),
    authored("They are still discovering why it matters"),
  ];
}

export function buildCharacterQuestion(record, index, catalog) {
  if (index < 0 || index >= CHARACTER_FOLLOWUP_LIMIT) return null;
  const selected = record.answers || {};
  const name = record.name?.trim() || "your character";
  const route = characterRoute(selected.concern || selected.goal);
  const source = (key) => fromCatalog(catalog, key);
  const previous = (offset) => `characters_adaptive_${offset + 1}`;
  const stages = [
    {
      parentId: selected.concern ? "concern" : "goal",
      question:
        route.kind === "promise"
          ? `What makes keeping this promise meaningful to ${name}?`
          : route.kind === "search"
            ? `What makes this search matter to ${name}?`
            : route.kind === "rest"
              ? `What would having time to rest change for ${name}?`
              : route.kind === "new_start"
                ? `What draws ${name} towards this new beginning?`
                : `What matters to ${name} about this?`,
      pool: optionsForMeaning(route.kind, catalog),
    },
    {
      parentId: previous(0),
      question:
        route.kind === "rest"
          ? "How do they feel when they allow themselves to slow down?"
          : "How do they feel when they think about what matters to them?",
      pool: [
        "Quietly hopeful",
        "Curious about what comes next",
        "Unsure, but willing to explore",
        "Content with a small possibility",
        "Pulled in more than one direction",
        "Calm and ready to begin",
      ].map(authored),
    },
    {
      parentId: "relationship",
      question: /strangers/i.test(selected.relationship || "")
        ? "How might these two people begin to connect?"
        : /siblings/i.test(selected.relationship || "")
          ? "What would these siblings appreciate from each other?"
          : "What kind of connection would feel right between them?",
      pool: [
        source("companionship"),
        authored("Listen without deciding for each other"),
        authored("Share something they both enjoy"),
        authored("Allow each other a little space"),
        authored("Be honest about a small uncertainty"),
        authored("Let the connection grow slowly"),
      ],
    },
    {
      parentId: previous(2),
      question: "How might they express what they need from this connection?",
      pool: [
        "Say it plainly in a quiet moment",
        "Let a small gesture carry the meaning",
        "Ask the other person a question",
        "Share a memory before explaining",
        "Leave a note they can read later",
        "Wait until they find their own words",
      ].map(authored),
    },
    {
      parentId: selected.concern ? "concern" : "goal",
      question:
        route.kind === "search"
          ? "How would they like to begin looking?"
          : route.kind === "rest"
            ? "How would they make a little room for rest?"
            : "What small step would feel natural to them?",
      pool:
        route.kind === "search"
          ? [
              source("trusted_help"),
              authored("Revisit the last place they remember it"),
              authored("Ask someone what they noticed"),
              authored("Look through a familiar collection"),
              authored("Start with one small detail"),
              authored("Take time to remember before acting"),
            ]
          : [
              source("trusted_help"),
              source("companionship"),
              authored("Begin with something small and familiar"),
              authored("Make time to notice their surroundings"),
              authored("Write down what they want to say"),
              authored("Try a quiet activity on their own"),
            ],
    },
    {
      parentId: previous(4),
      question:
        "What would they notice about themselves after taking that step?",
      pool: [
        "They feel more at ease",
        "Their curiosity has grown",
        "They want to take things more slowly",
        "They are surprised by what feels important",
        "They would like to share the moment",
        "They still have mixed feelings",
      ].map(authored),
    },
    {
      parentId: "motivation",
      question: "What small memory might come to mind here?",
      pool: [
        "A simple kindness they once received",
        "An ordinary day they now miss",
        "Something they learned by trying",
        "A conversation that stayed with them",
        "A place where they felt comfortable",
        "Nothing specific; this moment is new to them",
      ].map(authored),
    },
    {
      parentId: "relationship",
      question:
        "How would you like this relationship to feel as the story develops?",
      pool: [
        "More familiar through small shared moments",
        "Comfortable with a little uncertainty",
        "Close, while leaving room for independence",
        "Still complicated, with moments of warmth",
        "Quietly supportive without a major change",
        "Open to more than one possible direction",
      ].map(authored),
    },
    {
      parentId: "trait",
      question: "Which everyday habit could make this personality visible?",
      pool: [
        "They pause to notice small changes",
        "They put things in order while thinking",
        "They tell a small joke when unsure",
        "They keep a reminder of important moments",
        "They ask questions before offering advice",
        "They return to a familiar activity",
      ].map(authored),
    },
    {
      parentId: previous(8),
      question: "How might that habit appear in a moment with someone else?",
      pool: [
        "Someone recognises it and smiles",
        "It gives them something easy to talk about",
        "They make room for the other person to join",
        "They notice that the other person does it differently",
        "It remains a quiet detail in the background",
        "It helps them feel comfortable being themselves",
      ].map(authored),
    },
  ];
  const stage = stages[index];
  const parentId = selected[stage.parentId]?.trim() ? stage.parentId : "goal";
  const contextSnapshot = Object.fromEntries(
    [...new Set([parentId, "goal", "relationship", "trait", "motivation"])]
      .filter((id) => selected[id]?.trim())
      .map((id) => [id, selected[id]]),
  );
  const pool = stage.pool.map((option, optionIndex) => ({
    ...option,
    id: `c${index + 1}_${optionIndex + 1}`,
  }));
  return {
    id: previous(index),
    category: "characters",
    extension: true,
    adaptive: true,
    question: stage.question,
    options: pool.slice(0, 3).map((option) => option.text),
    pool,
    parentId,
    contextSnapshot,
    contextName: record.name || "",
    route: { rule: route.kind, matchedText: route.matchedText },
    ruleVersion: "characters-pilot-1",
  };
}

export function contextChanged(question, record) {
  return (
    question.adaptive &&
    (question.contextName !== (record.name || "") ||
      Object.entries(question.contextSnapshot || {}).some(
        ([id, value]) => record.answers?.[id] !== value,
      ))
  );
}

export function ensureCharacterQuestion(record, index, catalog) {
  if (index >= CHARACTER_FOLLOWUP_LIMIT) return null;
  record.adaptiveQuestions ||= [];
  let question = record.adaptiveQuestions[index];
  // Never silently overwrite a confirmed question or its historical context.
  if (
    !question ||
    (!record.answers?.[question.id]?.trim() && contextChanged(question, record))
  ) {
    question = buildCharacterQuestion(record, index, catalog);
    record.adaptiveQuestions[index] = question;
  }
  return question;
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
    sourceIds: [...(option?.sourceIds || [])],
    originalSuggestion: option?.text || null,
    ruleVersion: question.ruleVersion || null,
    route: question.route || null,
    contextSnapshot: question.contextSnapshot || null,
  };
}
