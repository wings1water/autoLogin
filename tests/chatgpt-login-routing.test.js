const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-forge-login-'));
const dataFile = path.join(tempDir, 'accounts.json');

fs.writeFileSync(dataFile, JSON.stringify([
  {
    id: 'retry-1',
    email: 'retry@example.com',
    password: 'pass',
    clientId: 'client',
    refreshToken: 'token',
    status: 'failed',
    error: 'temporary failure',
    errorType: null,
  },
  {
    id: 'dead-1',
    email: 'dead@example.com',
    password: 'pass',
    clientId: 'client',
    refreshToken: 'token',
    status: 'failed',
    error: '账号已停用',
    errorType: 'account_deactivated',
  },
], null, 2), 'utf8');

const configPath = require.resolve('../config');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    dataFile,
    concurrency: 8,
    chatgpt: {
      codeCheckInterval: 1,
      codeCheckMaxRetries: 1,
    },
  },
};

const chatgptPath = require.resolve('../services/chatgpt-service');
require.cache[chatgptPath] = {
  id: chatgptPath,
  filename: chatgptPath,
  loaded: true,
  exports: {
    setConcurrency: () => {},
    login: async account => ({
      accessToken: `token-${account.id}`,
    }),
  },
};

const imapPath = require.resolve('../services/imap-service');
require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: {
    fetchEmails: async () => ({ success: true, emails: [] }),
  },
};

const graphPath = require.resolve('../services/graph-service');
require.cache[graphPath] = {
  id: graphPath,
  filename: graphPath,
  loaded: true,
  exports: {
    fetchEmails: async () => ({ success: true, emails: [] }),
  },
};

const router = require('../routes/chatgpt');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function jsonRequest(baseUrl, method, pathName, body) {
  const res = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    statusCode: res.status,
    json: await res.json(),
  };
}

(async () => {
  const app = express();
  app.use(express.json());
  app.set('broadcast', () => {});
  app.use('/', router);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const retry = await jsonRequest(baseUrl, 'POST', '/chatgpt/retry-failed', {});
    assert.strictEqual(retry.statusCode, 200);
    assert.deepStrictEqual(retry.json.accountIds, ['retry-1']);
    assert.strictEqual(retry.json.skippedDeactivated, 1);

    const blockedSingle = await jsonRequest(baseUrl, 'POST', '/chatgpt/login/dead-1');
    assert.strictEqual(blockedSingle.statusCode, 400);
    assert.match(blockedSingle.json.error, /停用/);

    const mixedBatch = await jsonRequest(baseUrl, 'POST', '/chatgpt/login', {
      accountIds: ['retry-1', 'dead-1'],
      concurrency: 8,
    });
    assert.strictEqual(mixedBatch.statusCode, 200);
    assert.strictEqual(mixedBatch.json.count, 1);
    assert.strictEqual(mixedBatch.json.skippedDeactivated, 1);

    console.log('chatgpt login routing tests passed');
  } finally {
    server.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
