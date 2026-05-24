/**
 * ChatGPT auto-login routes.
 * Login uses account.loginEmail when present; mailbox fetching still uses account.email.
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const config = require('../config');
const chatgptService = require('../services/chatgpt-service');
const imapService = require('../services/imap-service');
const graphService = require('../services/graph-service');
const verificationMailFilter = require('../services/verification-mail-filter');

const DATA_FILE = path.resolve(__dirname, '..', config.dataFile);

function readAccounts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8') || '[]');
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

function updateAccountStatus(accountId, updates) {
  const accounts = readAccounts();
  const idx = accounts.findIndex(a => a.id === accountId);
  if (idx >= 0) {
    Object.assign(accounts[idx], updates);
    writeAccounts(accounts);
  }
}

function normalizeLoginError(error) {
  const message = String(error || '未知错误');
  const lower = message.toLowerCase();
  if (
    lower.includes('account_deactivated') ||
    lower.includes('deleted or deactivated')
  ) {
    return {
      message: '账号已停用',
      type: 'account_deactivated',
    };
  }

  return {
    message,
    type: null,
  };
}

function isAccountDeactivated(account) {
  const message = String(account?.error || '').toLowerCase();
  return (
    account?.errorType === 'account_deactivated' ||
    message.includes('account_deactivated') ||
    message.includes('deleted or deactivated') ||
    message.includes('账号已停用')
  );
}

function getLoginEmail(account) {
  return String(account.loginEmail || account.email || '').trim();
}

function loginEventBase(account) {
  const loginEmail = getLoginEmail(account);
  return {
    accountId: account.id,
    email: loginEmail,
    loginEmail,
    mailboxEmail: account.email,
  };
}

async function fetchVerificationCode(account) {
  const options = {
    keyword: 'OpenAI',
    sender: '',
    limit: 30,
  };

  const promises = [
    imapService.fetchEmails(account, options).catch(err => {
      console.error(`[IMAP code fetch failed] ${account.email}:`, err.message);
      return { success: false, emails: [] };
    }),
    graphService.fetchEmails(account, options).catch(err => {
      console.error(`[Graph code fetch failed] ${account.email}:`, err.message);
      return { success: false, emails: [] };
    }),
  ];

  const results = await Promise.all(promises);
  const allEmails = [];
  for (const r of results) {
    if (r.emails && r.emails.length > 0) {
      allEmails.push(...r.emails);
    }
  }

  return verificationMailFilter.filterEmailsForAccount(account, allEmails);
}

router.post('/chatgpt/login', async (req, res) => {
  const { accountIds, concurrency } = req.body;

  if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ success: false, error: '请选择要登录的账号' });
  }

  const requestedConcurrency = Math.max(
    1,
    Math.min(20, parseInt(concurrency, 10) || config.concurrency || 8)
  );
  chatgptService.setConcurrency(requestedConcurrency);

  const broadcast = req.app.get('broadcast');
  const accounts = readAccounts();
  const requestedAccounts = accounts.filter(a => accountIds.includes(a.id));
  const toLogin = requestedAccounts.filter(a => !isAccountDeactivated(a));
  const skippedDeactivated = requestedAccounts.length - toLogin.length;

  if (requestedAccounts.length === 0) {
    return res.status(404).json({ success: false, error: '未找到指定的账号' });
  }

  if (toLogin.length === 0) {
    return res.status(400).json({ success: false, error: '选中的账号均已停用，已跳过登录' });
  }

  res.json({
    success: true,
    message: `登录任务已启动，共 ${toLogin.length} 个账号，并发 ${Math.min(requestedConcurrency, toLogin.length)}${skippedDeactivated ? `，已跳过 ${skippedDeactivated} 个已停用账号` : ''}`,
    count: toLogin.length,
    concurrency: Math.min(requestedConcurrency, toLogin.length),
    skippedDeactivated,
  });

  (async () => {
    let completed = 0;
    let succeeded = 0;
    let nextIndex = 0;

    async function runOne(account, workerId) {
      updateAccountStatus(account.id, { status: 'logging_in', error: null, errorType: null });
      broadcast({
        type: 'login_start',
        ...loginEventBase(account),
        workerId,
      });

      try {
        const session = await chatgptService.login(
          account,
          fetchVerificationCode,
          (status, detail) => {
            broadcast({
              type: 'login_status',
              ...loginEventBase(account),
              status,
              detail,
              workerId,
            });
          }
        );

        updateAccountStatus(account.id, {
          status: 'success',
          session,
          error: null,
          errorType: null,
        });

        succeeded++;
        broadcast({
          type: 'login_success',
          ...loginEventBase(account),
        });
      } catch (err) {
        const loginError = normalizeLoginError(err.message);

        updateAccountStatus(account.id, {
          status: 'failed',
          error: loginError.message,
          errorType: loginError.type,
        });

        broadcast({
          type: 'login_failed',
          ...loginEventBase(account),
          error: loginError.message,
          errorType: loginError.type,
        });
      } finally {
        completed++;

        broadcast({
          type: 'login_progress',
          completed,
          total: toLogin.length,
          succeeded,
        });
      }
    }

    async function worker(workerId) {
      while (nextIndex < toLogin.length) {
        const account = toLogin[nextIndex++];
        await runOne(account, workerId);
      }
    }

    const workerCount = Math.min(requestedConcurrency, toLogin.length);
    await Promise.all(Array.from({ length: workerCount }, (_, i) => worker(i + 1)));

    broadcast({
      type: 'login_complete',
      total: toLogin.length,
      succeeded,
      failed: toLogin.length - succeeded,
    });
  })().catch(err => {
    console.error('[Batch login job failed]', err);
    broadcast({
      type: 'login_complete',
      total: toLogin.length,
      succeeded: 0,
      failed: toLogin.length,
      error: err.message,
    });
  });
});

router.post('/chatgpt/login/:id', async (req, res) => {
  const accounts = readAccounts();
  const account = accounts.find(a => a.id === req.params.id);

  if (!account) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  if (isAccountDeactivated(account)) {
    return res.status(400).json({ success: false, error: '账号已停用，已从登录队列中隔离' });
  }

  const broadcast = req.app.get('broadcast');

  res.json({ success: true, message: '登录任务已启动' });

  (async () => {
    updateAccountStatus(account.id, { status: 'logging_in', error: null, errorType: null });
    broadcast({ type: 'login_start', ...loginEventBase(account) });

    let succeeded = 0;
    try {
      const session = await chatgptService.login(
        account,
        fetchVerificationCode,
        (status, detail) => {
          broadcast({ type: 'login_status', ...loginEventBase(account), status, detail });
        }
      );

      updateAccountStatus(account.id, { status: 'success', session, error: null, errorType: null });
      broadcast({ type: 'login_success', ...loginEventBase(account) });
      succeeded = 1;
    } catch (err) {
      const loginError = normalizeLoginError(err.message);
      updateAccountStatus(account.id, { status: 'failed', error: loginError.message, errorType: loginError.type });
      broadcast({
        type: 'login_failed',
        ...loginEventBase(account),
        error: loginError.message,
        errorType: loginError.type,
      });
    }

    broadcast({ type: 'login_progress', completed: 1, total: 1, succeeded });
  })();
});

router.post('/chatgpt/retry-failed', (req, res) => {
  const accounts = readAccounts();
  const failed = accounts.filter(a => a.status === 'failed' && !isAccountDeactivated(a));
  const skippedDeactivated = accounts.filter(a => a.status === 'failed' && isAccountDeactivated(a)).length;

  if (failed.length === 0) {
    return res.json({
      success: false,
      error: skippedDeactivated ? '没有可重试的失败账号，已停用账号会被跳过' : '没有失败的账号需要重试',
      skippedDeactivated,
    });
  }

  res.json({
    success: true,
    accountIds: failed.map(a => a.id),
    count: failed.length,
    skippedDeactivated,
    message: `找到 ${failed.length} 个需重登账号${skippedDeactivated ? `，已跳过 ${skippedDeactivated} 个已停用账号` : ''}`,
  });
});

router.get('/chatgpt/sessions', (req, res) => {
  const accounts = readAccounts();
  const sessions = accounts
    .filter(a => a.status === 'success' && a.session)
    .map(a => ({
      id: a.id,
      email: a.email,
      loginEmail: getLoginEmail(a),
      mailboxEmail: a.email,
      session: a.session,
    }));

  res.json({ success: true, sessions, count: sessions.length });
});

module.exports = router;
