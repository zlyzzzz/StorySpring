# StorySpring

StorySpring helps users create English stories through editable guided choices or free-written prompts. The interface uses DeepSeek for options, names, adaptive follow-up questions and approximately 3,000-word stories. History stays in this browser and device.

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

| File                                | Purpose / 功能                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `server/prompts.mjs`                | English generation instructions for options, names, follow-ups and stories / 所有 AI 设定词 |
| `questions.json`                    | Five categories and fourteen required questions; no fixed option text / 大类和核心题        |
| `server/suggestions.mjs`            | Generate and validate 50 options / 候选生成及格式检查                                       |
| `server/names.mjs`                  | Generate and validate 50 names / 名字生成及检查                                             |
| `server/followups.mjs`              | Generate a question linked to an answered parent, then prepare its bank / 关联追问          |
| `server/story.mjs`                  | Generate the story and check the 2,700–3,300-word range / 故事生成与字数检查                |
| `server/deepseek.mjs`               | DeepSeek HTTP connection; key remains server-side / 接口调用                                |
| `server/index.mjs`                  | Start server, serve assets and expose API endpoints / 后端入口                              |
| `app.js`                            | Pages, navigation, editing, timer and API interactions / 前端交互                           |
| `styles.css`, `index.html`, `ui.js` | Layout, styling, icons and page shell / 页面及图标                                          |
| `option-rules.js`                   | Randomly display 3 candidates; exhaust 50 before cycling / 换批规则                         |
| `answer-state.js`                   | Answer provenance and inclusive reminders at 25, 35, 45 / 修改来源及提醒门槛                |
| `core-progress.js`                  | All categories' required answers must be completed / 核心题门槛                             |
| `branch-state.js`                   | Remove descendants after a confirmed changed answer / 分支同步删除                          |
| `answer-edits.js`                   | Count and highlight user modifications / 修改数量及高亮                                     |
| `story-storage.js`                  | Browser-local records, versions and persistence / 本机历史记录                              |
| `word-download.js`, `docx.mjs`      | Word export; bundled dependency license included / Word 导出                                |
| `tests/`                            | Run `npm test` for validation / 自动检查                                                    |

## Candidate lifecycle / 选项流程

The first visit to an uncached question requests 50 contextual candidates from DeepSeek. The browser saves that bank with the draft and displays 3 at random. “New suggestions” rotates through this bank without another AI call; the previous batch is excluded. After all 50 have appeared, a new random cycle begins. A new draft prepares its own banks. Names use a separate bank and explicit selection; requesting names never overwrites a typed name. Different users may receive overlapping suggestions; global uniqueness is not guaranteed.

首次进入尚无候选的题目时才调用 DeepSeek，生成并检查 50 个候选。当前草稿保存候选；每次换批随机展示 3 个，优先未展示的，不与上一批重复。没有预先编写的固定选项池，也不调用外部知识库。模型响应可能重复或不合格式，后端会检查并最多尝试三次；仍失败时显示错误并保留答案，不伪造替代内容。首次准备选项或追问需要等待网络和模型响应。

Each adaptive follow-up uses confirmed answers, previous questions, the selected category and an answered parent ID. The parent link is validated before options are generated. Wording and duplicate checks are automatic; they do not guarantee perfect semantic relevance.

Reminders appear at **at least 25, 35 and 45 saved answers**, once per milestone per draft. There is no question-count cap. Stories target 3,000 English words; one bounded revision is allowed if the first result falls outside 2,700–3,300 words.

Local records and generated banks use `localStorage`, not a shared server database. Clearing browser data removes local history. AI calls require an internet connection and provider credit. Keep the private key only in `.env` locally or hosting environment variables.

## Included licenses

`Caveat-OFL.txt` covers the font. `docx-LICENSE.txt` covers the bundled Word-export library. These files must remain with distributed copies.
