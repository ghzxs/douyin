// 批量处理脚本：从 users.xlsx 读取账号列表，逐一执行采集、聚合、HTML生成
// 用法: node scripts/batch_process.js [--input users.xlsx] [--output ./output] [--days 30] [--max-scroll 150]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// 尝试导入 xlsx，如果不存在则给出安装提示
let XLSX;
try {
  XLSX = require('xlsx');
} catch (_) {
  console.error('❌ 需要安装 xlsx 模块：npm install xlsx');
  console.error('📝 安装完成后再次运行本脚本');
  process.exit(1);
}

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

function readExcel(filePath) {
  /**
   * 从 Excel 文件读取用户列表。
   * 期望格式：第一行为表头，其中必须包含 "主页链接" 或 "url" 等标签列。
   * 支持多列：可以有 "ID"、"昵称"、"备注" 等其他列。
   */
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      console.error(`❌ Excel 文件无工作表`);
      return [];
    }

    const worksheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json(worksheet);

    if (records.length === 0) {
      console.error(`⚠️ Excel 文件无数据行`);
      return [];
    }

    // 检测表头中是否包含主页链接列
    const headers = Object.keys(records[0] || {}).map(h => h.trim().toLowerCase());
    const urlColumnIndex = headers.findIndex(h =>
      ['主页链接', 'url', '链接', '账号链接', 'homepage', 'link'].includes(h)
    );

    if (urlColumnIndex === -1) {
      console.error(`❌ Excel 表头中未找到 "主页链接"、"url" 等标签列`);
      console.error(`   现有表头：${Object.keys(records[0] || {}).join(', ')}`);
      return [];
    }

    // 获取实际的列名（原始大小写）
    const urlColumn = Object.keys(records[0])[urlColumnIndex];

    // 过滤有效的记录（主页链接不为空）
    const validRecords = records.filter(row => {
      const url = String(row[urlColumn] || '').trim();
      return url && url.length > 0 && url !== 'undefined';
    });

    if (validRecords.length === 0) {
      console.error(`⚠️ Excel 中没有有效的主页链接`);
      return [];
    }

    console.log(`✅ 从 Excel 读取 ${validRecords.length} 条记录`);
    return validRecords.map(row => ({
      url: String(row[urlColumn]).trim(),
      id: row['ID'] || row['id'] || '',
      nickname: row['昵称'] || row['nickname'] || '',
      remark: row['备注'] || row['remark'] || '',
      ...row,  // 保留其他列的数据
    }));
  } catch (error) {
    console.error(`❌ 读取 Excel 文件失败：${error.message}`);
    return [];
  }
}

function run(command, commandArgs, options = {}) {
  return spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  });
}

function runBenchmark(input, outDir, options = {}) {
  /**
   * 执行单个账号的完整流程：解析 → 采集 → 聚合 → HTML
   */
  const benchmarkArgs = [
    path.join('scripts', 'run_benchmark.js'),
    input,
    outDir,
  ];

  if (options.days) benchmarkArgs.push('--days', String(options.days));
  if (options.months) benchmarkArgs.push('--months', String(options.months));
  if (options.since) benchmarkArgs.push('--since', options.since);
  if (options.maxScroll) benchmarkArgs.push('--max-scroll', String(options.maxScroll));
  if (options.headless !== undefined) {
    benchmarkArgs.push(options.headless ? '--headless' : '--headed');
  }

  console.error(`\n${'─'.repeat(60)}`);
  console.error(`📊 处理账号: ${input}`);
  console.error(`📁 输出目录: ${outDir}`);
  console.error(`${'─'.repeat(60)}`);

  const result = run(process.execPath, benchmarkArgs);
  return {
    success: result.status === 0,
    exitCode: result.status ?? 1,
  };
}

function help() {
  console.log(`
批量处理抖音账号数据采集

用法:
  node scripts/batch_process.js [选项]

选项:
  --input <文件>          输入 Excel 文件（默认：./users.xlsx）
  --output <目录>         输出根目录（默认：./batch_output）
  --days <天数>          仅分析最近 N 天的作品（可选）
  --months <月数>        仅分析最近 N 个月的作品（可选）
  --since <日期>         仅分析指定日期之后的作品，格式 YYYY-MM-DD（可选）
  --max-scroll <数>      单个账号最多滚动次数（默认：150）
  --headless            使用无头模式运行浏览器

Excel 文件格式要求:
  - 第一行为表头
  - 必须包含 "主页链接" 或 "url" 等标签列
  - 支持包含 "ID"、"昵称"、"备注" 等其他信息列
  
示例 Excel 内容:
  ID  | 主页链接                  | 昵称      | 备注
  1   | https://v.douyin.com/xxx/ | 小红书    | 竞品账号
  2   | https://v.douyin.com/yyy/ | 李佳琦    | 对标账号

示例命令:
  # 使用默认配置
  node scripts/batch_process.js

  # 指定输入输出路径和时间过滤
  node scripts/batch_process.js --input ./accounts.xlsx --output ./reports --days 30

  # 使用无头模式
  node scripts/batch_process.js --headless --max-scroll 100
  `);
}

