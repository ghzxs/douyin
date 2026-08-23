const SEC_UID_RE = /MS4wLjAB[A-Za-z0-9_-]{20,}/;
const URL_RE = /https?:\/\/[^\s<>"']+/i;

function extractUrl(value) {
  const match = String(value || '').match(URL_RE);
  return match ? match[0].replace(/[）)】\],，。；;]+$/, '') : null;
}

function extractSecUid(value) {
  const raw = String(value || '');
  let text = raw;
  try { text = decodeURIComponent(raw); } catch (_) {}
  const direct = text.match(SEC_UID_RE);
  if (direct) return direct[0];
  const pathMatch = text.match(/\/user\/([A-Za-z0-9_-]{30,})/);
  return pathMatch ? pathMatch[1] : null;
}

function parseDouyinUrl(value) {
  const raw = extractUrl(value);
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch (_) { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const allowed = host === 'douyin.com' || host.endsWith('.douyin.com')
    || host === 'iesdouyin.com' || host.endsWith('.iesdouyin.com');
  if (!allowed) return null;
  return url;
}

async function resolveDouyinRedirect(value, timeoutMs = 15000) {
  let current = parseDouyinUrl(value);
  if (!current) throw new Error('只允许解析抖音官方域名下的公开链接。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome Safari',
          'accept-language': 'zh-CN,zh;q=0.9',
        },
      });
      if (response.body) await response.body.cancel().catch(() => {});
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) return current.href;
      const next = new URL(location, current);
      current = parseDouyinUrl(next.href);
      if (!current) throw new Error('短链跳转离开抖音官方域名，已停止。');
    }
    throw new Error('短链跳转次数过多。');
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { extractUrl, extractSecUid, parseDouyinUrl, resolveDouyinRedirect };
