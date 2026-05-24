# ChatGPT Session Forge

[English](README.en.md)

一个本地运行的 ChatGPT 会话管理工具，用于导入 Outlook 账号、自动获取 OpenAI 邮箱验证码、批量完成 ChatGPT 登录，并导出 CPA / sub2api / Cockpit 可用的凭证 JSON。

这个项目适合需要集中管理多个 ChatGPT Web Session 的本地工作流。所有账号数据、登录结果和导出文件都保存在本机，不需要外部数据库。

## 功能特性

- 支持批量导入 Outlook 账号
- 支持 IMAP 与 Microsoft Graph 双协议取件
- 自动从邮箱中提取 OpenAI 验证码
- 支持批量 ChatGPT 登录，并可设置并发数
- 登录进度、状态和日志实时刷新
- 自动识别账号停用 / 删除类错误
- CPA 导出：一个账号一个 JSON 文件
- sub2api 导出：生成包含 `accounts` 数组的聚合 JSON
- Cockpit 导出：生成 `cockpit-tools` 可直接导入的扁平 Codex token JSON 数组
- 支持粘贴原始 `https://chatgpt.com/api/auth/session` JSON 并转换
- 支持通过环境变量或 Windows 系统代理配置后端出站代理

## 环境要求

- Node.js 18 或更高版本
- Outlook 账号 OAuth 数据：
  - 邮箱
  - 密码
  - Microsoft OAuth Client ID
  - Refresh Token
- 可以访问以下服务：
  - `chatgpt.com`
  - `auth.openai.com`
  - `outlook.office365.com`
  - `graph.microsoft.com`

## 一键安装 / 升级（云服务器）

在 Ubuntu / Debian 云服务器上可以直接运行同一个脚本完成首次安装和后续升级：

```bash
REPO_URL=https://github.com/<你的GitHub用户名>/<你的仓库名>.git bash <(curl -fsSL https://raw.githubusercontent.com/<你的GitHub用户名>/<你的仓库名>/master/scripts/onekey.sh)
```

再次执行同一条命令就是升级：脚本会 `git pull`、更新依赖、重启 PM2，并保留 `data/accounts.json`。

如果你是从别人的仓库 clone 的，请先 fork 或创建自己的仓库，并把当前修改推送到自己的仓库。否则服务器会拉不到这个一键脚本和你的本地改动。

常用自定义参数：

```bash
REPO_URL=https://github.com/<你的GitHub用户名>/<你的仓库名>.git DOMAIN=your-domain.com PORT=3000 bash <(curl -fsSL https://raw.githubusercontent.com/<你的GitHub用户名>/<你的仓库名>/master/scripts/onekey.sh)
```

如果只想开放端口、不配置 Nginx：

```bash
REPO_URL=https://github.com/<你的GitHub用户名>/<你的仓库名>.git SETUP_NGINX=0 bash <(curl -fsSL https://raw.githubusercontent.com/<你的GitHub用户名>/<你的仓库名>/master/scripts/onekey.sh)
```

项目自带登录功能，默认端口为 `8866`。首次启动如果没有设置 `APP_PASSWORD`，程序会自动生成密码并打印到 PM2 日志中。也可以安装时指定：

```bash
REPO_URL=https://github.com/<你的GitHub用户名>/<你的仓库名>.git APP_USERNAME=admin APP_PASSWORD='your-strong-password' bash <(curl -fsSL https://raw.githubusercontent.com/<你的GitHub用户名>/<你的仓库名>/master/scripts/onekey.sh)
```

如果要继续使用 Nginx Basic Auth，可以额外设置 `ENABLE_BASIC_AUTH=1`。

> 重要：本项目会保存邮箱令牌和 ChatGPT session，请务必设置强密码。

## 安装

```bash
npm install
```

## 启动

```bash
npm start
```

然后打开：

```text
http://localhost:3000
```

默认端口是 `8866`。也可以指定端口：

```bash
PORT=8080 npm start
```

Windows PowerShell：

```powershell
$env:PORT = "8080"
npm start
```

## 代理配置

后端出站请求使用 `undici`，代理配置在 `config.js` 中：

```js
proxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || 'auto'
```

