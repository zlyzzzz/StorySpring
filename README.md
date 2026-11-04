# StorySpring — adaptive question and retrieval preview (v7)

## Run locally

Requires Node.js 24 or later. No npm dependencies or model training are needed.

1. Copy `.env.example` to `.env` and enter the DeepSeek key locally.
2. Double-click `Start-StorySpring.cmd` or run `npm start`.
3. Open `http://127.0.0.1:3013/`.

The key is loaded on the server only. Keep `.env` out of GitHub and submitted source packages.
The supplied database belongs in `server/data/materials.sqlite`.
This lightweight source package excludes the database. See GitHub上传与Render配置.md to restore it from a release asset or local archive.

## Current behaviour

- Fourteen required answers: characters 3, setting 3, plot 3, theme 2, narration 3.
- Every category supports AI follow-ups without a configured question-count ceiling.
- An explicit answered parent connects each follow-up to the story map.
- Six candidates are generated and validated per question; three are randomly displayed.
- Refreshing displays three alternatives from that six-item pool. It does not make a new paid request.
- Suggestions remain editable in place; custom writing is a separate selectable answer.
- After 25, 35 and 45 answers, the next saved answer (26/36/46) triggers one reminder per threshold.
- Core completion still offers the category-switch prompt. The old every-five-extra reminder is removed.
- Generation is available only after all required answers, or a nonempty free-writing brief.
- Story target: 5,000 English words, accepted range 4,500–5,500. One automatic revision is allowed.
- Incomplete provider output or an out-of-range revision is reported instead of saved as a finished story.
- Each successful generation creates a numbered saved version, with planning time and actual word count.
- Waiting for follow-ups or story generation does not add to planning time.
- Drafts and generated stories remain in the current browser's localStorage.

Port 3013 has a different browser storage origin from the earlier port 3012.
Existing port-3012 records remain there; this preview does not silently transfer them.

## Source map

| File | Responsibility |
| --- | --- |
| `questions.json` | Required questions and legacy question definitions |
| `preview-v2.js` | UI, navigation, answer snapshots, asynchronous follow-ups and story creation |
| `preview.css` | Layout, responsive styling and answer selection states |
| `core-progress.js` | Required-answer counting and generation eligibility |
| `story-storage.js` | Local drafts, immutable generated versions and recoverable deletion |
| `word-download.js` | Readable Word export of the story or questions and answers |
| `server/index.mjs` | API routes, server-side generation gate and static-file allowlist |
| `server/retrieval.mjs` | SQLite FTS5 search, ranked results and source metadata |
| `server/followups.mjs` | Follow-up prompts, output validation, story length target and bounded revision |
| `server/deepseek.mjs` | DeepSeek-only API request and response checks |
| `tools/build_retrieval.py` | Rebuild searchable database from the earlier processing run |
| `research/materials.manifest.json` | Counts, input/output hashes and acceptance record |
| `tests/retrieval.test.mjs` | Retrieval, parent/source validation and word-count checks |

`adaptive-characters.js`, its tests, and `character-catalog.json` remain for compatibility with
previously saved pilot questions. Their former ten-question template limit does not govern new questions.
`tools/serve.mjs` is the old static-only server; use `server/index.mjs` for AI functionality.

## Retrieval and attribution

The database contains 235,607 contextual motivation/emotion materials derived from Story Commonsense
training annotations. On 2026-11-04 the project owner accepted these pending materials in bulk.
The original processing database is unchanged. `original_review_status` remains `pending`;
the derivative records `owner_batch_accepted_2026-11-04` separately. This is not individual review evidence.

For character follow-ups, the most recent five relevant answers supply search terms. FTS5/BM25 retrieves
up to twelve contextual annotations. The model receives the confirmed answers, earlier questions and
retrieved material, then proposes a new question and six options. Other categories currently use the
confirmed answers and AI-authored suggestions, because this database is not a style or world-building corpus.

Each selected answer records the question, candidate batch, final wording, parent ID, context snapshot,
generation rule version, origin and source IDs. Retrieved candidates also retain the original file,
record index, story ID and annotation text. An AI-authored option has no invented dataset citation.
Editing a sourced option preserves its original source link and marks the answer as user-edited.

The server checks question/option lengths, six unique candidates, an answered parent, previous exact
question duplicates, and valid retrieved source IDs. These checks do not prove semantic consistency
or that a cited adaptation is faithful. Participant testing should still check relevance, repetition,
unwanted assumptions and adaptation quality. No claim of validated educational or cognitive benefit is made.

Source: [Story Commonsense official site](https://uwnlp.github.io/storycommonsense/).
API: [DeepSeek Chat Completions documentation](https://api-docs.deepseek.com/api/create-chat-completion/).

## Rebuild with an auditable script

```powershell
python tools/build_retrieval.py --database "PATH_TO_ORIGINAL/storyspring_materials.sqlite" --output "server/data/materials.sqlite"
```

Use a new output path when a database already exists. The script deliberately refuses to overwrite prior
evidence. The original database, raw corpora and previous preprocessing scripts are in the separate
`storyspring-data-guide/preparation` research folder. This derivative uses neither WritingPrompts stories
nor the ROCStories subset as independent additional sources.

Run checks with `npm test`. The Node SQLite API may display its experimental-feature warning.
This is a local development server. Public deployment, multi-user quotas and access controls have not
been configured in this preview.
