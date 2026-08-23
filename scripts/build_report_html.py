# -*- coding: utf-8 -*-
# 读 report_data.json → 生成浅色调研报告 HTML。所有外部文本均转义，完整性状态始终可见。
import html as html_lib
import json
import os
import sys
from urllib.parse import urlparse

DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
SOURCE = os.path.join(DIR, f'{identifier}.json')
TARGET = os.path.join(DIR, '调研报告.html')

with open(SOURCE, encoding='utf-8') as handle:
    data = json.load(handle)

account = data['account']
stats = data['stats']
quality = data.get('quality') or {}


def esc(value):
    return html_lib.escape('' if value is None else str(value), quote=True)


def safe_url(value, douyin_only=False):
    if not value:
        return ''
    try:
        parsed = urlparse(str(value))
    except ValueError:
        return ''
    if parsed.scheme != 'https' or not parsed.hostname:
        return ''
    host = parsed.hostname.lower()
    if douyin_only and host != 'douyin.com' and not host.endswith('.douyin.com'):
        return ''
    return esc(value)


def cn(value):
    if value is None:
        return '—'
    value = int(value)
    if value >= 100000000:
        return f'{value / 100000000:.1f}亿'
    if value >= 10000:
        return f'{value / 10000:.1f}万'
    return f'{value:,}'


def bar(percent, color):
    percent = max(0, min(100, float(percent or 0)))
    return f'<span class="bar"><span class="fill" style="width:{percent:.0f}%;background:{color}"></span></span>'


def month_index(value):
    try:
        year_text, month_text = str(value).split('-', 1)
        year, month = int(year_text), int(month_text)
    except (TypeError, ValueError):
        return None
    if year < 1 or not 1 <= month <= 12:
        return None
    return year * 12 + month - 1


def month_label(index):
    return f'{index // 12:04d}-{index % 12 + 1:02d}'


def cadence_window(items, status, limit=12):
    """Bound the chart and only infer zero-post months for a complete capture."""
    by_month = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        index = month_index(item.get('month'))
        if index is None:
            continue
        count = item.get('count')
        by_month[index] = {
            'month': month_label(index),
            'count': int(count) if isinstance(count, (int, float)) else 0,
            'likes': item.get('likes') if isinstance(item.get('likes'), (int, float)) else None,
        }
    if not by_month:
        return [], ''

    indexes = sorted(by_month)
    if status == 'complete':
        end = indexes[-1]
        start = max(indexes[0], end - limit + 1)
        window = [
            by_month.get(index, {'month': month_label(index), 'count': 0, 'likes': 0})
            for index in range(start, end + 1)
        ]
        note = f'近{len(window)}个自然月 · 柱高=发布数'
    else:
        window = [by_month[index] for index in indexes[-limit:]]
        note = f'最近{len(window)}个样本月份 · 柱高=发布数'
    return window, note


ACCENT, GREEN, GOLD = '#d8442a', '#1f7a6b', '#b8862f'
captured = quality.get('captured_works', data['meta'].get('sample'))
expected = quality.get('profile_works_total')
capture_status = quality.get('capture_status', 'unknown')
coverage = quality.get('coverage_ratio')
status_names = {
    'complete': '完整',
    'partial': '部分',
    'legacy_unknown': '旧数据·完整性未知',
}
status_label = status_names.get(capture_status, capture_status)
coverage_label = f'{coverage * 100:.1f}%' if isinstance(coverage, (int, float)) else '—'
quality_warnings = quality.get('warnings') or []
warnings_html = f'<br><b>提示：</b>{esc("；".join(quality_warnings[:3]))}' if quality_warnings else ''

