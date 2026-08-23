function classifyPageSignals({ title = '', text = '', url = '' } = {}) {
  const loginPrompt = /扫码登录|短信登录|验证码登录|密码登录|手机号登录/.test(text);
  const challengeText = /安全验证|请完成.{0,12}验证|完成验证后|拖动.{0,12}滑块|访问过于频繁|网络环境(?:存在)?风险|验证后继续|中间页/.test(text);
  const challengeRoute = /(?:^|[\W_])(?:verify|captcha|challenge)(?:$|[\W_])/i.test(`${title}\n${url}`);
  return {
    challenged: challengeText || challengeRoute,
    loginPrompt,
    serviceError: /服务异常[，,\s]*重新刷新拉取数据/.test(text),
  };
}

module.exports = { classifyPageSignals };
