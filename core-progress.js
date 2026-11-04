// Only confirmed, non-empty core answers count toward guided story generation.
export function coreProgress(questions, answers = {}, category = null) {
  const required = [
    ...new Map(
      questions
        .filter(
          (question) =>
            !question.extension &&
            (!category || question.category === category),
        )
        .map((question) => [question.id, question]),
    ).values(),
  ];
  const completed = required.filter(
    (question) =>
      typeof answers[question.id] === "string" &&
      answers[question.id].trim().length > 0,
  ).length;
  return {
    completed,
    total: required.length,
    remaining: required.length - completed,
    ready: required.length > 0 && completed === required.length,
  };
}
