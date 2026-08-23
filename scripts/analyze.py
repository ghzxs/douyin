1# -*- coding: utf-8 -*-
# 聚合分析：account_full_raw.json → report_data.json。缺失值保持 null，不转成 0。
# 支持按时间周期筛选作品：--days N / --months N / --since YYYY-MM-DD
import json
import os
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta

DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
RAW = os.path.join(DIR, 'account_full_raw.json')

# 命令行参数解析
time_filter = None
if '--days' in sys.argv:
    try:
        days = int(sys.argv[sys.argv.index('--days') + 1])
        time_filter = ('days', days)
    except (ValueError, IndexError):
        print('参数错误：--days 后需跟整数', file=sys.stderr)
        sys.exit(1)
elif '--months' in sys.argv:
    try:
        months = int(sys.argv[sys.argv.index('--months') + 1])
        time_filter = ('months', months)
    except (ValueError, IndexError):
        print('参数错误：--months 后需跟整数', file=sys.stderr)
        sys.exit(1)
elif '--since' in sys.argv:
    try:
        since_date = sys.argv[sys.argv.index('--since') + 1]
        datetime.strptime(since_date, '%Y-%m-%d')  # 验证格式
        time_filter = ('since', since_date)
    except (ValueError, IndexError):
        print('参数错误：--since 后需跟日期格式 YYYY-MM-DD', file=sys.stderr)
        sys.exit(1)

with open(RAW, encoding='utf-8') as handle:
    data = json.load(handle)

works_all = [item for item in (data.get('works') or []) if isinstance(item, dict)]


def apply_time_filter(works_list, filter_info):
    """
    按时间周期筛选作品。
    filter_info: (filter_type, value)
    - ('days', N): 最近 N 天
    - ('months', N): 最近 N 个月
    - ('since', 'YYYY-MM-DD'): 从指定日期起
    """
    if not filter_info:
        return works_list
    
    filter_type, value = filter_info
    
    if filter_type == 'days':
        cutoff_date = (datetime.now() - timedelta(days=value)).date()
        filtered = [
            item for item in works_list
            if item.get('create_date') and item['create_date'][:10] >= str(cutoff_date)
        ]
    elif filter_type == 'months':
        # 计算 N 个月前的日期（简化处理：N*30 天）
        cutoff_date = (datetime.now() - timedelta(days=value * 30)).date()
        filtered = [
            item for item in works_list
            if item.get('create_date') and item['create_date'][:10] >= str(cutoff_date)
        ]
    elif filter_type == 'since':
        filtered = [
            item for item in works_list
            if item.get('create_date') and item['create_date'][:10] >= value
        ]
    else:
        filtered = works_list
    
    return filtered


# 应用时间筛选
works_all_filtered = apply_time_filter(works_all, time_filter)
works = [item for item in works_all_filtered if item.get('digg_count') is not None]

if not works:
    status = (data.get('capture') or {}).get('status', 'unknown')
    filter_text = ''
    if time_filter:
        filter_type, value = time_filter
        if filter_type == 'days':
            filter_text = f'（最近 {value} 天）'
        elif filter_type == 'months':
            filter_text = f'（最近 {value} 个月）'
        elif filter_type == 'since':
            filter_text = f'（自 {value} 起）'
    print(f'无可分析作品数据{filter_text}（capture.status={status}）；先解决采集阻塞，不生成误导报告。', file=sys.stderr)
    sys.exit(3)

profile = data.get('profile') or {}
capture = data.get('capture') or {}


def sanitize_filename(text, max_length=50):
    """
    将文本转换为安全的文件名。
    - 移除或替换不安全字符
    - 限制长度避免文件名过长
    - 保留中文字符
    """
    if not text:
        return 'unknown'
    # 移除控制字符和路径分隔符
    text = re.sub(r'[\x00-\x1f\x7f/\\:\*\?"<>\|]', '', text)
    # 去除首尾空白
    text = text.strip()
    if not text:
        return 'unknown'
    # 限制长度（字节长度考虑 UTF-8 编码）
    text = text[:max_length]
    return text


