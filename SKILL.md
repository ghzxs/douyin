---
name: douyin-benchmark
description: 拆解公开抖音账号，采集其公开作品互动数据、账号资料与合集数据，并产出带完整性状态的原始 JSON、九段式 Markdown 和浅色 HTML 对标报告。Use when the user says “拆对标”“拆抖音对标”“分析这个抖音号”“对标调研”，或提供抖音主页分享链接、sec_uid、抖音号、昵称并要求账号级竞品分析。优先处理主页分享链接。NOT for 自有账号后台数据、单条视频下载/转录、单作品播放量、发帖评论等写操作。
---

# 拆抖音对标

把公开账号采集、数据聚合和 HTML 渲染交给脚本；由 agent 基于 `report_data.json` 撰写有证据边界的 Markdown 报告。

## 遵守边界

- 只采集网页公开可见数据；不破解签名、不绕过验证码或访问控制。
- 只使用 `~/.douyin-benchmark/chrome-profile` 专用登录态。不要读取、复制或直接指向用户日常 Chrome 用户目录，不输出 Cookie 值。
- 缺失值保持缺失，不改写为 `0`。点赞只能作为公开热度代理，不能称为播放表现、互动率或转粉效果。
- 普通登录框、真实安全验证、页面服务异常分别判断。遇到安全验证、页面服务异常或空响应软拦截后停止；不要循环重试、自动换 IP、自动创建延时任务或承诺稍后完成。

## 首次准备

在本 Skill 目录执行：

```bash
npm ci
node scripts/login.js
```

`login.js` 打开专用浏览器，验证到真实账号入口后自动保存并关闭。检查已有登录态时运行 `node scripts/login.js --check`。

## 一键执行

优先让用户提供抖音 App 的“分享主页”短链。数字抖音号不是 `sec_uid`；直接拼 `/user/<数字>` 可能静默回到信息流。

```bash
OUT="$HOME/douyin-benchmark-output/<账号标识>"
node scripts/run_benchmark.js "<主页分享链接/sec_uid/抖音号/昵称>" "$OUT" \
  --expected-id "<抖音号，可省略>"
```

默认使用有头 Chrome，提高可观察性并匹配真实浏览器 UA。无图形环境才显式加 `--headless`。脚本依次执行：

1. 解析短链或 `sec_uid`；只有昵称/抖音号时才使用站内搜索。
2. 采集资料、作品、合集并写 `account_full_raw.json`。
3. 有作品时生成 `report_data.json` 与 `调研报告.html`。
4. 全程更新 `run_status.json`，不在失败后继续分析。

## 先读状态，再写结论

读取 `run_status.json` 与 `account_full_raw.json.capture`：

- `complete`：接口返回 `has_more=0`。可以写账号级报告；仍核对主页作品数与采集数差异。
- `partial`：只写“已采集样本报告”，在标题附近标出样本量、主页总量和覆盖率；不要使用“全量”“账号最高”等字眼。
- `blocked_empty_body`：作品接口 HTTP 200 但空体。停止请求，只交付资料快照和诊断；稍后重试必须由用户决定，且最多一次。
- `challenge`：让用户在专用浏览器完成验证后再试一次，不尝试绕过。
- `login_required`：页面是普通登录框，并非安全验证。运行登录脚本，成功后只重试一次。
- `page_service_error`：作品区明确显示“服务异常，重新刷新拉取数据”。停止刷新；确认登录态后最多重试一次。
- `no_post_response`：可能是输入错误或页面/API 变化。先检查 `sec_uid` 与有头页面，不盲目加滚动次数。
- `endpoint_error`：作品接口返回 HTTP/API 错误或非 JSON 内容。保留诊断并停止分析，先检查页面/API 变化。

## 撰写 Markdown

仅在 `report_data.json` 存在且含可分析作品时，完整读取 `references/report-template.md`，按九段结构写 `$OUT/调研报告.md`。

把内容分成三类并明确措辞：

- **事实**：JSON 中的公开字段和计算结果。
- **观察**：标题、简介、合集名、封面或实际打开过的视频呈现。
- **推断**：人设、变现路径、内容公式；写出证据和置信度，不当成事实。

没有评论正文就不写“热评情感”；没有观看视频就不声称镜头、口播、剧情或表演细节。用户指定自身赛道时，再把可复制清单定向迁移。

## 验收

- `account_full_raw.json`、`run_status.json`、`report_data.json`、`调研报告.html`、`调研报告.md` 状态一致。
- HTML 和 Markdown 都显示实际采集样本、主页作品数、覆盖率与 `capture_status`。
- 阻塞时检查 `capture.diagnostics.page`：只记录标题、路径、登录/挑战/服务异常布尔信号与视频链接数，不保存正文或 Cookie。
- 数字逐项对照 `report_data.json`；缺失值显示 `—`/未知。
- HTML 可离线打开，外部文本已转义；封面失败不影响正文。
- HTML 不出现整页横向溢出；最新作品标题可读。发布节奏按发布条数展示最近 12 个月，只有完整采集才把缺月补为 0。
- Markdown 九段齐全，含数据口径、证据边界、可复制清单和不可照搬项。

## 配置

- `DOUYIN_PROFILE_DIR`：专用登录态目录；默认 `~/.douyin-benchmark/chrome-profile`。
- `DOUYIN_BROWSER_CHANNEL`：默认 `chrome`；设 `chromium` 时先安装 Playwright Chromium。
- `DOUYIN_HEADLESS=true`：显式启用无头模式；默认有头。
- `DOUYIN_SCROLL_WAIT_MS`：滚动间隔下限，默认 1600ms；不要用它做高频采集。
