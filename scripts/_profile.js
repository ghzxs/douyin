// 公共配置：专用浏览器登录态目录 + Chrome 通道。
// 登录态默认存到 ~/.douyin-benchmark/chrome-profile（本地，永不提交）。
const path = require('path'), os = require('os');

const PROFILE_DIR = process.env.DOUYIN_PROFILE_DIR
  || path.join(os.homedir(), '.douyin-benchmark', 'chrome-profile');

// 浏览器通道：默认系统 Chrome；没装 Chrome 可设 DOUYIN_BROWSER_CHANNEL=chromium 并先 `npx playwright install chromium`
const CHANNEL = process.env.DOUYIN_BROWSER_CHANNEL || 'chrome';

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function assertSafeProfileDir() {
  const resolved = path.resolve(PROFILE_DIR);
  const dailyChromeRoots = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
    path.join(os.homedir(), '.config', 'google-chrome'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data') : null,
  ].filter(Boolean).map(item => path.resolve(item));
  if (dailyChromeRoots.some(root => resolved === root || resolved.startsWith(root + path.sep))) {
    throw new Error('DOUYIN_PROFILE_DIR 不能指向日常 Chrome 用户目录；请使用默认专用目录，避免锁冲突或个人配置损坏。');
  }
}

// 反检测的持久化上下文启动参数
function launchOpts(extra = {}) {
  const opts = {
    headless: extra.headless ?? envBool('DOUYIN_HEADLESS', false),
    viewport: { width: 1440, height: 900 },
    locale: process.env.DOUYIN_LOCALE || 'zh-CN',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
    ...extra,
  };
  // 默认沿用已安装浏览器自己的 UA，避免固定旧版本 UA 与真实 Chrome 版本冲突。
  if (process.env.DOUYIN_USER_AGENT) opts.userAgent = process.env.DOUYIN_USER_AGENT;
  if (process.env.DOUYIN_TIMEZONE) opts.timezoneId = process.env.DOUYIN_TIMEZONE;
  if (CHANNEL !== 'chromium') opts.channel = CHANNEL;
  return opts;
}

module.exports = { PROFILE_DIR, CHANNEL, envBool, assertSafeProfileDir, launchOpts };
