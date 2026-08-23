# 拆抖音对标 · douyin-benchmark

输入一个公开抖音账号，采集网页公开作品数据，生成：

- `account_full_raw.json`：账号资料、作品、合集与采集诊断
- `run_status.json`：机器可读的执行阶段、阻塞原因和下一步
- `report_data.json`：保留缺失值的聚合数据
- `调研报告.html`：浅色、可离线打开的数据报告
- `调研报告.md`：由 agent 按九段模板撰写的对标分析

这个项目把“采集/聚合/渲染”做成确定性脚本，把“内容拆解”留给 agent。它不会在数据不完整时把主页总作品数冒充实际样本数，也不会在作品接口空响应后继续生成一份看似完整的报告。

## 数据能力与边界

| 数据 | 可用性 |
|---|---|
| 点赞、评论数、转发数、收藏数 | 网页公开字段；接口缺失时保持 `null` |
| 发布时间、时长、封面、合集名 | 网页公开字段 |
| 合集播放量 | 部分账号公开；缺失显示 `—` |
| 单作品播放量 | 网页端不公开，不采集、不推算 |
| 完播率、涨粉、成交、后台分析 | 他人账号私有，不采集 |
| 评论正文/情感 | 当前不采集，报告不得臆测“热评情感” |

点赞可作为公开热度代理，但不能替代播放量、互动率、完播率或转粉效果。

## 合规与隐私

- 只处理公开可见数据，不破解签名、不绕过验证码或访问控制。
- 使用独立的 `~/.douyin-benchmark/chrome-profile` 登录态，不读取或复制日常 Chrome 配置。
- Cookie 值与真实账号采集结果均不进入仓库。
- 普通登录框、真实安全验证和页面服务异常分别判断；遇到安全验证、页面服务异常或 HTTP 200 空体后停止，不循环重试、不自动换 IP。
- 仅用于个人研究、竞品分析和学习；请遵守抖音用户协议及当地法律。

## 环境

- Node.js ≥ 18
- Python 3.9+（仅标准库）
- Google Chrome；也可使用 Playwright Chromium
- macOS 已验证

## 安装

```bash
git clone https://github.com/9398-haha/douyin-benchmark.git
cd douyin-benchmark
npm ci
```

`package-lock.json` 已提交，以便多端安装一致版本。

## 一次性登录

```bash
npm run login
```

脚本会打开一个专用 Chrome 窗口。完成登录后，脚本只有在同时验证到有效会话和账号入口时才会保存并关闭，不再依赖终端回车。

检查现有会话：

```bash
node scripts/login.js --check
```

不要把 `DOUYIN_PROFILE_DIR` 指向 `~/Library/Application Support/Google/Chrome`。脚本会主动拒绝这种配置，避免与正在运行的日常 Chrome 锁冲突或损坏个人配置。

## 推荐用法：一条命令跑完自动阶段

优先复制抖音 App 的“分享主页”短链：

```bash
OUT="$HOME/douyin-benchmark-output/example-account"
npm run benchmark -- "https://v.douyin.com/xxxx/" "$OUT" --expected-id "抖音号"
```

也可以输入标准主页链接或 `sec_uid`：

```bash
npm run benchmark -- "https://www.douyin.com/user/MS4wLjAB..." "$OUT"
```

只输入昵称/数字抖音号时，脚本会尝试一次站内搜索。若搜索页触发验证，它会停止并要求主页分享链接；不会自动循环搜索。

默认以有头 Chrome 执行，沿用浏览器真实 UA。无图形环境时显式使用：

```bash
npm run benchmark -- "<输入>" "$OUT" --headless
```

自动阶段完成后，agent 读取 `report_data.json` 和 `references/report-template.md`，撰写 `$OUT/调研报告.md`。

## 分步运行

```bash
# 1. 任意账号输入 → sec_uid
node scripts/resolve_secuid.js "<主页分享链接/sec_uid/昵称/抖音号>" "<期望抖音号，可省略>"

# 2. 采集；输出里始终含 capture.status
node scripts/capture_account_full.js "<sec_uid>" "$OUT/account_full_raw.json" 150

# 3. 有可分析作品时聚合
python3 scripts/analyze.py "$OUT"

# 4. 生成 HTML
python3 scripts/build_report_html.py "$OUT"
```

## 状态机

`account_full_raw.json.capture.status` 是交付判断依据：

| 状态 | 含义 | 行为 |
|---|---|---|
| `complete` | 作品接口返回 `has_more=0` | 可写账号级报告；仍检查主页数差异 |
| `partial` | 已拿到作品，但未确认到底 | 可写样本报告，必须标样本/覆盖率 |
| `blocked_empty_body` | 作品接口有响应但 HTTP 200 空体 | 停止，不运行分析；保留资料快照 |
| `challenge` | 页面出现安全验证 | 用户在专用窗口处理后最多重试一次 |
| `login_required` | 页面出现普通登录框 | 运行登录脚本；成功后只重试一次 |
| `page_service_error` | 作品区明确显示页面服务异常 | 停止刷新；确认登录态后最多重试一次 |
| `no_post_response` | 未观察到作品接口 | 检查 `sec_uid`、页面/API 变化 |
| `endpoint_error` | 作品接口返回 HTTP/API 错误或非 JSON | 保留诊断，停止分析并检查 API 变化 |
| `no_works` | 接口返回但无可分析作品 | 只交付资料级结果 |

采集错误使用非零退出码；`run_benchmark.js` 会把阻塞写进 `run_status.json`，不继续生成误导报告。
`capture.diagnostics.page` 只保存页面标题、路径、登录/挑战/服务异常布尔信号和视频链接数，不保存页面正文或 Cookie。

## 报告的数据完整性

`report_data.json` 同时保留：

- `account.profile_works_total`：主页展示作品数
- `account.captured_works`：实际采集数
- `quality.capture_status`：完整/部分/旧数据状态
- `quality.coverage_ratio`：可计算时的覆盖率
- `quality.warnings`：接口差异和采集警告

HTML 会在标题区域显示这些信息。Markdown 模板也要求把事实、观察和推断分开；没有视频/评论证据时不描述镜头、口播、剧情或热评情感。

HTML 的「样本内最新作品」会保留可读标题；「发布节奏」按发布条数展示最近 12 个月。只有 `capture_status=complete` 时才会把中间缺月显示为 0，部分采集只展示实际观察到的月份，避免把未采到的数据误写成未发布。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `DOUYIN_PROFILE_DIR` | `~/.douyin-benchmark/chrome-profile` | 专用登录态目录 |
| `DOUYIN_BROWSER_CHANNEL` | `chrome` | 设为 `chromium` 时先安装 Playwright Chromium |
| `DOUYIN_HEADLESS` | `false` | 显式设 `true` 才启用无头模式 |
| `DOUYIN_SCROLL_WAIT_MS` | `1600` | 每次滚动后的最低等待毫秒数 |
| `DOUYIN_USER_AGENT` | 未设置 | 默认使用浏览器自身 UA，通常不要覆盖 |

## 开发与验证

```bash
npm test
for file in scripts/*.js; do node --check "$file"; done
python3 -m py_compile scripts/*.py
```

离线测试覆盖账号输入解析、登录/挑战/服务异常分类、部分采集完整性、缺失值保留和 HTML 转义，不需要真实登录态。

## License

MIT，见 [LICENSE](LICENSE)。