top_cards = []
for index, video in enumerate(data.get('top_viral', [])[:8]):
    cover = safe_url(video.get('cover'))
    image = f'<img src="{cover}" loading="lazy" onerror="this.style.display=\'none\';this.parentElement.classList.add(\'noimg\')">' if cover else ''
    mix = f'<span class="chip">{esc(video.get("mix_name"))}</span>' if video.get('mix_name') else ''
    video_url = safe_url(video.get('video_page'), douyin_only=True) or '#'
    top_cards.append(f'''<a class="vcard" href="{video_url}" target="_blank" rel="noreferrer">
  <div class="thumb">{image}<span class="rank">{index + 1}</span><span class="like">♥ {cn(video.get('digg_count'))}</span></div>
  <div class="vbody">
    <div class="vmeta">{esc(video.get('create_date'))}　{mix}</div>
    <p class="vtitle">{esc((video.get('title') or '')[:80])}</p>
    <div class="vstats"><span>评论 {cn(video.get('comment_count'))}</span><span>转发 {cn(video.get('share_count'))}</span><span>收藏 {cn(video.get('collect_count'))}</span></div>
  </div></a>''')

latest_rows = []
for video in data.get('latest', [])[:8]:
    video_url = safe_url(video.get('video_page'), douyin_only=True) or '#'
    latest_rows.append(f'''<a class="lrow" href="{video_url}" target="_blank" rel="noreferrer">
  <span class="ldate">{esc(video.get('create_date'))}</span>
  <span class="ltitle">{esc((video.get('title') or '')[:80])}</span>
  <span class="llike">♥ {cn(video.get('digg_count'))}</span></a>''')

collections = sorted(
    data.get('collections') or [],
    key=lambda item: item.get('play_vv') if item.get('play_vv') is not None else -1,
    reverse=True,
)
known_plays = [item.get('play_vv') for item in collections if item.get('play_vv') is not None]
max_play = max(known_plays, default=1) or 1
collection_rows = []
for item in collections:
    plays = item.get('play_vv')
    collection_rows.append(f'''<div class="crow">
  <span class="cname">{esc(item.get('name') or '—')}</span>
  <span class="cep">{esc(item.get('episodes') if item.get('episodes') is not None else '—')}集</span>
  {bar((plays / max_play * 100) if plays is not None else 0, GREEN)}
  <span class="cplay">{cn(plays)}<small>播放</small></span></div>''')

mix_groups = [item for item in (data.get('mix_groups') or []) if item.get('count', 0) >= 3][:10]
max_average = max((item.get('avg') or 0 for item in mix_groups), default=1) or 1
mix_rows = []
for item in mix_groups:
    mix_rows.append(f'''<div class="crow">
  <span class="cname">{esc(item.get('name'))} <small class="cnt">{item.get('count')}条</small></span>
  <span class="cep"></span>
  {bar((item.get('avg') or 0) / max_average * 100, ACCENT)}
  <span class="cplay">{cn(item.get('avg'))}<small>均赞</small></span></div>''')

trend, trend_note = cadence_window(data.get('trend') or [], capture_status)
max_posts = max((item.get('count') or 0 for item in trend), default=1) or 1
trend_bars = []
for item in trend:
    count = item.get('count') or 0
    month = str(item.get('month') or '')
    tooltip = f'{month} · {count}条 · 合计点赞 {cn(item.get("likes"))}'
    zero_class = ' zero' if count == 0 else ''
    trend_bars.append(f'''<div class="tcol" aria-label="{esc(tooltip)}">
  <div class="tstack"><span class="tposts{zero_class}" style="height:{count / max_posts * 100:.0f}%" title="{esc(tooltip)}"></span></div>
  <div class="tnum">{count}<small>条</small></div><div class="tmon">{esc(month[2:].replace('-', '.'))}</div></div>''')

distribution = [
    ('破百万赞', stats.get('v100'), ACCENT),
    ('10–100万', stats.get('v10'), '#e8743b'),
    ('1–10万', stats.get('v1'), GOLD),
    ('1万以下', stats.get('vlow'), '#8c8071'),
]
distribution_html = ''.join(
    f'<div class="dpill"><b style="color:{color}">{value}</b><span>{label}</span></div>'
    for label, value, color in distribution
)

