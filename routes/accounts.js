/**
 * Account management routes.
 * Stores Outlook mailbox credentials and an optional ChatGPT login alias.
 */

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const imapService = require('../services/imap-service');
const graphService = require('../services/graph-service');
const aliasDiscovery = require('../services/alias-discovery-service');

const DATA_FILE = path.resolve(__dirname, '..', config.dataFile);

function readAccounts() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data || '[]');
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
}

function normalizeEmail(value) {
  return String(value || '').trim();
}

function isEmailLike(value) {
  return normalizeEmail(value).includes('@');
}

function getLoginEmail(account) {
  return normalizeEmail(account.loginEmail) || normalizeEmail(account.email);
}

function getAccountKey(account) {
  return `${normalizeEmail(account.email).toLowerCase()}|${getLoginEmail(account).toLowerCase()}`;
}

function mergeNewAccountsIntoLatest(newAccounts) {
  const latest = readAccounts();
  const sourceIds = new Set(latest.map(account => account.id));
  const seenKeys = new Set(latest.map(getAccountKey));
  const unique = [];
  const duplicates = [];
  const skippedMissingSource = [];

  for (const account of newAccounts || []) {
    if (account.sourceAccountId && !sourceIds.has(account.sourceAccountId)) {
      skippedMissingSource.push(account);
      continue;
    }

    const key = getAccountKey(account);
    if (seenKeys.has(key)) {
      duplicates.push(account);
      continue;
    }

    unique.push(account);
    seenKeys.add(key);
  }

  const merged = unique.length > 0 ? [...latest, ...unique] : latest;
  if (unique.length > 0) writeAccounts(merged);

  return {
    latest,
    merged,
    unique,
    duplicates,
    skippedMissingSource,
  };
}

function parseImportLine(trimmed) {
  for (let dashCount = 4; dashCount >= 1; dashCount--) {
    const sep = '-'.repeat(dashCount);
    const rawParts = trimmed.split(sep).map(p => p.trim());
    let parts = null;

    if (rawParts.length === 4 && rawParts.every(p => p.length > 0)) {
      parts = rawParts;
    } else if (rawParts.length === 5 && rawParts.slice(0, 4).every(p => p.length > 0)) {
      parts = isEmailLike(rawParts[4])
        ? rawParts
        : [rawParts[0], rawParts[1], rawParts[2], rawParts.slice(3).join(sep).trim()];
    } else if (rawParts.length > 5) {
      const lastPart = rawParts[rawParts.length - 1];
      const hasLoginEmail = isEmailLike(lastPart);
      const base = rawParts.slice(0, 3);
      const refreshToken = rawParts.slice(3, hasLoginEmail ? -1 : undefined).join(sep).trim();

      if (base.every(p => p.length > 0) && refreshToken) {
        parts = hasLoginEmail
          ? [...base, refreshToken, lastPart]
          : [...base, refreshToken];
      }
    }

    if (
      parts &&
      (parts.length === 4 || parts.length === 5) &&
      parts.slice(0, 4).every(p => p.length > 0) &&
      (!parts[4] || isEmailLike(parts[4]))
    ) {
      return parts;
    }
  }

  return null;
}

/**
 * Supported formats:
 * mailboxEmail----password----clientId----refreshToken
 * mailboxEmail----password----clientId----refreshToken----chatgptLoginEmail
 */
function parseImportText(text) {
  const lines = text.trim().split('\n');
  const accounts = [];
  const errors = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const parts = parseImportLine(trimmed);

    if (!parts || (parts.length !== 4 && parts.length !== 5)) {
      errors.push(`第 ${index + 1} 行格式错误: ${trimmed.substring(0, 50)}...`);
      return;
    }

    const [email, password, clientId, refreshToken, loginEmailRaw] = parts;
    const mailboxEmail = normalizeEmail(email);
    const loginEmail = normalizeEmail(loginEmailRaw);

    if (!isEmailLike(mailboxEmail)) {
      errors.push(`第 ${index + 1} 行收信邮箱格式无效: ${mailboxEmail}`);
      return;
    }

    if (loginEmail && !isEmailLike(loginEmail)) {
      errors.push(`第 ${index + 1} 行 ChatGPT 登录邮箱格式无效: ${loginEmail}`);
      return;
    }

    accounts.push({
      id: uuidv4(),
      email: mailboxEmail,
      loginEmail: loginEmail && loginEmail.toLowerCase() !== mailboxEmail.toLowerCase() ? loginEmail : '',
      password,
      clientId,
      refreshToken,
      status: 'idle',
      session: null,
      error: null,
      addedAt: new Date().toISOString(),
    });
  });

  return { accounts, errors };
}

router.get('/accounts', (req, res) => {
  const accounts = readAccounts();
  const safe = accounts.map(a => ({
    ...a,
    refreshToken: a.refreshToken ? '***' + a.refreshToken.slice(-8) : '',
    password: a.password ? '***' : '',
  }));
  res.json({ success: true, accounts: safe, total: accounts.length });
});

router.get('/accounts/full', (req, res) => {
  const accounts = readAccounts();
  res.json({ success: true, accounts });
});