function main() {
  if (args.includes('--help') || args.includes('-h')) {
    help();
    return 0;
  }

  const inputFile = optionValue('--input', path.join(process.cwd(), 'users.xlsx'));
  const outputRoot = optionValue('--output', path.join(process.cwd(), 'batch_output'));
  const days = optionValue('--days', '');
  const months = optionValue('--months', '');
  const since = optionValue('--since', '');
  const maxScroll = optionValue('--max-scroll', '2');
  const headless = args.includes('--headless');

  // 检查输入文件是否存在
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ 输入文件不存在：${inputFile}`);
    console.error(`📝 请确保在当前目录放置 users.xlsx，或使用 --input 指定路径`);
    help();
    return 1;
  }

  console.log(`\n🔍 读取用户列表...`);
  const users = readExcel(inputFile);
  if (users.length === 0) {
    return 1;
  }

  // 创建输出根目录
  fs.mkdirSync(outputRoot, { recursive: true });

  // 初始化批处理日志
  const batchLogFile = path.join(outputRoot, '_batch_process.log');
  const batchSummary = {
    started_at: new Date().toISOString(),
    input_file: inputFile,
    total_accounts: users.length,
    results: [],
  };

  let successCount = 0;
  let failedCount = 0;

  // 逐个处理账号
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const { url, id, nickname, remark } = user;
    // 生成输出目录名：优先使用 ID，否则使用昵称或序号
    const dirName = id || nickname || `unknown_${i + 1}`;
    const accountDir = path.join(outputRoot, `account_${dirName}`);

    try {
      const options = { maxScroll };
      if (days) options.days = parseInt(days);
      if (months) options.months = parseInt(months);
      if (since) options.since = since;
      if (headless !== undefined) options.headless = headless;

      const result = runBenchmark(url, accountDir, options);

      const accountResult = {
        index: i + 1,
        id: id || '(未设置)',
        nickname: nickname || '(未知)',
        url,
        remark,
        output_dir: accountDir,
        success: result.success,
        exit_code: result.exitCode,
        processed_at: new Date().toISOString(),
      };

      batchSummary.results.push(accountResult);

      if (result.success) {
        successCount++;
        console.error(`✅ 账号 ${i + 1}/${users.length} (ID: ${id || '未设置'}) 处理成功`);
      } else {
        failedCount++;
        console.error(`❌ 账号 ${i + 1}/${users.length} (ID: ${id || '未设置'}) 处理失败（退出码：${result.exitCode}）`);
      }
    } catch (error) {
      failedCount++;
      console.error(`❌ 账号 ${i + 1}/${users.length} (ID: ${id || '未设置'}) 处理异常：${error.message}`);
      batchSummary.results.push({
        index: i + 1,
        id: id || '(未设置)',
        nickname: nickname || '(未知)',
        url,
        remark,
        success: false,
        error: error.message,
        processed_at: new Date().toISOString(),
      });
    }
  }

  // 保存批处理总结
  batchSummary.completed_at = new Date().toISOString();
  batchSummary.success_count = successCount;
  batchSummary.failed_count = failedCount;
  atomicWrite(batchLogFile, batchSummary);

  // 输出最终统计
  console.error(`\n${'═'.repeat(60)}`);
  console.error(`📊 批处理完成统计`);
  console.error(`${'═'.repeat(60)}`);
  console.error(`总账号数：${users.length}`);
  console.error(`✅ 成功：${successCount}`);
  console.error(`❌ 失败：${failedCount}`);
  console.error(`📁 输出目录：${outputRoot}`);
  console.error(`📝 处理日志：${batchLogFile}`);
  console.error(`${'═'.repeat(60)}\n`);

  return failedCount === 0 ? 0 : 1;
}

try { process.exitCode = main(); }
catch (error) { console.error('ERR', error.message); process.exitCode = 1; }
