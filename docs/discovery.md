# 兴趣发现

发现页用来找一个方向上的新故事，不用先填一条精确关键词。页面一开始是空的。方向由自己添加，存在本地 SQLite 里，重启还在。

## 做了什么

导航「发现」打开这一页。每个方向有一个名称，加上自己写的搜索词，最多 5 个。可以添加、改名（名称和搜索词一起改）、删除。最多 20 个方向。名称和每个搜索词最长 40 个字。同名（不区分大小写）不能再加一个。

卡片只出现在发现页。中文摘要仍走原来的 DeepSeek 打分。兴趣命中不会把故事标成首页必须显示，也不会因为兴趣命中去发微信。微信推送仍只来自关键词监控和日报。

接口：

- `GET /api/v1/discover` 读方向和这一页的故事
- `POST /api/v1/discover` 添加，正文是 `{ "label", "terms" }`
- `PATCH /api/v1/discover/:id` 改名称和搜索词
- `DELETE /api/v1/discover/:id` 删除

## 默认

`interests` 表一开始没有行。没有预置的「AI / 大模型」「开源」「芯片」。不添加方向时，发现页没有卡片，采集也不会为发现多发一次搜索。

表的列是 `id`、`label`、`terms`（JSON 数组）、`aliases`（JSON 对象）、`created_at`。迁移是 `0007_interests.sql`、`0008_interest_terms.sql`、`0009_interest_aliases.sql`。

## 采集

点首页「立即采集」时，原来的来源照旧拉：RSS、Hacker News、GitHub、arXiv、搜狗或 DuckDuckGo、以及已经配置密钥时的 X。不新开网站。微博和 B 站仍会采集，但发现页和首页都不用它们。

每个已保存方向的搜索词，再走一遍和关键词一样的额外搜索：搜狗或 DuckDuckGo（不走 Google），有 `TWITTERAPI_IO_API_KEY` 时再搜 X。时间窗是近 7 天。多个方向里相同的词只搜一次。

采集只拿你写下的那些词去搜。别名不拿去搜，所以别名不会把每天的搜索次数撑大。

## 别名

静态词表盖不住任意搜索词，所以在保存时问一次现有的 DeepSeek。添加方向会问。只改名称、搜索词没变，不问。搜索词变了再问一次。发现页和首页读取都不问。

没有 `DEEPSEEK_API_KEY`，或这次调用失败，方向仍会保存，这一次不写入模型别名。失败只打一行 `[discover] alias expansion failed`，不打密钥。

问的是每个词最多 4 个中文和英文说法。写入前会丢掉空的、超过 40 字的、和原词重复的，并且每个词只留 4 个。存在该方向的 `aliases` 里，键是搜索词。

匹配时，标题、摘要或来源片段里出现搜索词，或出现它存下来的别名，都算这个方向。比较不区分大小写，整段包含即可。另外，没有存到模型别名时，「大模型」仍会匹配 “language model” 和「语言模型」。这只是这一对的兜底，其他词没有这张静态表。

## 卡片

近 7 天、有发布时间、不是微博或 B 站的故事，对上某个方向，才会出现。最多 30 张，新的在前。摘要优先用已有的中文摘要。兴趣命中会进入原来的 DeepSeek 摘要批次，但不会因此把 `relevant` 写成真，所以单靠兴趣对上的故事不会被推上首页。首页门槛不变：微博和 B 站不上首页，单独一条 Hacker News 或 GitHub 仍要有第二个来源才上首页，X 仍是原来的官方名单或粉丝与浏览量规则。

代码在 `server/src/discover/interests.ts`、`server/src/discover/aliases.ts`，采集接在 `server/src/collect/run.ts`，摘要批次在 `server/src/ai/score.ts`。页面在 `web/src/pages/PlaceholderPages.tsx` 的发现页。
