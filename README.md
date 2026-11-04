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
| `server/suggestions.mjs`            | Generate and validate 50 options / 候选生成及格式检查                                                            |
| `server/names.mjs`                  | Validate 50 preset names / 检查预设名字                                                                          |
| `server/followups.mjs`              | Generate a question linked to an answered parent, then prepare its bank / 关联追问                               |
| `server/story.mjs`                  | Generate the story and check the 1,600–2,400-word range / 故事生成与字数检查                                     |
| `server/deepseek.mjs`               | DeepSeek HTTP connection; key remains server-side / 接口调用                                                     |
| `server/index.mjs`                  | Start server, serve assets and expose API endpoints / 后端入口                                                   |
| `app.js`                            | Pages, navigation, editing, timer and API interactions / 前端交互                                                |
| `styles.css`, `index.html`, `ui.js` | Layout, styling, icons and page shell / 页面及图标                                                               |
| `option-rules.js`                   | Randomly display 3 candidates; exhaust 50 before cycling / 换批规则                                              |
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

An uncached adaptive follow-up is generated live from the existing answers, then receives 50 contextual options. The bank is saved with the draft and reused when refreshing. Invalid responses are retried at most three times; errors preserve existing answers. AI requests require a network connection and may take time.

Each adaptive follow-up uses confirmed answers, previous questions, the selected category and an answered parent ID. Underexplored core branches are prioritized; any answered node in the chosen branch may be a parent, allowing both siblings and deeper descendants. The parent link is validated before options are generated. Wording and duplicate checks are automatic; they do not guarantee perfect semantic relevance.

Reminders appear at **at least 25, 35 and 45 saved answers**, once per milestone per draft. There is no question-count cap. Stories target 2,000 English words; one bounded revision is allowed if the first result falls outside 1,600–2,400 words.

Local records and generated banks use `localStorage`, not a shared server database. Clearing browser data removes local history. AI calls require an internet connection and provider credit. Keep the private key only in `.env` locally or hosting environment variables.

## Included licenses

`Caveat-OFL.txt` covers the font. `docx-LICENSE.txt` covers the bundled Word-export library. These files must remain with distributed copies.

## Story choice markers / 故事标注

`server/annotations.mjs` locates passages that reflect confirmed answers when users first choose **Show choice markers**, including paraphrased content. Returned quotations must occur exactly in the saved original story before a highlight can be shown. Multiple answers may share a passage. Hover, tap or focus a highlight to see its questions and choices. Unlocated choices are listed separately; these interpretive alignments do not prove story quality. Alignment results are saved per version, while the original story and plain Word export remain unchanged. Older locally saved stories can also request alignment. This feature makes an additional DeepSeek request.

Completing a category pauses on its last required question. **Do not explore further** closes the modal without advancing; **Save and continue** asks again until **Continue exploring** is chosen. Category progress shows Required and Completed separately. Stories target 2,000 English words, accepted range 1,600–2,400.

Core banks were prepared once during development and stored as editable English strings, then checked for size, wording length and duplicates. They do not come from the old external knowledge datasets. This package contains no external knowledge database or dataset download steps. Adaptive AI concurrency remains limited; this change reduces core-question requests but does not establish capacity for 50–100 simultaneous AI generations.

## Return navigation and choice coverage

Continue editing opens an editor with an upper-left Back button. It returns to the previous page, retaining the map/list mode, page scroll and map horizontal positions. Guided and free-writing editors both support this return path.

Story generation passes every nonempty confirmed choice as an explicit checklist. After generation, passage alignment identifies choices without located evidence. One bounded revision attempts to integrate these omissions while retaining other choices and the approximate 2,000-word length. Remaining unlocated choices stay visible through marker coverage; alignment is an AI interpretation, not proof of full compliance. Auditing and repair can add AI calls and waiting time. A failed audit still preserves a valid story without claiming full coverage.

This update does not add queueing or increase concurrency: the v12 limit of three active AI tasks remains unchanged.
