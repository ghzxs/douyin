// 主页分享链接 / sec_uid / 抖音号 / 昵称 → sec_uid。
// 用法: node scripts/resolve_secuid.js "<输入>" [期望抖音号]
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const { assertSafeProfileDir, launchOpts } = require('./_profile');
const { extractSecUid, parseDouyinUrl, resolveDouyinRedirect } = require('./_account_input');
const { classifyPageSignals } = require('./_page_signals');

const INPUT = process.argv[2] || '';
const WANT = (process.argv[3] || (/^\d{3,}$/.test(INPUT.trim()) ? INPUT.trim() : '')).toLowerCase();

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function parseProfileResponse(response) {
  if (!response.url().includes('/aweme/v1/web/user/profile/other/')) return null;
  try {
    const body = await response.body();
    if (!body.length) return null;
    const data = JSON.parse(body.toString('utf8'));
    const user = data && data.user;
    return user && user.sec_uid ? {
      uid: user.sec_uid,
      href: `https://www.douyin.com/user/${user.sec_uid}`,
      txt: [user.nickname, user.unique_id].filter(Boolean).join(' · '),
    } : null;
  } catch (_) { return null; }
}

async function pageSignals(page) {
  const observed = await page.evaluate(() => {
    const text = (document.body?.innerText || '').slice(0, 1600);
    const title = document.title || '';
    return { text, title };
  }).catch(() => ({ text: '', title: '' }));
  return { ...classifyPageSignals({ ...observed, url: page.url() }), title: observed.title };
}

async function resolveWithProfile(input) {
  const { PROFILE_DIR } = require('./_profile');
  assertSafeProfileDir();
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts());
  try {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    let profileHit = null;
    const pending = new Set();
    page.on('response', response => {
      const task = parseProfileResponse(response).then(hit => { if (hit) profileHit = hit; });
      pending.add(task);
      task.finally(() => pending.delete(task));
    });

    const inputUrl = parseDouyinUrl(input);
    if (inputUrl) {
      await page.goto(inputUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await page.waitForTimeout(6000);
      await Promise.allSettled([...pending]);
      const direct = extractSecUid(page.url());
      if (direct) return { status: 'ok', method: 'browser_redirect', hit: { uid: direct, href: `https://www.douyin.com/user/${direct}` } };
      if (profileHit && (!WANT || profileHit.txt.toLowerCase().includes(WANT))) {
        return { status: 'ok', method: 'profile_response', hit: profileHit };
      }
      if (profileHit && WANT) {
        return {
          status: 'not_found',
          method: 'profile_response',
          hit: null,
          all: [profileHit],
          next_action: `主页账号与期望抖音号 ${WANT} 不一致，请重新核对分享链接。`,
        };
      }
      const signals = await pageSignals(page);
      return {
        status: signals.loginPrompt ? 'login_required' : signals.challenged ? 'challenge' : 'not_found',
        method: 'homepage',
        hit: null,
        next_action: signals.loginPrompt
          ? '运行 node scripts/login.js 完成专用登录；登录成功后只重试一次。'
          : signals.challenged
            ? '在专用登录窗口完成验证后只重试一次。'
            : '请提供该账号的“分享主页”短链；数字路径不等于 sec_uid。',
      };
    }

    const searchUrl = 'https://www.douyin.com/search/' + encodeURIComponent(input) + '?type=user';
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(6500);
    const signals = await pageSignals(page);
    if (signals.loginPrompt) {
      return { status: 'login_required', method: 'search', hit: null, next_action: '运行 node scripts/login.js 完成专用登录；登录成功后只重试一次。' };
    }
    if (signals.challenged) {
      return { status: 'challenge', method: 'search', hit: null, next_action: '不要循环搜索；请改用账号“分享主页”短链。' };
    }
    const cards = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('a[href*="/user/"]').forEach(anchor => {
        const box = anchor.closest('li,div');
        const txt = (box ? box.innerText : anchor.innerText || '').replace(/\s+/g, ' ').trim();
        const match = anchor.href.match(/\/user\/([A-Za-z0-9_-]{30,})/);
        if (match && txt) out.push({ uid: match[1], href: anchor.href.split('?')[0], txt: txt.slice(0, 160) });
      });
      const seen = new Set();
      return out.filter(item => item.uid !== 'self' && !seen.has(item.uid) && seen.add(item.uid));
    });
    const hit = WANT
      ? (cards.find(card => card.txt.toLowerCase().includes(WANT)) || null)
      : (cards[0] || null);
    return {
      status: hit ? 'ok' : 'not_found',
      method: 'search',
      hit,
      all: cards.slice(0, 6),
      next_action: hit
        ? undefined
        : WANT && cards.length
          ? `候选账号均未匹配期望抖音号 ${WANT}；请提供账号“分享主页”短链。`
          : '搜索未命中；请提供账号“分享主页”短链。',
    };
  } finally {
    await ctx.close();
  }
}

async function main() {
  if (!INPUT) {
    console.error('用法: node scripts/resolve_secuid.js "<主页分享链接/sec_uid/昵称/抖音号>" [期望抖音号]');
    return 2;
  }
  const direct = extractSecUid(INPUT);
  if (direct) {
    emit({ status: 'ok', method: 'direct', hit: { uid: direct, href: `https://www.douyin.com/user/${direct}` } });
    return 0;
  }

  let candidate = INPUT;
  if (parseDouyinUrl(INPUT)) {
    try {
      candidate = await resolveDouyinRedirect(INPUT);
      const redirected = extractSecUid(candidate);
      if (redirected) {
        emit({ status: 'ok', method: 'share_redirect', hit: { uid: redirected, href: `https://www.douyin.com/user/${redirected}` } });
        return 0;
      }
    } catch (error) {
      console.error('短链解析失败，改用专用浏览器:', error.message);
    }
  }

  const result = await resolveWithProfile(candidate);
  emit(result);
  return result.status === 'ok' ? 0 : result.status === 'challenge' ? 3 : result.status === 'login_required' ? 5 : 4;
}

main().then(code => { process.exitCode = code; }).catch(error => {
  emit({ status: 'error', hit: null, error: error.message });
  process.exitCode = 1;
});