def get_output_filename(dir_path, profile_data, filter_info, fallback_suffix='identifier'):
    """
    根据账号信息和时间筛选生成输出文件名。
    优先级：douyin_id > nickname > sec_uid > fallback
    """
    # 尝试按优先级获取标识符
    identifier = (
        profile_data.get('douyin_id') or
        profile_data.get('nickname') or
        data.get('sec_uid') or
        fallback_suffix
    )
    
    # 清理文件名
    identifier = sanitize_filename(identifier)
    
    # 添加时间后缀
    suffix = ''
    if filter_info:
        filter_type, value = filter_info
        if filter_type == 'days':
            suffix = f'_近{value}天'
        elif filter_type == 'months':
            suffix = f'_近{value}月'
        elif filter_type == 'since':
            suffix = f'_自{value}'
    
    # 生成文件名
    filename = f'{identifier}{suffix}.json'
    return os.path.join(dir_path, filename)


OUT = get_output_filename(DIR, profile, time_filter)


def cnstr(value):
    if value is None:
        return '—'
    value = int(value)
    if value >= 100000000:
        return f'{value / 100000000:.1f}亿'
    if value >= 10000:
        return f'{value / 10000:.1f}万'
    return f'{value:,}'


def slim(item):
    keys = [
        'aweme_id', 'title', 'create_date', 'duration_s', 'digg_count',
        'comment_count', 'share_count', 'collect_count', 'cover',
        'mix_name', 'video_page', 'products',
    ]
    return {key: item.get(key) for key in keys}


def max_known(key):
    values = [item.get(key) for item in works_all_filtered if item.get(key) is not None]
    return max(values) if values else None


dates = sorted(item['create_date'] for item in works_all_filtered if item.get('create_date'))
if dates:
    span_lo, span_hi = dates[0], dates[-1]
    y0, m0 = int(span_lo[:4]), int(span_lo[5:7])
    y1, m1 = int(span_hi[:4]), int(span_hi[5:7])
    # 修复：计算月份差，包含首尾
    months = (y1 - y0) * 12 + (m1 - m0) + 1
    months = max(1, months)  # 至少为1
    span = f'{span_lo} ~ {span_hi}'
else:
    months, span = None, '—'
    
mix = defaultdict(lambda: [0, 0])
for item in works:
    key = item.get('mix_name') or '散篇'
    mix[key][0] += 1
    mix[key][1] += item['digg_count']
mix_groups = sorted(
    [
        {'name': key, 'count': values[0], 'sum': values[1], 'avg': round(values[1] / values[0])}
        for key, values in mix.items()
    ],
    key=lambda row: -row['avg'],
)

monthly = defaultdict(lambda: [0, 0, 0])
for item in works_all_filtered:
    if item.get('create_date'):
        month = item['create_date'][:7]
        monthly[month][0] += 1
        if item.get('digg_count') is not None:
            monthly[month][1] += item['digg_count']
            monthly[month][2] += 1
trend = [
    {
        'month': month,
        'count': monthly[month][0],
        'likes': monthly[month][1] if monthly[month][2] else None,
    }
    for month in sorted(monthly)
]

diggs = [item['digg_count'] for item in works]
expected = capture.get('expected_works')
if expected is None:
    expected = profile.get('aweme_count')
captured = len(works_all_filtered)
coverage = capture.get('coverage_ratio')
if coverage is None and expected:
    coverage = round(captured / expected, 4)
capture_status = capture.get('status') or ('complete' if captured == expected and expected else 'legacy_unknown')
complete = capture_status == 'complete'

# 构建时间筛选说明
filter_desc = ''
if time_filter:
    filter_type, value = time_filter
    if filter_type == 'days':
        filter_desc = f'（时间范围：最近 {value} 天）'
    elif filter_type == 'months':
        filter_desc = f'（时间范围：最近 {value} 个月）'
    elif filter_type == 'since':
        filter_desc = f'（时间范围：自 {value} 起）'

