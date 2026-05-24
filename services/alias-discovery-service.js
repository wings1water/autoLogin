const { v4: uuidv4 } = require('uuid');

const DEFAULT_SUBJECT = 'ChatGPT - Your new plan';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getLoginEmail(account) {
  return normalizeEmail(account.loginEmail) || normalizeEmail(account.email);
}

function getAccountKey(account) {
  return `${normalizeEmail(account.email)}|${getLoginEmail(account)}`;
}

function stripPlusAlias(email) {
  const normalized = normalizeEmail(email);
  const at = normalized.lastIndexOf('@');
  if (at <= 0) return '';

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  const plusAt = local.indexOf('+');
  const baseLocal = plusAt >= 0 ? local.slice(0, plusAt) : local;

  return baseLocal && domain ? `${baseLocal}@${domain}` : '';
}

function isPlusAliasForMailbox(aliasEmail, mailboxEmail) {
  const alias = normalizeEmail(aliasEmail);
  const mailbox = normalizeEmail(mailboxEmail);
  return Boolean(alias && mailbox && alias !== mailbox && alias.includes('+') && stripPlusAlias(alias) === mailbox);
}

function normalizeAddressList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  const result = [];

  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      result.push(...extractEmailsFromText(item));
      continue;
    }

    const address = item.address ||
      item.email ||
      item.mail ||
      item.emailAddress?.address ||
      item.emailAddress?.email ||
      '';
    if (address) result.push(...extractEmailsFromText(address));
  }

  return result;
}

function extractEmailsFromText(text) {
  const matches = String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.map(normalizeEmail).filter(Boolean);
}

function collectMessageEmails(message) {
  const values = [
    message.to,
    message.cc,
    message.bcc,
    message.recipients,
    message.replyTo,
    message.headers,
    message.rawHeaders,
  ];

  const emails = [];
  for (const value of values) {
    emails.push(...normalizeAddressList(value));
  }

  emails.push(...extractEmailsFromText(message.bodyText));
  emails.push(...extractEmailsFromText(message.bodyPreview));
  emails.push(...extractEmailsFromText(message.bodyHtml));

  return [...new Set(emails)];
}

function isSubscriptionEmail(message, subject = DEFAULT_SUBJECT) {
  const expected = String(subject || '').trim().toLowerCase();
  const actual = String(message.subject || '').trim().toLowerCase();
  return Boolean(expected && actual.includes(expected));
}

function extractAliasesFromMessages(account, messages, subject = DEFAULT_SUBJECT) {
  const aliases = new Map();

  for (const message of messages || []) {
    if (!isSubscriptionEmail(message, subject)) continue;

    for (const address of collectMessageEmails(message)) {
      if (!isPlusAliasForMailbox(address, account.email)) continue;
      if (!aliases.has(address)) {
        aliases.set(address, {
          mailboxEmail: account.email,
          loginEmail: address,
          subject: message.subject || '',
          date: message.date || message.receivedDateTime || '',
          protocol: message.protocol || '',
          messageId: message.messageId || '',
        });
      }
    }
  }

  return [...aliases.values()];
}

async function discoverAliasesForAccounts(accounts, options = {}) {
  const {
    existingAccounts = accounts,
    fetchers = [],
    limit = 20,
    subject = DEFAULT_SUBJECT,
    now = () => new Date().toISOString(),
  } = options;

  const seenKeys = new Set((existingAccounts || []).map(getAccountKey));
  const foundKeys = new Set();
  const aliases = [];
  const newAccounts = [];
  const duplicates = [];
  const errors = [];

  for (const account of accounts || []) {
    const results = await Promise.all(fetchers.map(async fetcher => {
      try {
        const result = await fetcher.fetch(account, {
          keyword: subject,
          sender: '',
          limit,
        });
        return {
          protocol: fetcher.name,
          emails: result?.emails || [],
        };
      } catch (err) {
        errors.push({
          email: account.email,
          protocol: fetcher.name,
          error: err.message,
        });
        return {
          protocol: fetcher.name,
          emails: [],
        };
      }
    }));

    for (const result of results) {
      const discovered = extractAliasesFromMessages(
        account,
        result.emails.map(email => ({ ...email, protocol: email.protocol || result.protocol })),
        subject
      );

      for (const alias of discovered) {
        const key = `${normalizeEmail(account.email)}|${normalizeEmail(alias.loginEmail)}`;
        if (foundKeys.has(key)) continue;
        foundKeys.add(key);
        aliases.push(alias);

        if (seenKeys.has(key)) {
          duplicates.push(alias);
          continue;
        }

        seenKeys.add(key);
        newAccounts.push({
          id: uuidv4(),
          email: account.email,
          loginEmail: alias.loginEmail,
          password: account.password,
          clientId: account.clientId,
          refreshToken: account.refreshToken,
          status: 'idle',
          session: null,
          error: null,
          addedAt: now(),
          discoveredAt: now(),
          discoveredBy: 'chatgpt_plan_email',
          sourceAccountId: account.id,
        });
      }
    }
  }

  return {
    scanned: (accounts || []).length,
    aliases,
    newAccounts,
    duplicates,
    errors,
  };
}

module.exports = {
  DEFAULT_SUBJECT,
  collectMessageEmails,
  discoverAliasesForAccounts,
  extractAliasesFromMessages,
  extractEmailsFromText,
  getAccountKey,
  isPlusAliasForMailbox,
  stripPlusAlias,
};
