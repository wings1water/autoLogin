/**
 * 应用配置
 */
module.exports = {
  // 服务器端口
  port: process.env.PORT || 8866,
  host: process.env.HOST || '0.0.0.0',

  // 数据文件路径
  dataFile: './data/accounts.json',

  // 项目登录配置。首次启动未设置 APP_PASSWORD 时会自动生成密码并写入 data/app-auth.json。
  authFile: './data/app-auth.json',
  appAuth: {
    username: process.env.APP_USERNAME || 'admin',
    password: process.env.APP_PASSWORD || '',
    cookieName: 'session_forge_auth',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  },

  // 并发控制
  concurrency: 8,

  // IMAP 配置
  imap: {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    timeout: 30000,
  },

  // Graph API 配置
  graph: {
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    apiBase: 'https://graph.microsoft.com/v1.0',
    scope: 'https://graph.microsoft.com/.default offline_access',
  },

  // ChatGPT 协议登录配置
  chatgpt: {
    sessionUrl: 'https://chatgpt.com/api/auth/session',
    timeout: 120000, // 登录超时 2 分钟
    codeCheckInterval: 5000, // 验证码检查间隔 5 秒（协议更快，给邮件到达时间）
    codeCheckMaxRetries: 20, // 最多检查 20 次
  },

  // Node 后端出站代理。留空时自动读取 Windows 当前用户代理。
  proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || 'auto',
};
