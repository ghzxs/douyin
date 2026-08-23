// 采集公开账号资料、作品指标与合集数据，并把完整性/失败原因写入 capture 字段。
// 用法: node scripts/capture_account_full.js <sec_uid> <out.json> [maxScroll=150] [--headed|--headless]
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');
const {
  PROFILE_DIR,
  CHANNEL,
  envBool,
  assertSafeProfileDir,
  launchOpts,
} = require('./_profile');
const { decideCaptureStatus } = require('./_capture_status');
const { classifyPageSignals } = require('./_page_signals');

const SEC = process.argv[2];
const OUT = path.resolve(process.argv[3] || 'account_full_raw.json');
const MAX_SCROLL = Math.max(1, parseInt(process.argv[4] || '150', 10) || 150);
const HEADLESS = process.argv.includes('--headless')
  ? true
  : process.argv.includes('--headed')
    ? false
    : envBool('DOUYIN_HEADLESS', false);
const WAIT_MS = Math.max(800, Number(process.env.DOUYIN_SCROLL_WAIT_MS || 1600));

if (!SEC) {
  console.error('需要 sec_uid。用法: node scripts/capture_account_full.js <sec_uid> <out.json> [maxScroll]');
  process.exit(2);
}

const awemes = new Map();
const mixes = new Map();
const pending = new Set();
let lastHasMore = null;
let profile = null;
let pageState = { challenged: false, loginPrompt: false, serviceError: false, resolvedPath: '' };

function endpointStats() {
  return { responses: 0, json_bodies: 0, empty_bodies: 0, http_errors: 0, api_errors: 0, parse_errors: 0, statuses: {} };
}

const diagnostics = {
  schema_version: 1,
  browser_channel: CHANNEL,
  headless: HEADLESS,
  endpoints: {
    post: endpointStats(),
    profile: endpointStats(),
    mix: endpointStats(),
  },
  warnings: [],
};

function atomicWriteJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filename);
}

function pickProducts(aweme) {
  /**
   * 提取作品关联的商品信息。
   * 抖音支持多种商品数据结构，这里统一为 { product_id, product_title, shop_name, shop_id } 格式
   */
  const products = [];
  
  // 方式 1: product 数组（直��、小黄车挂载的商品）
  if (Array.isArray(aweme.product)) {
    aweme.product.forEach(p => {
      if (p.product_id || p.product_title) {
        products.push({
          product_id: p.product_id || null,
          product_title: (p.product_title || p.title || '').trim() || null,
          shop_name: (p.shop_name || '').trim() || null,
          shop_id: p.shop_id || p.shop_window?.shop_id || null,
        });
      }
    });
  }
  
  // 方式 2: commerce_info（商业化绑定的商品）
  if (aweme.commerce_info && !products.length) {
    const commerce = aweme.commerce_info;
    if (commerce.product_id || commerce.product_title) {
      products.push({
        product_id: commerce.product_id || null,
        product_title: (commerce.product_title || commerce.title || '').trim() || null,
        shop_name: (commerce.shop_name || '').trim() || null,
        shop_id: commerce.shop_id || null,
      });
    }
  }
  
  // 方式 3: attached_info.product（挂载商品）
  if (aweme.attached_info?.product) {
    const attached = aweme.attached_info.product;
    if (attached.product_id || attached.product_title) {
      products.push({
        product_id: attached.product_id || null,
        product_title: (attached.product_title || attached.title || '').trim() || null,
        shop_name: (attached.shop_name || '').trim() || null,
        shop_id: attached.shop_id || null,
      });
    }
  }
  
  return products.length ? products : null;
}

function pickStats(aweme) {
  const stats = aweme.statistics || {};
  return {
    aweme_id: aweme.aweme_id,
    title: (aweme.desc || '').replace(/\s+/g, ' ').trim(),
    create_time: aweme.create_time || null,
    create_date: aweme.create_time ? new Date(aweme.create_time * 1000).toLocaleString() : null,
    duration_s: aweme.video?.duration
      ? Math.round(aweme.video.duration / 1000)
      : aweme.duration ? Math.round(aweme.duration / 1000) : null,
    digg_count: stats.digg_count ?? null,
    comment_count: stats.comment_count ?? null,
    share_count: stats.share_count ?? null,
    collect_count: stats.collect_count ?? null,
    play_count: stats.play_count ?? null,
    cover: aweme.video?.cover?.url_list?.[0] || null,
    mix_name: aweme.mix_info?.mix_name || null,
    video_page: `https://www.douyin.com/video/${aweme.aweme_id}`,
    products: pickProducts(aweme),
  };
}