collection_section = ''
if collection_rows:
    collection_section = ('<section><div class="sh"><span class="en">Collections</span>'
                          '<h2>合集战绩 · 播放量</h2><span class="note">合集播放为公开字段；缺失保持 —</span></div>'
                          + ''.join(collection_rows) + '</section>')
mix_section = ''
if mix_rows:
    mix_section = ('<section><div class="sh"><span class="en">Topic Matrix</span>'
                   '<h2>已有合集/系列表现</h2><span class="note">仅按已采集样本均赞</span></div>'
                   + ''.join(mix_rows) + '</section>')
trend_section = ''
if trend_bars:
    trend_section = f'''<section>
      <div class="sh"><span class="en">Cadence</span><h2>发布节奏</h2><span class="note">{esc(trend_note)}</span></div>
      <div class="trend" style="grid-template-columns:repeat({len(trend_bars)},minmax(0,1fr))">{''.join(trend_bars)}</div>
    </section>'''

insight_parts = []
if mix_groups:
    best = mix_groups[0]
    insight_parts.append(f'样本内均赞最高系列为<em>「{esc(best.get("name"))}」</em>（{best.get("count")}条，均赞 {cn(best.get("avg"))}）')
best_collection = next((item for item in collections if item.get('play_vv') is not None), None)
if best_collection:
    insight_parts.append(f'公开合集播放最高为<em>「{esc(best_collection.get("name"))}」</em> {cn(best_collection.get("play_vv"))}')
insight_main = '；'.join(insight_parts) + '。' if insight_parts else f'样本内最高单条 {cn(stats.get("likes_max"))} 赞。'
works_count = stats.get('works') or 0
drive = '样本呈少数高赞内容驱动' if works_count and (stats.get('vlow') or 0) / works_count > 0.8 else '样本表现相对均衡'
per_month = cn(stats.get('per_month'))
insight_small = (
    f'以上均基于已采集 {captured} 条样本；其中 {stats.get("v100")} 条破百万赞、'
    f'{stats.get("v10")} 条 10–100 万，中位 {cn(stats.get("likes_median"))} 赞——{drive}；'
    f'覆盖 {stats.get("months") or "—"} 个月，样本月均 {per_month} 条。'
)

