const assert = require('assert');
const aliasDiscovery = require('../services/alias-discovery-service');

const mailbox = {
  id: 'main-id',
  email: 'main@outlook.com',
  password: 'pass',
  clientId: 'client',
  refreshToken: 'token',
};

const messages = [
  {
    subject: 'ChatGPT - Your new plan',
    to: [{ address: 'main+plus@outlook.com', name: 'Main Plus' }],
    cc: ['Other <other@example.com>'],
    bodyText: 'Thanks for subscribing main+plus@outlook.com',
    date: '2026-05-24T00:00:00.000Z',
    protocol: 'graph',
  },
  {
    subject: 'ChatGPT - Your new plan',
    to: [{ address: 'main@outlook.com' }],
  },
  {
    subject: 'Unrelated',
    to: [{ address: 'main+ignored@outlook.com' }],
  },
];

assert.strictEqual(
  aliasDiscovery.stripPlusAlias('main+plus@outlook.com'),
  'main@outlook.com'
);
assert.strictEqual(
  aliasDiscovery.isPlusAliasForMailbox('main+plus@outlook.com', 'main@outlook.com'),
  true
);
assert.strictEqual(
  aliasDiscovery.isPlusAliasForMailbox('other+plus@outlook.com', 'main@outlook.com'),
  false
);

const aliases = aliasDiscovery.extractAliasesFromMessages(mailbox, messages);
assert.deepStrictEqual(aliases.map(a => a.loginEmail), ['main+plus@outlook.com']);

(async () => {
  const result = await aliasDiscovery.discoverAliasesForAccounts([mailbox], {
    existingAccounts: [mailbox],
    fetchers: [
      {
        name: 'graph',
        fetch: async () => ({ success: true, emails: messages }),
      },
    ],
    now: () => '2026-05-24T00:00:00.000Z',
  });

  assert.strictEqual(result.scanned, 1);
  assert.strictEqual(result.aliases.length, 1);
  assert.strictEqual(result.newAccounts.length, 1);
  assert.strictEqual(result.newAccounts[0].email, 'main@outlook.com');
  assert.strictEqual(result.newAccounts[0].loginEmail, 'main+plus@outlook.com');
  console.log('alias discovery service tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