function pickProfile(user) {
  return {
    nickname: user.nickname || null,
    douyin_id: user.unique_id || user.short_id || null,
    sec_uid: user.sec_uid || SEC,
    follower_count: user.follower_count ?? null,
    total_favorited: user.total_favorited ?? null,
    aweme_count: user.aweme_count ?? null,
    signature: (user.signature || '').replace(/\s+/g, ' ').trim(),
    ip_location: user.ip_location || null,
    city: user.city || user.province || null,
  };
}

function ingestPost(data) {
  if (data.has_more !== undefined) lastHasMore = Number(data.has_more);
  (data.aweme_list || []).forEach(aweme => {
    if (aweme?.aweme_id) awemes.set(aweme.aweme_id, pickStats(aweme));
  });
}

function ingestMix(data) {
  (data.mix_infos || data.mix_list || []).forEach(mix => {
    const id = mix.mix_id || mix.mixId;
    if (!id) return;
    const stats = mix.statis || mix.mix_statis || {};
    mixes.set(id, {
      mix_id: id,
      name: mix.mix_name || mix.mix_info?.mix_name || '',
      play_vv: stats.play_vv ?? stats.playVV ?? null,
      episodes: stats.updated_to_episode ?? mix.update_episode ?? mix.statis?.current_episode ?? null,
    });
  });
}

function endpointKind(url) {
  if (url.includes('/aweme/v1/web/aweme/post/')) return 'post';
  if (url.includes('/aweme/v1/web/mix/list/')) return 'mix';
  if (url.includes('/aweme/v1/web/user/profile/other/')) return 'profile';
  return null;
}

async function handleResponse(response) {
  const kind = endpointKind(response.url());
  if (!kind) return;
  const stats = diagnostics.endpoints[kind];
  const status = response.status();
  stats.responses += 1;
  stats.statuses[String(status)] = (stats.statuses[String(status)] || 0) + 1;
  if (status >= 400) stats.http_errors += 1;

  let body;
  try {
    body = await response.body();
  } catch (error) {
    stats.parse_errors += 1;
    diagnostics.warnings.push(`${kind} 响应体读取失败: ${error.message}`);
    return;
  }
  if (!body.length) {
    stats.empty_bodies += 1;
    return;
  }

  let data;
  try {
    data = JSON.parse(body.toString('utf8'));
    stats.json_bodies += 1;
  } catch (_) {
    stats.parse_errors += 1;
    return;
  }
  if (data && data.status_code && data.status_code !== 0) {
    stats.api_errors += 1;
    diagnostics.warnings.push(`${kind} 接口 status_code=${data.status_code}`);
  }
  if (kind === 'post') ingestPost(data);
  if (kind === 'mix') ingestMix(data);
  if (kind === 'profile' && data?.user) profile = pickProfile(data.user);
}

function watchResponse(response) {
  const task = handleResponse(response);
  pending.add(task);
  task.catch(error => diagnostics.warnings.push(`响应处理失败: ${error.message}`))
    .finally(() => pending.delete(task));
}

async function drainPending() {
  while (pending.size) await Promise.allSettled([...pending]);
}

async function inspectPage(page) {
  const observed = await page.evaluate(() => {
    const title = document.title || '';
    const text = (document.body?.innerText || '').slice(0, 1800);
    return {
      title,
      text,
      videoLinkCount: document.querySelectorAll('a[href*="/video/"]').length,
    };
  }).catch(() => ({ title: '', text: '', videoLinkCount: 0 }));
  const signals = classifyPageSignals({ ...observed, url: page.url() });
  let resolvedPath = '';
  try { resolvedPath = new URL(page.url()).pathname; } catch (_) {}
  return {
    ...signals,
    title: observed.title.slice(0, 160),
    videoLinkCount: observed.videoLinkCount,
    resolvedPath,
  };
}

