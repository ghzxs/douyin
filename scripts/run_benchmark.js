// 一键执行：解析账号 → 采集 → 聚合 → HTML。Markdown 仍由 agent 基于模板撰写。
// 用法: node scripts/run_benchmark.js "<主页分享链接/sec_uid/抖音号/昵称>" <输出目录> [选项]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function optionValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function atomicWrite(filename, value) {
  const temp = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filename);
}

function readJson(filename) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch (_) { return null; }
}

function updateStatus(statusFile, patch) {
  const previous = readJson(statusFile) || { schema_version: 1, started_at: new Date().toISOString() };
  const next = { ...previous, ...patch, updated_at: new Date().toISOString() };
  atomicWrite(statusFile, next);
  return next;
}

function run(command, commandArgs, options = {}) {
  console.error(`\n> ${path.basename(command)} ${commandArgs.join(' ')}`);
  return spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });
}

function help() {
  console.log(`用法:
  node scripts/run_benchmark.js "<主页分享链接/sec_uid/抖音号/昵称>" <输出目录>
    [--expected-id <抖音号>] [--max-scroll 150] [--headed|--headless] [--days 30 --months 3 --since 2024-01-01]

优先提供“分享主页”短链。若只有昵称/抖音号且搜索触发验证，程序会停止并请你补短链。`);
}

function main() {
  if (args.includes('--help') || args.includes('-h')) { help(); return 0; }
  const input = args[0];
  if (!input) { help(); return 2; }
  const defaultDir = path.join(ROOT, 'output', new Date().toISOString().replace(/[:.]/g, '-'));
  const outDir = path.resolve(args[1] && !args[1].startsWith('--') ? args[1] : defaultDir);
  const expectedId = optionValue('--expected-id', '');
  const maxScroll = optionValue('--max-scroll', '1');
  fs.mkdirSync(outDir, { recursive: true });

  const statusFile = path.join(outDir, 'run_status.json');
  const rawFile = path.join(outDir, 'account_full_raw.json');
  updateStatus(statusFile, { status: 'running', stage: 'resolve', output_dir: outDir });

  const resolveArgs = [path.join('scripts', 'resolve_secuid.js'), input];
  if (expectedId) resolveArgs.push(expectedId);
  const resolved = run(process.execPath, resolveArgs, { capture: true });
  if (resolved.stderr) process.stderr.write(resolved.stderr);
  let resolution = null;
  try { resolution = JSON.parse((resolved.stdout || '').trim()); } catch (_) {}
  if (resolution) console.log(JSON.stringify(resolution, null, 2));
  if (resolved.status !== 0 || !resolution?.hit?.uid) {
    updateStatus(statusFile, {
      status: 'blocked',
      stage: 'resolve',
      exit_code: resolved.status ?? 1,
      resolution,
      next_action: resolution?.next_action || '请提供账号“分享主页”短链后重试。',
    });
    return resolved.status ?? 1;
  }

  updateStatus(statusFile, { status: 'running', stage: 'capture', sec_uid: resolution.hit.uid, resolution_method: resolution.method });
  const captureArgs = [path.join('scripts', 'capture_account_full.js'), resolution.hit.uid, rawFile, maxScroll];
  if (args.includes('--headless')) captureArgs.push('--headless');
  if (args.includes('--headed')) captureArgs.push('--headed');
  const captured = run(process.execPath, captureArgs);
  const raw = readJson(rawFile);
  const actualId = String(raw?.profile?.douyin_id || '').toLowerCase();
  if (expectedId && actualId && actualId !== String(expectedId).toLowerCase()) {
    updateStatus(statusFile, {
      status: 'blocked',
      stage: 'identity_check',
      exit_code: 8,
      capture_status: raw?.capture?.status || 'unknown',
      next_action: `采集账号抖音号 ${actualId} 与期望 ${expectedId} 不一致；停止分析并重新核对分享链接。`,
    });
    return 8;
  }
  if (captured.status !== 0) {
    updateStatus(statusFile, {
      status: 'blocked',
      stage: 'capture',
      exit_code: captured.status ?? 1,
      capture_status: raw?.capture?.status || 'error',
      next_action: raw?.capture?.next_action || '查看采集日志后人工决定，不要自动循环重试。',
    });
    return captured.status ?? 1;
  }

  updateStatus(statusFile, { status: 'running', stage: 'analyze', capture_status: raw?.capture?.status || 'legacy' });
  const python = process.env.PYTHON || 'python3';
  const analyzed = run(python, [path.join('scripts', 'analyze.py'), outDir]);
  if (analyzed.status !== 0) {
    updateStatus(statusFile, { status: 'failed', stage: 'analyze', exit_code: analyzed.status ?? 1, next_action: '检查原始数据结构与采集状态。' });
    return analyzed.status ?? 1;
  }
  const built = run(python, [path.join('scripts', 'build_report_html.py', $identifier), outDir]);
  if (built.status !== 0) {
    updateStatus(statusFile, { status: 'failed', stage: 'html', exit_code: built.status ?? 1, next_action: '检查 report_data.json 后重建 HTML。' });
    return built.status ?? 1;
  }

  updateStatus(statusFile, {
    status: 'analysis_ready',
    stage: 'markdown',
    exit_code: 0,
    files: ['account_full_raw.json', 'report_data.json', '调研报告.html'],
    next_action: 'agent 读取 report_data.json 与 references/report-template.md，撰写调研报告.md，并按 capture_status 标注完整性。',
  });
  console.error(`\n自动阶段完成 → ${outDir}`);
  console.error('最后一步：由 agent 按九段模板撰写调研报告.md。');
  return 0;
}

try { process.exitCode = main(); }
catch (error) { console.error('ERR', error.message); process.exitCode = 1; }
