function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getLoginEmail(account) {
  return normalizeEmail(account?.loginEmail) || normalizeEmail(account?.email);
}

function extractEmailsFromText(value) {
  const text = String(value || '');
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.map(normalizeEmail).filter(Boolean);
}

function collectEmails(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.flatMap(collectEmails);
  }

  if (typeof value === 'string') {
    return extractEmailsFromText(value);
  }

  if (typeof value === 'object') {
    return collectEmails(
      value.address ||
      value.email ||
      value.mail ||
      value.emailAddress?.address ||
      value.emailAddress?.email
    );
  }

  return [];
}

function collectRecipientEmails(message) {
  const fields = [
    message?.to,
    message?.cc,
    message?.bcc,
    message?.recipients,
    message?.deliveredTo,
    message?.envelopeTo,
    message?.xOriginalTo,
  ];

  return [...new Set(fields.flatMap(collectEmails))];
}

function emailMatchesLogin(message, loginEmail) {
  const target = normalizeEmail(loginEmail);
  if (!target) return true;
  return collectRecipientEmails(message).includes(target);
}

function filterEmailsForAccount(account, emails) {
  const loginEmail = getLoginEmail(account);
  if (!loginEmail) return emails || [];
  return (emails || []).filter(email => emailMatchesLogin(email, loginEmail));
}

module.exports = {
  normalizeEmail,
  getLoginEmail,
  collectRecipientEmails,
  emailMatchesLogin,
  filterEmailsForAccount,
};