router.post('/accounts/import', (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, error: '导入内容不能为空' });
  }

  const { accounts: newAccounts, errors } = parseImportText(text);

  if (newAccounts.length === 0) {
    return res.json({
      success: false,
      error: '未解析到有效账号',
      errors,
      imported: 0,
      duplicates: 0,
    });
  }

  const existing = readAccounts();
  const seenKeys = new Set(existing.map(getAccountKey));
  const unique = [];

  for (const account of newAccounts) {
    const key = getAccountKey(account);
    if (seenKeys.has(key)) continue;
    unique.push(account);
    seenKeys.add(key);
  }

  const duplicates = newAccounts.length - unique.length;
  const merged = [...existing, ...unique];
  writeAccounts(merged);

  res.json({
    success: true,
    imported: unique.length,
    duplicates,
    errors,
    total: merged.length,
  });
});

router.post('/accounts/discover-aliases', async (req, res) => {
  try {
    const {
      ids,
      limit = 20,
      subject = aliasDiscovery.DEFAULT_SUBJECT,
      protocols = ['imap', 'graph'],
      autoImport = true,
    } = req.body || {};

    const accounts = readAccounts();
    const idSet = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null;
    const targets = accounts.filter(account => {
      if (idSet && !idSet.has(account.id)) return false;
      return normalizeEmail(account.email) && !normalizeEmail(account.loginEmail);
    });

    if (targets.length === 0) {
      return res.json({
        success: false,
        error: '没有可扫描的主邮箱账号',
        scanned: 0,
        discovered: 0,
        imported: 0,
        duplicates: 0,
        aliases: [],
        importedAccounts: [],
        errors: [],
      });
    }

    const protocolSet = new Set((protocols || []).map(p => String(p).toLowerCase()));
    const fetchers = [];
    if (protocolSet.has('imap')) fetchers.push({ name: 'imap', fetch: imapService.fetchEmails });
    if (protocolSet.has('graph')) fetchers.push({ name: 'graph', fetch: graphService.fetchEmails });

    if (fetchers.length === 0) {
      return res.status(400).json({ success: false, error: '请至少选择一种扫描协议' });
    }

    const discovery = await aliasDiscovery.discoverAliasesForAccounts(targets, {
      existingAccounts: accounts,
      fetchers,
      limit: Math.max(1, Math.min(100, parseInt(limit, 10) || 20)),
      subject,
    });

    let merged = accounts;
    let importedAccounts = [];
    let writeDuplicates = [];
    let skippedMissingSource = [];

    if (autoImport && discovery.newAccounts.length > 0) {
      const writeResult = mergeNewAccountsIntoLatest(discovery.newAccounts);
      merged = writeResult.merged;
      importedAccounts = writeResult.unique;
      writeDuplicates = writeResult.duplicates;
      skippedMissingSource = writeResult.skippedMissingSource;
    }

    res.json({
      success: true,
      scanned: discovery.scanned,
      discovered: discovery.aliases.length,
      imported: autoImport ? importedAccounts.length : 0,
      duplicates: discovery.duplicates.length + writeDuplicates.length,
      skippedMissingSource: skippedMissingSource.length,
      aliases: discovery.aliases,
      importedAccounts: autoImport ? importedAccounts.map(a => ({
        id: a.id,
        email: a.email,
        loginEmail: a.loginEmail,
        sourceAccountId: a.sourceAccountId,
      })) : [],
      errors: discovery.errors,
      total: merged.length,
    });
  } catch (err) {
    console.error('[Alias discovery error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/accounts/clear', (req, res) => {
  writeAccounts([]);
  res.json({ success: true, message: '已清空所有账号' });
});

router.delete('/accounts/:id', (req, res) => {
  const accounts = readAccounts();
  const filtered = accounts.filter(a => a.id !== req.params.id);

  if (filtered.length === accounts.length) {
    return res.status(404).json({ success: false, error: '账号不存在' });
  }

  writeAccounts(filtered);
  res.json({ success: true, message: '已删除' });
});

router.post('/accounts/delete-batch', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ success: false, error: '无效的 ID 列表' });
  }

  const accounts = readAccounts();
  const idSet = new Set(ids);
  const filtered = accounts.filter(a => !idSet.has(a.id));
  writeAccounts(filtered);

  res.json({
    success: true,
    deleted: accounts.length - filtered.length,
    remaining: filtered.length,
  });
});

router.post('/accounts/export', (req, res) => {
  const { ids } = req.body;
  let accounts = readAccounts();

  if (ids && Array.isArray(ids) && ids.length > 0) {
    const idSet = new Set(ids);
    accounts = accounts.filter(a => idSet.has(a.id));
  }

  const content = accounts
    .map(a => {
      const fields = [a.email, a.password, a.clientId, a.refreshToken];
      const loginEmail = normalizeEmail(a.loginEmail);
      if (loginEmail && loginEmail.toLowerCase() !== normalizeEmail(a.email).toLowerCase()) {
        fields.push(loginEmail);
      }
      return fields.join('----');
    })
    .join('\n');

  res.json({ success: true, content, count: accounts.length });
});

module.exports = router;