CSS = '''
:root{--paper:#f6f1e8;--card:#fffdf8;--ink:#241d16;--mut:#8c8071;--line:#e7ddcd;--ac:#d8442a;--ac2:#1f7a6b;--gold:#b8862f}
*{box-sizing:border-box;margin:0;padding:0} body{background:var(--paper);color:var(--ink);font-family:"PingFang SC","Noto Sans CJK SC",system-ui,sans-serif;background-image:radial-gradient(circle at 1px 1px,rgba(0,0,0,.025) 1px,transparent 0);background-size:22px 22px}
.wrap{max-width:1080px;margin:0 auto;padding:46px 26px 80px}.serif{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif}.kicker{font-size:12px;letter-spacing:.32em;color:var(--ac);font-weight:700;text-transform:uppercase}
.mast{border-bottom:3px solid var(--ink);padding-bottom:22px;margin-bottom:8px}.mast h1{font-size:46px;line-height:1.05;margin:10px 0 6px;font-weight:900}.mast .sub{color:var(--mut);font-size:14px}.mast .sub b{color:var(--ink)}
.bio{font-size:13.5px;color:#5b5347;font-style:italic;margin-top:14px;max-width:760px;line-height:1.7;border-left:3px solid var(--ac);padding-left:14px}.quality{margin:16px 0 0;padding:11px 14px;border:1px solid #e1c99d;background:#fff7e9;border-radius:9px;color:#765d30;font-size:12.5px;line-height:1.6}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:24px 0 10px;background:var(--card)}.kpi{padding:18px 16px;border-right:1px solid var(--line);text-align:center}.kpi:last-child{border-right:0}.kpi b{display:block;font-size:27px;font-weight:800}.kpi.ac b{color:var(--ac)}.kpi span{font-size:11.5px;color:var(--mut)}
.dist{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 30px}.dpill{background:var(--card);border:1px solid var(--line);border-radius:30px;padding:7px 16px;font-size:12px;color:var(--mut)}.dpill b{font-size:17px;margin-right:5px}
section{margin:38px 0}.sh{display:flex;align-items:baseline;gap:12px;margin-bottom:18px;border-bottom:1px solid var(--line);padding-bottom:8px}.sh h2{font-size:23px;font-weight:800}.sh .en{font-size:11px;letter-spacing:.25em;color:var(--ac);font-weight:700}.sh .note{margin-left:auto;font-size:12px;color:var(--mut)}
.insight{background:var(--ink);color:#f6f1e8;border-radius:16px;padding:26px 30px;margin:26px 0}.insight .q{font-size:20px;line-height:1.55;font-weight:700}.insight .q em{color:#ffcaa8;font-style:normal}.insight .sm{margin-top:12px;font-size:13px;color:#c9bdab;line-height:1.7}
.vgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.vcard{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:.18s}.vcard:hover{transform:translateY(-4px);box-shadow:0 14px 30px -14px rgba(80,50,20,.4)}
.thumb{position:relative;aspect-ratio:3/4;background:linear-gradient(150deg,#efe6d6,#e3d5bf);overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover}.rank{position:absolute;top:8px;left:8px;width:26px;height:26px;background:var(--ink);color:#fff;border-radius:50%;display:grid;place-items:center;font-weight:800}.like{position:absolute;bottom:8px;left:8px;background:rgba(216,68,42,.95);color:#fff;font-size:12.5px;font-weight:700;padding:3px 9px;border-radius:20px}
.vbody{padding:11px 12px 13px}.vmeta{font-size:11px;color:var(--mut);margin-bottom:5px}.chip{background:#f0e7d6;color:#6b5d44;border-radius:5px;padding:1px 7px}.vtitle{font-size:13px;line-height:1.5;min-height:39px;font-weight:500}.vstats{display:flex;gap:11px;margin-top:9px;font-size:11px;color:var(--mut);border-top:1px solid var(--line);padding-top:8px}
.lrow{display:grid;grid-template-columns:82px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;font-size:13.5px}.lrow:hover{background:var(--card)}.ldate{color:var(--mut);font-size:12px;font-variant-numeric:tabular-nums}.ltitle{display:-webkit-box;min-width:0;overflow:hidden;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal}.llike{color:var(--ac);font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums}
.crow{display:grid;grid-template-columns:1fr 52px 1fr 92px;gap:12px;align-items:center;padding:8px 0;font-size:13px}.cname{font-weight:500}.cname small,.cnt{color:var(--mut);font-size:11px;font-weight:400}.cep{color:var(--mut);font-size:12px;text-align:right}.bar{display:block;height:9px;background:#ece2d1;border-radius:6px;overflow:hidden}.fill{display:block;height:100%;border-radius:6px}.cplay{text-align:right;font-weight:700}.cplay small{font-weight:400;color:var(--mut);font-size:10.5px;margin-left:3px}
.two{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr);gap:40px}.two>section{min-width:0}.trend{display:grid;gap:8px;align-items:stretch;height:210px;min-width:0;overflow:hidden;padding:14px 12px 10px;border:1px solid var(--line);border-radius:13px;background:linear-gradient(to top,rgba(231,221,205,.62) 1px,transparent 1px) var(--card);background-size:100% 25%}.tcol{display:flex;min-width:0;flex-direction:column;align-items:center;height:100%}.tstack{display:flex;flex:1;width:72%;min-width:5px;align-items:flex-end}.tposts{width:100%;min-height:4px;background:linear-gradient(180deg,var(--ac),#ef8a5e);border-radius:5px 5px 2px 2px;box-shadow:0 -2px 9px rgba(216,68,42,.15)}.tposts.zero{height:2px!important;min-height:2px;background:#d7ccba;box-shadow:none}.tnum{font-size:12px;font-weight:700;margin-top:7px;white-space:nowrap}.tnum small{margin-left:2px;color:var(--mut);font-size:9px;font-weight:500}.tmon{font-size:10px;color:var(--mut);white-space:nowrap;font-variant-numeric:tabular-nums}
.foot{margin-top:50px;padding-top:18px;border-top:1px solid var(--line);font-size:11.5px;color:var(--mut);line-height:1.7}@media(max-width:880px){.two{grid-template-columns:minmax(0,1fr)}.vgrid{grid-template-columns:repeat(2,1fr)}.kpis{grid-template-columns:repeat(2,1fr)}.kpi:nth-child(2n){border-right:0}}@media(max-width:560px){.wrap{padding:30px 18px 58px}.mast h1{font-size:38px}.sh{flex-wrap:wrap}.sh .note{width:100%;margin-left:0}.lrow{grid-template-columns:minmax(0,1fr) auto;gap:4px 10px}.ldate{grid-column:1}.llike{grid-column:2;grid-row:1}.ltitle{grid-column:1/-1}.trend{gap:3px;padding:12px 5px 9px}.tnum{font-size:10px}.tnum small{display:none}.tmon{font-size:9px;letter-spacing:-.04em}}
'''

