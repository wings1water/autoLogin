const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-forge-alias-'));
const dataFile = path.join(tempDir, 'accounts.json');
fs.writeFileSync(dataFile, '[]', 'utf8');

const configPath = require.resolve('../config');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    dataFile,
  },
};

const imapPath = require.resolve('../services/imap-service');
const graphPath = require.resolve('../services/graph-service');
let mutateDuringScan = null;
const fakePlanMessages = [
  {
    subject: 'ChatGPT - Your new plan',
    to: [{ address: 'main+plan@outlook.com' }],
    bodyText: 'Your new plan is active for main+plan@outlook.com',
    date: '2026-05-24T00:00:00.000Z',
  },
];

require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: {
    fetchEmails: async () => {
      if (mutateDuringScan) {
        const fn = mutateDuringScan;
        mutateDuringScan = null;
        await fn();
      }
      return { success: true, emails: fakePlanMessages };
    },
  },
};
require.cache[graphPath] = {
  id: graphPath,
  filename: graphPath,
  loaded: true,
  exports: {
    fetchEmails: async () => ({ success: true, emails: [] }),
  },
};

const router = require('../routes/accounts');

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
  app.use('/', router);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const importText = [
      'main@outlook.com----pass----client----token',
      'main@outlook.com----pass----client----token----alias@outlook.com',
      'main@outlook.com----pass----client----token----alias@outlook.com',
    ].join('\n');

    const imported = await jsonRequest(baseUrl, 'POST', '/accounts/import', { text: importText });
    assert.strictEqual(imported.statusCode, 200);
    assert.strictEqual(imported.json.success, true);
    assert.strictEqual(imported.json.imported, 2);
    assert.strictEqual(imported.json.duplicates, 1);

    const full = await jsonRequest(baseUrl, 'GET', '/accounts/full');
    assert.strictEqual(full.json.accounts.length, 2);
    assert.strictEqual(full.json.accounts[0].loginEmail, '');
    assert.strictEqual(full.json.accounts[1].loginEmail, 'alias@outlook.com');

    const exported = await jsonRequest(baseUrl, 'POST', '/accounts/export', {});
    assert.strictEqual(exported.json.count, 2);
    assert.match(exported.json.content, /main@outlook\.com----pass----client----token/);
    assert.match(exported.json.content, /main@outlook\.com----pass----client----token----alias@outlook\.com/);

    mutateDuringScan = async () => {
      const accounts = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const main = accounts.find(a => a.id === full.json.accounts[0].id);
      main.status = 'success';
      main.session = { accessToken: 'fresh-login-token' };
      main.error = null;
      fs.writeFileSync(dataFile, JSON.stringify(accounts, null, 2), 'utf8');
    };

    const discovered = await jsonRequest(baseUrl, 'POST', '/accounts/discover-aliases', {
      ids: [full.json.accounts[0].id],
      protocols: ['imap'],
      autoImport: true,
    });
    assert.strictEqual(discovered.statusCode, 200);
    assert.strictEqual(discovered.json.success, true);
    assert.strictEqual(discovered.json.discovered, 1);
    assert.strictEqual(discovered.json.imported, 1);
    assert.strictEqual(discovered.json.importedAccounts[0].email, 'main@outlook.com');
    assert.strictEqual(discovered.json.importedAccounts[0].loginEmail, 'main+plan@outlook.com');

    const afterDiscovery = await jsonRequest(baseUrl, 'GET', '/accounts/full');
    assert.strictEqual(afterDiscovery.json.accounts.length, 3);
    assert.ok(afterDiscovery.json.accounts.some(a => a.loginEmail === 'main+plan@outlook.com'));
    const preservedMain = afterDiscovery.json.accounts.find(a => a.id === full.json.accounts[0].id);
    assert.strictEqual(preservedMain.status, 'success');
    assert.deepStrictEqual(preservedMain.session, { accessToken: 'fresh-login-token' });

    console.log('account alias tests passed');
  } finally {
    server.close();
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