默认值 `auto` 会尝试读取 Windows 当前用户代理。也可以手动指定：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 npm start
```

如果不想使用代理，可以在 `config.js` 中设置为 `direct` 或 `none`。

## 使用方法

1. 打开 Web UI。
2. 在“邮箱取件”页导入 Outlook 账号，格式如下：

   ```text
   user@outlook.com----password----client-id----refresh-token
   ```

   如果 ChatGPT 使用 Outlook 别名邮箱登录，但验证码仍进入主邮箱，可以追加第 5 段登录邮箱：

   ```text
   main@outlook.com----password----client-id----refresh-token----alias@outlook.com
   ```

   其中第 1 段用于 Outlook IMAP / Graph 收取验证码，第 5 段用于提交给 ChatGPT 登录。

   如果别名遵循 `email+别名@domain`，也可以只导入主邮箱，然后点击“扫描订阅邮件别名”。程序会搜索主题为 `ChatGPT - Your new plan` 的邮件，从收件人和邮件内容中提取 `main+xxx@outlook.com`，并自动新增对应的 `loginEmail` 别名账号。

3. 进入“自动登录”页。
4. 选择需要登录的账号，并设置并发数。
5. 点击登录。
6. 登录成功后，选择成功账号并导出：
   - `CPA`：每个账号导出为一个 JSON 文件
   - `sub2api`：导出为一个聚合 JSON 文件
   - `Cockpit`：导出为一个 JSON 数组文件，可导入 [jlcodes99/cockpit-tools](https://github.com/jlcodes99/cockpit-tools)

## CPA 导出格式

CPA 导出采用“一个账号一个 JSON 文件”的形式。结构示例：

```json
{
  "type": "codex",
  "email": "user@example.com",
  "account_id": "00000000-0000-4000-9000-000000000000",
  "chatgpt_account_id": "00000000-0000-4000-9000-000000000000",
  "plan_type": "free",
  "chatgpt_plan_type": "free",
  "id_token": "header.payload.",
  "access_token": "real-access-token",
  "refresh_token": "",
  "session_token": "real-session-token",
  "last_refresh": "2026-05-24T00:00:00.000Z",
  "expired": "2026-08-22T00:00:00.000Z",
  "disabled": false,
  "id_token_synthetic": true
}
```

该格式由 ChatGPT Web Session 和 access token claims 派生生成。登录成功后程序不会主动退出 ChatGPT，因为退出可能导致 access token 失效。

## sub2api 导出格式

sub2api 导出为聚合结构：

```json
{
  "exported_at": "2026-05-24T00:00:00.000Z",
  "proxies": [],
  "accounts": []
}
```

每个账号会包含 OAuth 凭证、账号 ID、用户 ID、套餐类型、过期时间和额外元数据。

## Cockpit 导出格式

Cockpit 导出采用 `cockpit-tools` 当前导入逻辑支持的扁平 Codex token JSON 数组。结构示例：

```json
[
  {
    "type": "codex",
    "auth_mode": "oauth",
    "email": "user@example.com",
    "name": "user@example.com",
    "account_id": "00000000-0000-4000-9000-000000000000",
    "organization_id": "",
    "user_id": "user-example",
    "plan_type": "free",
    "id_token": "header.payload.",
    "access_token": "real-access-token",
    "refresh_token": "",
    "session_token": "real-session-token",
    "last_refresh": "2026-05-24T00:00:00.000Z",
    "expired": "2026-08-22T00:00:00.000Z",
    "source": "chatgpt_session_forge",
    "id_token_synthetic": true
  }
]
```

`cockpit-tools` 会读取 `id_token`、`access_token`、`account_id`，并在 `refresh_token` 为空时使用 `session_token` 作为回退字段。

## 本地数据

运行时账号数据保存在：

```text
data/accounts.json
```

日志保存在：

```text
logs/
```

这两个路径都已加入 `.gitignore`，不会被提交到仓库。

## 安全提醒

本项目会处理高度敏感的数据：

- Outlook 密码
- OAuth refresh token
- ChatGPT access token
- ChatGPT session token
- 导出的 CPA / sub2api / Cockpit 凭证文件

不要提交运行数据、日志、导出的 JSON / ZIP 文件，或任何包含 token 的截图。公开仓库前请务必检查：

```bash
git status --ignored
```

## 脚本

```bash
npm start
```

启动 Express 服务。

```bash
npm run dev
```

使用 Node watch mode 启动开发模式。

## 许可证

当前暂未选择许可证。如果你希望其他人复用或修改该项目，请在公开发布前添加合适的开源许可证。
