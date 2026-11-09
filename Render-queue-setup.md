# StorySpring queue deployment / 排队版部署

## Render settings

Build command: `node --check server/index.mjs`

Start command: `npm start`

Keep Node.js 24, `HOST=0.0.0.0`, the existing DeepSeek key and model settings.

| Environment variable  | Initial value                 | Purpose                              |
| --------------------- | ----------------------------- | ------------------------------------ |
| `AI_MAX_CONCURRENCY`  | `20`                          | Simultaneous AI tasks; allowed 1–100 |
| `AI_MAX_QUEUE`        | `200`                         | Maximum waiting tasks                |
| `AI_TASK_TTL_SECONDS` | `3600`                        | Temporary task retention in seconds  |
| `AI_TASK_DIR`         | `/var/data/storyspring-tasks` | Directory on the persistent disk     |

Use a **paid Render web service**. On its **Disk** page, add a disk mounted at `/var/data`, then set `AI_TASK_DIR` as shown above. Only files inside the mount survive service restarts and redeploys. Run **one instance and one Node process** with this version's file-backed queue. Do not point multiple processes at the same task directory. Render disk-backed services cannot scale to multiple instances; multi-instance operation would require a separate shared queue.

Official instructions: https://render.com/docs/disks

没有挂载磁盘时也可以排队，但 Render 重启或重新部署会丢失临时任务记录。配置了磁盘才具备重启恢复的存储条件。不要在正式实验期间部署更新。

## Task behavior / 任务行为

- Core questions and names use presets and bypass the AI queue.
- AI submission immediately returns a task ID. The browser polls for waiting/running/completed/failed status, displays waiting position and saves the result to the local story library.
- Repeated submissions with the same request identity execute once. A transient network retry reuses that identity. Task results require a private, browser-generated token; provider credentials remain server-side.
- Provider connection failures, HTTP 429 and 5xx responses receive at most one automatic retry per call. Format corrections and story repair have their own bounded limits.
- The same tab keeps pending task credentials in session storage. Reloading and repeating the same action can resume the task. Closing the tab may lose access; cross-device recovery is not provided.
- With persistent storage, an interrupted running task is requeued once after restart. This is **at-least-once recovery**: a provider call that finished just before interruption might be repeated and charged again. Browser deduplication does not guarantee exactly-once provider billing across crashes.
- Temporary task files contain submitted story data while queued/running and results after completion. Completed tasks discard their input. Records expire by default one hour after submission, except currently running tasks. They are never served as website assets.
- Keep `.runtime/`, `.env`, and task files out of GitHub and source submissions. These temporary records are not the old story knowledge database. Saved stories remain browser-local.

## Streaming and on-demand markers / 流式与按需标注

Stories call DeepSeek streaming, and the browser retrieves incremental task preview text about once per second. Only the completed, length-checked result is saved. A retry or length revision replaces the preview and is labelled accordingly. There is no automatic coverage audit or annotation call during generation. Show choice markers starts alignment only when needed and caches the result with that saved version.
Adaptive options arrive in batches of nine, three unseen options per display. After nine are exhausted, refreshing generates the next nine, up to 45. Core options and names remain preconfigured at 50. Follow-ups rotate through core questions in displayed order, then deepen each branch's answer from the preceding round.

## Return navigation / 编辑返回

From Saved story, Continue editing saves the originating review page, map/list mode and scroll position. The editor's Back control restores that route; Back to home remains independent. Editing a generated version still creates a separate draft.

## Validation / 验证范围

Automated tests cover 100 simulated queued tasks with 20 workers, duplicate identities, protected access, restart recovery, nine-option replenishment, ordered parent rounds, SSE parsing and incomplete output rejection. A browser integration test uses a fake provider to verify all 45 unique options, streamed preview before completion and markers generated once on demand. These tests do not establish real DeepSeek capacity for 50–100 simultaneous users.
Keep one instance and one Node process for this file-backed queue. A paid Render instance and persistent disk improve availability and recovery, but do not guarantee provider latency. Validate increasing real-API batches before the experiment. Real API tests incur provider usage charges.
Run `npm test`. Current implementation: `server/task-queue.mjs`, `task-client.js`, `server/streaming.mjs`, `server/story.mjs`, `server/followups.mjs`, `server/suggestions.mjs`.

本轮真实 DeepSeek 联调因连接中断未完成；模拟流式与100任务排队测试通过，不代表真实并发吞吐已验证。
