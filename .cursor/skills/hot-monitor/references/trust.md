# 可信名单与仿冒

这份名单是判断用的，不是要用户去配置的密钥或服务。用户在这句话里额外点名某个域名或 X 账号可信时，这一次回答把它算进名单。不要写进文件。

## 官方域名

`openai.com`、`anthropic.com`、`deepmind.google`、`ai.google`、`blog.google`、`huggingface.co`、`github.com`、`arxiv.org`、`nvidia.com`、`microsoft.com`、`meta.com`

子域名算在内，例如 `news.ycombinator.com` 不算官方。比较时去掉开头的 `www.`。

## 已知媒体

`reuters.com`、`apnews.com`、`bbc.com`、`bbc.co.uk`、`nytimes.com`、`wsj.com`、`theverge.com`、`techcrunch.com`、`nature.com`、`science.org`、`36kr.com`、`jiqizhixin.com`、`qbitai.com`

## 官方 X 账号

比较前去掉 `@`，不区分大小写。

`openai`、`openaidevs`、`chatgptapp`、`openainewsroom`、`deepseek_ai`、`anthropicai`、`google`、`googleai`、`googledeepmind`、`xai`、`aiatmeta`、`huggingface`、`nvidia`、`nvidiaai`、`microsoft`、`microsoftai`、`github`

## 黑名单

`news-openai.com`、`openai-giveaway.com` 以及它们的子域名。见到就封顶。

## 诈骗用语

正文出现这些意思就封顶：加微信、稳赚、内部渠道、免费领取、日入、保本。

## 仿冒

官方域名和上面的官方账号本身不是仿冒。

下面这些品牌词出现在其他域名或其他账号里，视为仿冒：`openai`、`chatgpt`、`anthropic`、`deepmind`、`huggingface`、`nvidia`。

判断前把字符折成小写字母：`0` 看成 `o`，`1` 看成 `l`，去掉其余符号。品牌词被包含，或与某个标签只差一个编辑距离，都算仿冒。例如 `openai-login.example`、`0penai`。

仿冒、黑名单、诈骗三者任一成立，可信度不超过 30，裁决为 `unreliable`，关键词核对直接拒绝。
