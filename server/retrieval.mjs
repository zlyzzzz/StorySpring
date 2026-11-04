import { DatabaseSync } from "node:sqlite";

const stopWords = new Set(
  "a an the and or to of in on for with their they them it is are be what how would story character".split(
    " ",
  ),
);

export function openRetrieval(filename) {
  const database = new DatabaseSync(filename, { readOnly: true });
  const search = database.prepare(`
    SELECT m.*, bm25(search) AS score FROM search
    JOIN materials m ON m.id=search.id
    WHERE search MATCH ? ORDER BY score LIMIT 12
  `);
  return {
    count: database.prepare("SELECT count(*) AS total FROM materials").get()
      .total,
    find(text) {
      // Bound and quote tokens; user text cannot become SQL or FTS operators.
      const tokens = [
        ...new Set(
          (text.toLowerCase().match(/[a-z]{3,}/g) || []).filter(
            (token) => !stopWords.has(token),
          ),
        ),
      ].slice(-18);
      if (!tokens.length) return [];
      return search.all(tokens.map((token) => `"${token}"`).join(" OR "));
    },
    close() {
      database.close();
    },
  };
}
