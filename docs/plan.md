# 热点监控现状

React + Vite 前端，Express + SQLite 后端，共享类型在 `shared`。前端通过 Vite 把 `/api` 代理到 `127.0.0.1:3001`。开发时 Vite 在 `localhost:5173`，Express 用 `tsx watch` 单独跑。

## 架构

采集在 Express 进程里排队。`POST /api/v1/collect` 返回 202，后台依次采集、打分、匹配关键词。搜索间隔和每日上限留在各采集函数里。

去重使用规范化网址和 SimHash。X 只在规范网址指向同一条推文时并入，不按 SimHash 或向量相似度并到其他来源。Embedding 层固定跳过，设置页说明当前只按网址和 SimHash 合并。

打分在 `server/src/ai/score.ts`。热度和规则可信度在 `formula.ts`，封顶 30 不变。模型调用在 `server/src/ai/deepseek.ts`：一次 `POST https://api.deepseek.com/chat/completions`，`thinking.type` 为 `disabled`，`response_format.type` 为 `json_object`，`max_tokens` 为 4096。主模型 id 是 `deepseek-v4-flash`；若接口以模型错误拒绝它，再请求一次 `deepseek-flash`。用量记在 `usage_daily` 的 `deepseek` 行，只作计数，不拦截打分。没有本地每日请求上限。

## 首页

首页只放近 7 天、并且有发布时间的故事。微博和 B 站不出现。搜索结果只留已知科技站点、官方博客、机器之心和量子位。单独一条 HN 或 GitHub 帖子要有第二个来源才显示。过了官方账号或 10 万粉丝、以及浏览量门槛的 X 可以单独出现。

排序看有没有多个来源、来源强弱、发布时间。先显示 15 条，其余在「更多」后面。卡片标题用模型写的中文事件句。

DeepSeek 把每条候选判成 reliable、uncertain 或 unreliable，并给一句中文理由。unreliable 不进首页。仿冒域名和诈骗用语仍把可信度封顶在 30。单次调用失败就停掉这一轮剩余的模型调用，那些故事走规则。没有密钥或熔断期间，首页只留已经通过权威规则的故事，并标「未经过模型核实」。

关键词搜索用同一扇 7 天窗口：没有发布时间、早于 7 天、或不在权威站点上的搜索命中不入库。关键词推文的查询窗口也是 7 天。

密钥名是 `DEEPSEEK_API_KEY`，示例写在 `server/.env.example`。密钥只放在服务器的 `server/.env`。一次请求超过 20 秒就中止。失败后这一轮不再继续打模型。

健康检查里的分析开关看 `DEEPSEEK_API_KEY` 是否非空，设置页显示为 DeepSeek。

## 里程碑

| 里程碑 | 状态 |
|---|---|
| M0 | 已验收 |
| M1–M4 | 2026-10-26 已完成并验证，等验收。M3 当时走 OpenRouter 免费模型，这一路已经换成 DeepSeek |
| 关键词搜索、来源链接、失败原因 | 已接在 M4 上：关键词会进搜狗或 DuckDuckGo 和 twitterapi.io；卡片链接到来源；模型失败会写出具体原因，而不是盖掉已有摘要 |
| M5 及以后 | 日报在设置页，到点先采主源再推，词搜在推送之后。发现页由用户自建方向。邮件按确认不做。后续范围见 `docs/improvement.md` |
