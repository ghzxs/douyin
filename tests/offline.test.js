const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  extractUrl,
  extractSecUid,
  parseDouyinUrl,
} = require('../scripts/_account_input');
const { decideCaptureStatus } = require('../scripts/_capture_status');
const { classifyPageSignals } = require('../scripts/_page_signals');

const ROOT = path.resolve(__dirname, '..');

test('extracts sec_uid from share text and canonical URLs', () => {
  const uid = 'MS4wLjABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  assert.equal(extractSecUid(uid), uid);
  assert.equal(extractSecUid(`复制主页 https://www.douyin.com/user/${uid}?from=web`), uid);
  assert.equal(extractUrl('打开 https://v.douyin.com/abc123/ 看看。'), 'https://v.douyin.com/abc123/');
  assert.equal(parseDouyinUrl('https://example.com/user/' + uid), null);
  assert.equal(parseDouyinUrl('http://v.douyin.com/abc123/'), null);
  assert.equal(parseDouyinUrl('https://v.douyin.com/abc123/').hostname, 'v.douyin.com');
  assert.equal(extractSecUid('坏编码%ZZ'), null);
});

test('classifies capture failures without retrying or fabricating data', () => {
  const base = {
    pageState: { challenged: false, loginPrompt: false },
    post: { responses: 1, json_bodies: 0, empty_bodies: 1, http_errors: 0, api_errors: 0, parse_errors: 0 },
    worksCount: 0,
    profile: { nickname: '公开账号' },
    lastHasMore: null,
  };
  assert.equal(decideCaptureStatus(base).status, 'blocked_empty_body');
  assert.equal(decideCaptureStatus({ ...base, pageState: { challenged: true, loginPrompt: false } }).status, 'challenge');
  assert.equal(decideCaptureStatus({ ...base, pageState: { challenged: false, loginPrompt: true } }).status, 'login_required');
  assert.equal(decideCaptureStatus({ ...base, pageState: { challenged: false, loginPrompt: false, serviceError: true } }).status, 'page_service_error');
  assert.equal(decideCaptureStatus({ ...base, post: { responses: 0, json_bodies: 0, empty_bodies: 0, http_errors: 0, api_errors: 0, parse_errors: 0 } }).status, 'no_post_response');
  assert.equal(decideCaptureStatus({ ...base, post: { responses: 1, json_bodies: 0, empty_bodies: 0, http_errors: 1, api_errors: 0, parse_errors: 0 } }).status, 'endpoint_error');
  assert.equal(decideCaptureStatus({ ...base, worksCount: 18, lastHasMore: 1 }).status, 'partial');
  assert.equal(decideCaptureStatus({ ...base, worksCount: 18, lastHasMore: 0 }).status, 'complete');
});

test('distinguishes ordinary login, real challenges, and page service errors', () => {
  assert.deepEqual(
    classifyPageSignals({ text: '扫码登录 验证码登录 密码登录' }),
    { challenged: false, loginPrompt: true, serviceError: false },
  );
  assert.equal(classifyPageSignals({ text: '请完成安全验证，拖动滑块后继续' }).challenged, true);
  assert.equal(classifyPageSignals({ text: '服务异常，重新刷新拉取数据' }).serviceError, true);
  assert.equal(classifyPageSignals({ title: 'Verify', url: 'https://www.douyin.com/verify' }).challenged, true);
});

test('rejects daily Chrome profile directories before browser launch', () => {
  const forbidden = path.join(os.homedir(), '.config', 'google-chrome', 'Default');
  const checked = spawnSync(
    process.execPath,
    ['-e', "require('./scripts/_profile').assertSafeProfileDir()"],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DOUYIN_PROFILE_DIR: forbidden },
    },
  );
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /不能指向日常 Chrome 用户目录/);
});

