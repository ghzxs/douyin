// 登录并验证专用抖音会话。默认自动检测成功，无需终端回车。
// 用法: node scripts/login.js [--check] [--timeout 600]
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { PROFILE_DIR, assertSafeProfileDir, launchOpts } = require('./_profile');
const { classifyPageSignals } = require('./_page_signals');

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function loginState(ctx, page) {
  const cookies = await ctx.cookies('https://www.douyin.com/');
  const names = new Set(cookies.map(c => c.name));
  const hasStrongSession = names.has('passport_auth_mix_state')
    || names.has('sessionid')
    || names.has('sessionid_ss')
    || (names.has('uid_tt') && names.has('sid_tt'));
  const observed = await page.evaluate(() => {
    const title = document.title || '';
    const text = (document.body?.innerText || '').slice(0, 1800);
    const userEntry = !!document.querySelector(
      'a[href*="/user/self"], a[href^="/user/"][href*="from_tab_name"], [data-e2e*="avatar"], [class*="avatar"]'
    );
    return { title, text, userEntry };
  }).catch(() => ({ title: '', text: '', userEntry: false }));
  const pageState = {
    ...classifyPageSignals({ ...observed, url: page.url() }),
    userEntry: observed.userEntry,
  };
  return {
    authenticated: hasStrongSession && pageState.userEntry && !pageState.loginPrompt && !pageState.challenged,
    challenged: pageState.challenged,
    loginPrompt: pageState.loginPrompt,
    serviceError: pageState.serviceError,
    hasStrongSession,
    userEntry: pageState.userEntry,
  };
}

async function main() {
  assertSafeProfileDir();
  const checkOnly = process.argv.includes('--check');
  const timeoutSec = Math.max(30, Number(argValue('--timeout', '600')) || 600);
  console.log('专用登录态目录:', PROFILE_DIR);
  const ctx = await chromium.launchPersistentContext(
    PROFILE_DIR,
    launchOpts({ headless: process.argv.includes('--headless') })
  );
  try {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 45000 })
      .catch(() => {});
    await page.waitForTimeout(4000);

    if (checkOnly) {
      const state = await loginState(ctx, page);
      console.log(JSON.stringify({ status: state.authenticated ? 'authenticated' : 'not_authenticated', ...state }));
      return state.authenticated ? 0 : 3;
    }

    console.log('请在弹出的专用 Chrome 窗口完成登录；验证成功后会自动保存并关闭。');
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      const state = await loginState(ctx, page);
      if (state.authenticated) {
        console.log(JSON.stringify({ status: 'authenticated', profile_dir: PROFILE_DIR }));
        return 0;
      }
      if (state.challenged) console.error('检测到安全验证，请在当前窗口手动完成。');
      process.stderr.write('\r等待登录验证...');
      await page.waitForTimeout(2500);
    }
    console.error('\n超时：未验证到有效登录态。请确认页面已显示账号头像/个人入口后重试。');
    return 3;
  } finally {
    await ctx.close();
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error('ERR', error.message);
  process.exitCode = 1;
});
