function decideCaptureStatus({ pageState, post, worksCount, profile, lastHasMore }) {
  if (pageState.challenged && worksCount === 0) {
    return { status: 'challenge', exitCode: 5, nextAction: '在专用浏览器完成安全验证后，只重试一次。' };
  }
  if (pageState.loginPrompt && worksCount === 0) {
    return { status: 'login_required', exitCode: 7, nextAction: '运行 node scripts/login.js 完成专用登录态验证；登录成功后只重试一次。' };
  }
  if (pageState.serviceError && worksCount === 0) {
    return {
      status: 'page_service_error',
      exitCode: 10,
      nextAction: '页面作品区明确显示服务异常；停止刷新并保留诊断。确认登录态后，最多重试一次。',
    };
  }
  if (post.empty_bodies > 0 && post.json_bodies === 0 && worksCount === 0) {
    return {
      status: 'blocked_empty_body',
      exitCode: 4,
      nextAction: '停止自动重试；稍后用同一专用登录态、有头模式重试一次。若仍失败，改用用户提供的公开导出数据。',
    };
  }
  if (worksCount === 0 && (post.http_errors > 0 || post.api_errors > 0 || post.parse_errors > 0)) {
    return {
      status: 'endpoint_error',
      exitCode: 9,
      nextAction: '作品接口返回错误或非 JSON 内容；保留诊断并停止分析，先检查页面/API 是否变化。',
    };
  }
  if (worksCount === 0 && post.responses === 0) {
    return {
      status: 'no_post_response',
      exitCode: 6,
      nextAction: '确认输入为主页 sec_uid，并以有头模式检查页面；不要循环刷新或读取日常 Chrome 配置。',
    };
  }
  if (worksCount === 0) {
    return { status: 'no_works', exitCode: 3, nextAction: '账号没有可采集作品，或接口结构已变化；仅保留资料快照。' };
  }
  if (lastHasMore === 0) {
    return { status: 'complete', exitCode: 0, nextAction: '运行 analyze.py 与 build_report_html.py。' };
  }
  return {
    status: 'partial',
    exitCode: 0,
    nextAction: '可生成“已采集样本”报告，但不得称为全量；先检查 coverage 与 warnings。',
  };
}

module.exports = { decideCaptureStatus };