if complete:
    caveat = f'采集状态：完整（接口 has_more=0）；采集 {captured} 条{filter_desc}。单作品播放量网页端不公开。'
else:
    expected_text = f'，主页展示 {expected} 条' if expected is not None else ''
    caveat = f'采集状态：{capture_status}；当前仅采集 {captured} 条{filter_desc}{expected_text}，结论只代表已采集样本。单作品播放量网页端不公开。'

output = {
    'account': {
        'nickname': profile.get('nickname') or '(未知)',
        'douyin_id': profile.get('douyin_id') or '',
        'sec_uid': data.get('sec_uid'),
        'homepage': f"https://www.douyin.com/user/{data.get('sec_uid')}",
        'followers_raw': profile.get('follower_count'),
        'followers': cnstr(profile.get('follower_count')),
        'total_likes_raw': profile.get('total_favorited'),
        'total_likes': cnstr(profile.get('total_favorited')),
        'profile_works_total': profile.get('aweme_count'),
        'captured_works': len(works_all),  # 采集时所有作品数
        'filtered_works': captured,  # 时间筛选后作品数
        'ip': profile.get('ip_location') or '—',
        'city': profile.get('city') or '—',
        'bio': profile.get('signature') or '',
    },
    'meta': {
        'captured_at': (data.get('captured_at') or '')[:10],
        'sample': captured,
        'analyzable_sample': len(works),
        'span': span,
        'caveat': caveat,
        'time_filter': {
            'applied': filter_info is not None,
            'type': time_filter[0] if time_filter else None,
            'value': time_filter[1] if time_filter else None,
        } if time_filter else None,
    },
    'quality': {
        'capture_status': capture_status,
        'capture_complete': complete,
        'profile_works_total': expected,
        'captured_works': len(works_all),
        'filtered_works': captured,
        'analyzable_works': len(works),
        'coverage_ratio': coverage,
        'has_more': capture.get('has_more'),
        'warnings': ((capture.get('diagnostics') or {}).get('warnings') or []),
    },
    'stats': {
        'works': len(works),
        'months': months,
        'per_month': round(len(works) / months) if months else None,
        'likes_sum': sum(diggs),
        'likes_avg': round(statistics.mean(diggs)),
        'likes_median': round(statistics.median(diggs)),
        'likes_max': max(diggs),
        'comment_max': max_known('comment_count'),
        'share_max': max_known('share_count'),
        'collect_max': max_known('collect_count'),
        'v100': sum(1 for value in diggs if value >= 1000000),
        'v10': sum(1 for value in diggs if 100000 <= value < 1000000),
        'v1': sum(1 for value in diggs if 10000 <= value < 100000),
        'vlow': sum(1 for value in diggs if value < 10000),
    },
    'top_viral': [slim(item) for item in sorted(works, key=lambda value: -value['digg_count'])[:12]],
    'latest': [slim(item) for item in sorted(works_all_filtered, key=lambda value: value.get('create_time') or 0, reverse=True)[:12]],
    'collections': data.get('collections') or [],
    'mix_groups': mix_groups,
    'trend': trend,
}

temp = f'{OUT}.{os.getpid()}.tmp'
with open(temp, 'w', encoding='utf-8') as handle:
    json.dump(output, handle, ensure_ascii=False, indent=2)
os.replace(temp, OUT)

filter_text = ''
if time_filter:
    filter_type, value = time_filter
    if filter_type == 'days':
        filter_text = f' [最近{value}天]'
    elif filter_type == 'months':
        filter_text = f' [最近{value}月]'
    elif filter_type == 'since':
        filter_text = f' [自{value}]'

print(f"analyze: 样本{captured} 可分析{len(works)} 合集{len(output['collections'])} capture={capture_status}{filter_text} → {os.path.basename(OUT)}")
print(f"账号: {output['account']['nickname']} | 粉{output['account']['followers']} 赞{output['account']['total_likes']} | 最高赞{cnstr(output['stats']['likes_max'])}")
