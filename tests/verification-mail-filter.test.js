const assert = require('assert');
const filter = require('../services/verification-mail-filter');

const messages = [
  {
    subject: 'OpenAI login code 222222',
    to: [{ address: 'main+two@outlook.com' }],
  },
  {
    subject: 'OpenAI login code 111111',
    to: [{ address: 'main+one@outlook.com' }],
  },
  {
    subject: 'OpenAI login code 333333',
    to: 'Main <main@outlook.com>',
  },
  {
    subject: 'OpenAI login code 444444',
  },
];

assert.deepStrictEqual(
  filter.collectRecipientEmails({
    to: [{ emailAddress: { address: 'Alias+Case@Outlook.com' } }],
    cc: 'Other <other@example.com>',
  }),
  ['alias+case@outlook.com', 'other@example.com']
);

assert.deepStrictEqual(
  filter
    .filterEmailsForAccount(
      { email: 'main@outlook.com', loginEmail: 'main+one@outlook.com' },
      messages
    )
    .map(m => m.subject),
  ['OpenAI login code 111111']
);

assert.deepStrictEqual(
  filter
    .filterEmailsForAccount(
      { email: 'main@outlook.com' },
      messages
    )
    .map(m => m.subject),
  ['OpenAI login code 333333']
);

console.log('verification mail filter tests passed');