test('partial analysis preserves missing values and escapes public text in HTML', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-benchmark-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const uid = 'MS4wLjABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const raw = {
    sec_uid: uid,
    captured_at: '2026-08-05T12:00:00.000Z',
    capture: {
      status: 'partial',
      complete: false,
      expected_works: 4,
      collected_works: 2,
      coverage_ratio: 0.5,
      has_more: 1,
      diagnostics: { warnings: ['测试部分采集'] },
    },
    profile: {
      nickname: '<script>alert(1)</script>',
      douyin_id: 'demo-id',
      follower_count: 12000,
      total_favorited: 34000,
      aweme_count: 4,
      signature: 'A&B <b>简介</b>',
      ip_location: '测试',
    },
    works_count: 2,
    works: [
      {
        aweme_id: '1', title: '<script>alert(1)</script>', create_time: 1760000000,
        create_date: '2026-07-01', duration_s: 30, digg_count: 100000,
        comment_count: null, share_count: 20, collect_count: null,
        cover: 'javascript:alert(1)', mix_name: '系列&A',
        video_page: 'https://www.douyin.com/video/1',
      },
      {
        aweme_id: '2', title: '正常作品', create_time: 1761000000,
        create_date: '2026-09-01', duration_s: 45, digg_count: null,
        comment_count: null, share_count: null, collect_count: null,
        cover: null, mix_name: null,
        video_page: 'https://www.douyin.com/video/2',
      },
    ],
    collections: [{ mix_id: 'm1', name: '<img src=x>', play_vv: null, episodes: 2 }],
  };
  fs.writeFileSync(path.join(tempDir, 'account_full_raw.json'), JSON.stringify(raw));

  const python = process.env.PYTHON || 'python3';
  const analyzed = spawnSync(python, [path.join(ROOT, 'scripts', 'analyze.py'), tempDir], { encoding: 'utf8' });
  assert.equal(analyzed.status, 0, analyzed.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(tempDir, 'report_data.json'), 'utf8'));
  assert.equal(report.quality.capture_status, 'partial');
  assert.equal(report.quality.coverage_ratio, 0.5);
  assert.equal(report.stats.comment_max, null);
  assert.deepEqual(report.trend, [
    { month: '2026-07', count: 1, likes: 100000 },
    { month: '2026-09', count: 1, likes: null },
  ]);
  assert.match(report.meta.caveat, /只代表已采集样本/);

  const built = spawnSync(python, [path.join(ROOT, 'scripts', 'build_report_html.py'), tempDir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const html = fs.readFileSync(path.join(tempDir, '调研报告.html'), 'utf8');
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('javascript:alert(1)'));
  assert.ok(!html.includes('fonts.googleapis.com'));
  assert.match(html, /数据完整性：部分/);
  assert.match(html, /实际采集 2 条，主页展示 4 条/);
  assert.match(html, /最近2个样本月份 · 柱高=发布数/);
  assert.equal((html.match(/class="tcol"/g) || []).length, 2);
});

test('long-history HTML keeps latest titles readable and bounds cadence to 12 months', t => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-benchmark-layout-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const trend = Array.from({ length: 36 }, (_, index) => {
    const year = 2023 + Math.floor(index / 12);
    const month = index % 12 + 1;
    return {
      month: `${year}-${String(month).padStart(2, '0')}`,
      count: index % 7 + 1,
      likes: (index + 1) * 1000,
    };
  }).filter(item => item.month !== '2025-08');
  const report = {
    account: {
      nickname: '长周期账号', douyin_id: 'layout-demo', followers: '1.2万',
      total_likes: '3.4万', bio: '', ip: '测试',
    },
    meta: { captured_at: '2026-08-07', sample: 36, caveat: '测试完整采集。' },
    quality: {
      capture_status: 'complete', captured_works: 36, profile_works_total: 36,
      coverage_ratio: 1, warnings: [],
    },
    stats: {
      works: 36, months: 36, per_month: 1, likes_max: 36000, likes_median: 18000,
      v100: 0, v10: 0, v1: 26, vlow: 10,
    },
    top_viral: [],
    latest: [{
      create_date: '2025-12-31', title: '这条最新作品标题在双栏布局中必须保持可读',
      digg_count: 12345, video_page: 'https://www.douyin.com/video/123',
    }],
    collections: [],
    mix_groups: [],
    trend,
  };
  fs.writeFileSync(path.join(tempDir, 'report_data.json'), JSON.stringify(report));

  const python = process.env.PYTHON || 'python3';
  const built = spawnSync(python, [path.join(ROOT, 'scripts', 'build_report_html.py'), tempDir], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const html = fs.readFileSync(path.join(tempDir, '调研报告.html'), 'utf8');
  assert.match(html, /这条最新作品标题在双栏布局中必须保持可读/);
  assert.match(html, /近12个自然月 · 柱高=发布数/);
  assert.equal((html.match(/class="tcol"/g) || []).length, 12);
  assert.ok(!html.includes('23.01'));
  assert.ok(html.includes('25.08'));
  assert.ok(html.includes('25.12'));
  assert.match(html, /class="tposts zero"/);
  assert.match(html, /\.two>section\{min-width:0\}/);
  assert.match(html, /grid-template-columns:82px minmax\(0,1fr\) auto/);
});