bio_html = f'<p class="bio">{esc(account.get("bio"))}</p>' if account.get('bio') else ''
expected_text = cn(expected) if expected is not None else '—'
html = f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>对标调研 · {esc(account.get('nickname'))}</title><style>{CSS}</style></head><body><div class="wrap">
<header class="mast"><div class="kicker">抖音对标调研 · Benchmark Teardown</div>
  <h1 class="serif">{esc(account.get('nickname'))}</h1>
  <div class="sub">抖音号 <b>{esc(account.get('douyin_id'))}</b>　·　IP属地 {esc(account.get('ip'))}　·　采集 {esc(data['meta'].get('captured_at'))}　·　主页作品 {expected_text}　·　已采集 <b>{captured} 条</b></div>
  {bio_html}
  <div class="quality"><b>数据完整性：{esc(status_label)}</b>　·　覆盖率 {coverage_label}<br>{esc(data['meta'].get('caveat'))}{warnings_html}</div>
</header>
<div class="kpis"><div class="kpi"><b>{esc(account.get('followers'))}</b><span>粉丝</span></div><div class="kpi"><b>{esc(account.get('total_likes'))}</b><span>总获赞</span></div><div class="kpi"><b>{captured}</b><span>已采集作品</span></div><div class="kpi ac"><b>{cn(stats.get('likes_max'))}</b><span>样本最高赞</span></div><div class="kpi"><b>{cn(stats.get('per_month'))}</b><span>样本月均更新</span></div></div>
<div class="dist">{distribution_html}</div>
<div class="insight"><div class="q serif">{insight_main}</div><div class="sm">{insight_small}</div></div>
<section><div class="sh"><span class="en">Most Liked</span><h2>样本高赞 Top 8</h2><span class="note">不是播放量榜；点击查看原视频</span></div><div class="vgrid">{''.join(top_cards)}</div></section>
<div class="two"><section><div class="sh"><span class="en">Latest</span><h2>样本内最新作品</h2></div>{''.join(latest_rows)}</section>{trend_section}</div>
{collection_section}{mix_section}
<div class="foot">完整的“爆款公式 / 选题拆解 / 变现路径 / 可复制清单”见同目录 <b>调研报告.md</b>（由 agent 按证据边界撰写）。<br>
数据来源：抖音网页公开接口；实际采集 {captured} 条，主页展示 {expected_text} 条，capture.status={esc(capture_status)}。缺失字段保持“—”，未按 0 处理。</div>
</div></body></html>'''

temp = f'{TARGET}.{os.getpid()}.tmp'
with open(temp, 'w', encoding='utf-8') as handle:
    handle.write(html)
os.replace(temp, TARGET)
print('生成 调研报告.html', len(html.encode('utf-8')), '字节', f'capture={capture_status}')
