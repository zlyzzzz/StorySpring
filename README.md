# StorySpring

StorySpring helps users create English stories through editable guided choices or free-written prompts. Fixed core questions use preset options and names. DeepSeek creates adaptive follow-up questions, their options and approximately 2,000-word stories. History stays in this browser and device.

## Run locally / 本机运行

1. Install Node.js 24. No third-party npm installation or build is needed.
2. Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY`. Do not upload `.env`.
3. Double-click `Start-StorySpring.cmd`, or run `npm start` in this folder.
4. Open http://127.0.0.1:3013 and keep the server window open.

## Render deployment / Render 部署

Upload this folder's contents to the GitHub repository root, keeping the `server` and `tests` folders intact. Do not upload the ZIP itself or `.env`.

- Service type: Web Service; runtime: Node.
- Root Directory: blank, if `package.json` is at the repository root.
- Build Command: `node --check server/index.mjs`
- Start Command: `npm start`
- Environment: `NODE_VERSION=24.16.0`, `HOST=0.0.0.0`, `DEEPSEEK_API_KEY=your private key`, `DEEPSEEK_MODEL=deepseek-flash`.
- Render supplies `PORT`; do not hard-code it in hosting settings.

Replace any previous build command that downloaded data. Remove old `MATERIALS_DOWNLOAD_URL` and `STORYSPRING_DATABASE` variables. This version has no external database, downloaded material or SQLite dependency. Hosted AI requests use the server's environment key, so visitors do not configure a key on their own devices.

## Where to edit / 修改位置

| File                                | Purpose / 功能                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `server/prompts.mjs`                | English generation instructions for adaptive options, follow-ups, stories and passage alignment / 所有 AI 设定词 |
| `questions.json`                    | Five categories and fourteen required questions; no fixed option text / 大类和核心题                             |
| `server/suggestions.mjs`            | Generate and validate 9 adaptive options / 每批9个拓展候选                                                       |
| `server/names.mjs`                  | Validate 50 preset names / 检查预设名字                                                                          |
| `server/followups.mjs`              | Generate a question linked to an answered parent, then prepare its bank / 关联追问                               |
| `server/story.mjs`                  | Generate the story and check the 1,600–2,400-word range / 故事生成与字数检查                                     |
| `server/deepseek.mjs`               | DeepSeek HTTP connection; key remains server-side / 接口调用                                                     |
| `server/index.mjs`                  | Start server, serve assets and expose API endpoints / 后端入口                                                   |
| `app.js`                            | Pages, navigation, editing, timer and API interactions / 前端交互                                                |
| `styles.css`, `index.html`, `ui.js` | Layout, styling, icons and page shell / 页面及图标                                                               |
| `option-rules.js`                   | Random display: 50 presets or 9-per-batch adaptive options, capped at 45 / 换批规则                              |
| `answer-state.js`                   | Answer provenance and inclusive reminders at 25, 35, 45 / 修改来源及提醒门槛                                     |
| `core-progress.js`                  | All categories' required answers must be completed / 核心题门槛                                                  |
| `branch-state.js`                   | Remove descendants after a confirmed changed answer / 分支同步删除                                               |
| `answer-edits.js`                   | Count and highlight user modifications / 修改数量及高亮                                                          |
| `story-storage.js`                  | Browser-local records, versions and persistence / 本机历史记录                                                   |
| `word-download.js`, `docx.mjs`      | Word export; bundled dependency license included / Word 导出                                                     |
| `core-options.json`                 | 14 preset option banks and 50 names / 核心题及名字池                                                             |
| `server/annotations.mjs`            | Locate and validate passages for choice markers / 故事原文标注                                                   |
| `tests/`                            | Run `npm test` for validation / 自动检查                                                                         |

## Candidate lifecycle / 选项流程

Each fixed core question has exactly 50 preset candidates in `core-options.json`. All devices use this same content bank, but independently shuffle it and display 3 candidates. There is no runtime AI call for a core question or name. Each draft keeps its own display history; refresh prioritizes unseen candidates and avoids the immediately preceding three. After exhausting the bank, a new cycle begins. Names use a separate preset bank of 50 and require explicit selection; users may also type their own.

固定核心题每题预设50个候选，所有设备使用同一份池子，各自随机显示3个，概率相同、优先未显示候选。不是每位用户打开核心题都调用AI。名字也预设50个，可换批或自行输入。固定选项不会自动适应已选情境；用户可编辑解决不一致，最终故事模型会结合所有确认内容。

An uncached adaptive follow-up is generated live from confirmed answers, then receives 9 contextual options. Three are sampled without repeating previously displayed options. Once all nine are shown, the next refresh requests another nine, excluding all earlier generated and displayed wording. Five batches are permitted: 9, 18, 27, 36, 45 total candidates per follow-up. At 45 shown, refresh is disabled; users may still edit a suggestion or write their own answer. Banks and display history are saved with the draft. Core questions and names retain their preset 50-option rotating pools.

Each adaptive follow-up uses confirmed answers, previous questions, the selected category and an answered parent ID. Core roots are visited in the order displayed in the category. First round: core 1, core 2, core 3. Next round: the last answered follow-up on branch 1, then branch 2, then branch 3. The server assigns exactly one parent per question. Deleted branches are refilled in core order before the next round, and previously confirmed history remains intact. The parent link is validated before options are generated. Wording and duplicate checks are automatic; they do not guarantee perfect semantic relevance.

Reminders appear at **at least 25, 35 and 45 saved answers**, once per milestone per draft. There is no question-count cap. Stories target 2,000 English words; one bounded revision is allowed if the first result falls outside 1,600–2,400 words.

Local records and generated banks use `localStorage`, not a shared server database. Clearing browser data removes local history. AI calls require an internet connection and provider credit. Keep the private key only in `.env` locally or hosting environment variables.

## Included licenses

`Caveat-OFL.txt` covers the font. `docx-LICENSE.txt` covers the bundled Word-export library. These files must remain with distributed copies.

## Story choice markers / 故事标注

Story generation does not call passage alignment. Only **Show choice markers** submits an alignment task, then caches the validated matches with that story version. Old saved matches remain available. Quotes must occur exactly in the original story; paraphrased choices can be associated through model-selected evidence. Unlocated choices remain visible. Alignment is interpretive, not proof of complete compliance. See [Render-queue-setup.md](Render-queue-setup.md).

## Streaming stories / 流式故事

DeepSeek is called with `stream: true`. Its SSE deltas are parsed by `server/streaming.mjs`. The task queue exposes protected transient preview text; the browser retrieves increments approximately once per second and shows them in the generation panel before completion. The preview is not a saved story. Incomplete streams fail without saving partial output; a bounded retry may replace the preview. An out-of-range word count triggers one length revision with a clear message and reset preview. Completed stories target 2,000 words (accepted 1,600–2,400).

## 修改位置 / Source map

- `option-rules.js`: 9 per adaptive batch and the 45-option maximum; preset banks remain 50.
- `server/suggestions.mjs`: generate, validate and exclude previous wording for nine new options.
- `server/followups.mjs`: ordered core rounds and the previous round's child as parent.
- `server/task-queue.mjs`, `task-client.js`: FIFO queue, authenticated polling, retries, deduplication and transient progress.
- `server/streaming.mjs`, `server/story.mjs`: provider streaming and bounded length revision.
- `server/annotations.mjs`: on-demand alignment; no automatic alignment during generation.

新拓展题先生成9个，每次显示3个且不重复；用完再补9个，最多45个，不自动循环旧选项。五类核心题及名字仍使用原来的50个预设候选。延伸按页面核心题顺序逐轮进行，第二轮从第一轮各分支的回答继续，分支在故事图中保持连接。标注只在用户点击后生成并缓存。

Completing a category pauses on its last required question. **Do not explore further** closes the modal without advancing; **Save and continue** asks again until **Continue exploring** is chosen. Category progress shows Required and Completed separately. Stories target 2,000 English words, accepted range 1,600–2,400.

Core banks were prepared once during development and stored as editable English strings, then checked for size, wording length and duplicates. They do not come from the old external knowledge datasets. This package contains no external knowledge database or dataset download steps. AI tasks now use a configurable queue, defaulting to 20 active and 200 waiting. Configure the persistent task disk as described in [Render-queue-setup.md](Render-queue-setup.md). The implementation is for a single service instance; simulated tasks do not establish real DeepSeek throughput for 50–100 users.