async function scrollStep(page) {
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 2600);
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
    let best = null, max = 0;
    document.querySelectorAll('div,main,section,ul').forEach(element => {
      const style = getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY)
          && element.scrollHeight > element.clientHeight + 200
          && element.scrollHeight > max) {
        max = element.scrollHeight;
        best = element;
      }
    });
    if (best) best.scrollTop = best.scrollHeight;
  });
  await page.keyboard.press('End').catch(() => {});
}

async function main() {
  assertSafeProfileDir();
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, launchOpts({ headless: HEADLESS }));
  try {
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    page.on('response', watchResponse);

    await page.goto(`https://www.douyin.com/user/${SEC}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(error => diagnostics.warnings.push(`主页导航失败: ${error.message}`));
    await page.waitForTimeout(7000);
    await drainPending();
    pageState = await inspectPage(page);
    diagnostics.page = pageState;
    if (!pageState.resolvedPath.includes(SEC)) diagnostics.warnings.push('页面未停留在目标 sec_uid 路径。');
    if (pageState.serviceError) diagnostics.warnings.push('页面作品区显示"服务异常，重新刷新拉取数据"。');

    let stable = 0, previous = awemes.size;
    const earlySoftBlock = diagnostics.endpoints.post.empty_bodies > 0
      && diagnostics.endpoints.post.json_bodies === 0
      && awemes.size === 0;
    if (!earlySoftBlock && !pageState.challenged && !pageState.loginPrompt) {
      for (let i = 0; i < MAX_SCROLL; i++) {
        await scrollStep(page);
        await page.waitForTimeout(WAIT_MS + Math.random() * 650);
        await drainPending();
        const count = awemes.size;
        process.stderr.write(`\r滚动 ${i + 1}/${MAX_SCROLL}  已收作品 ${count}  合集 ${mixes.size}  has_more=${lastHasMore ?? '未知'}   `);
        if (count === previous) stable += 1;
        else { stable = 0; previous = count; }
        if (diagnostics.endpoints.post.empty_bodies > 0
            && diagnostics.endpoints.post.json_bodies === 0
            && count === 0) break;
        if (lastHasMore === 0 && stable >= 2) break;
        if (stable >= 14) break;
      }
      process.stderr.write('\n');
    }

    if (awemes.size > 0 && !pageState.challenged && !pageState.loginPrompt) {
      const tab = page.getByText('合集', { exact: true }).first();
      if (await tab.count()) {
        await tab.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(3000);
        for (let i = 0; i < 8; i++) {
          await scrollStep(page);
          await page.waitForTimeout(1200);
          await drainPending();
          if (mixes.size && i > 3) break;
        }
      }
    }
    await drainPending();
    pageState = await inspectPage(page);
    diagnostics.page = pageState;

    const decision = decideCaptureStatus({
      pageState,
      post: diagnostics.endpoints.post,
      worksCount: awemes.size,
      profile,
      lastHasMore,
    });
    const expectedWorks = profile?.aweme_count != null && Number.isFinite(Number(profile.aweme_count))
      ? Number(profile.aweme_count)
      : null;
    const coverage = expectedWorks && expectedWorks > 0 ? Number((awemes.size / expectedWorks).toFixed(4)) : null;
    if (decision.status === 'complete' && expectedWorks && awemes.size !== expectedWorks) {
      diagnostics.warnings.push(`主页展示 ${expectedWorks} 条，接口采集 ${awemes.size} 条；置顶/私密/删除状态可能造成差异。`);
    }

    const output = {
      sec_uid: SEC,
      captured_at: new Date().toISOString(),
      capture: {
        status: decision.status,
        complete: decision.status === 'complete',
        expected_works: expectedWorks,
        collected_works: awemes.size,
        coverage_ratio: coverage,
        has_more: lastHasMore,
        next_action: decision.nextAction,
        diagnostics,
      },
      profile,
      works_count: awemes.size,
      works: [...awemes.values()].sort((a, b) => (b.create_time || 0) - (a.create_time || 0)),
      collections: [...mixes.values()].sort((a, b) => (b.play_vv ?? -1) - (a.play_vv ?? -1)),
    };
    atomicWriteJson(OUT, output);
    console.error(`采集状态=${decision.status}：作品 ${output.works_count} 条，合集 ${output.collections.length} 个 → ${OUT}`);
    console.error(`下一步：${decision.nextAction}`);
    return decision.exitCode;
  } finally {
    await ctx.close();
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error('ERR', error.message);
  process.exitCode = 1;
});
