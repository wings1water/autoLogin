const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const AUTH_FILE = path.resolve(__dirname, '..', config.authFile || './data/app-auth.json');
const TOKEN_BYTES = 32;

let authState = null;
const sessions = new Map();

function ensureAuthState() {
  if (authState) return authState;

  authState = readAuthState();
  if (!authState.passwordHash) {
    const password = config.appAuth.password || generatePassword();
    authState = {
      username: config.appAuth.username || 'admin',
      passwordHash: hashSecret(password),
      createdAt: new Date().toISOString(),
    };
    writeAuthState(authState);

    if (!config.appAuth.password) {
      console.log('');
      console.log('================ App Login ================');
      console.log(`Username: ${authState.username}`);
      console.log(`Password: ${password}`);
      console.log('Password saved to data/app-auth.json as a hash.');
      console.log('===========================================');
      console.log('');
    }
  }

  return authState;
}

function readAuthState() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeAuthState(state) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function generatePassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  return String(header || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return cookies;
      cookies[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
      return cookies;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  parts.push('Path=/');
  parts.push('HttpOnly');
  parts.push('SameSite=Lax');
  if (options.maxAge != null) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function verifyCredentials(username, password) {
  const state = ensureAuthState();
  return (
    timingSafeEqualText(username, state.username) &&
    timingSafeEqualText(hashSecret(password), state.passwordHash)
  );
}

function createSession() {
  cleanupSessions();
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = Date.now() + config.appAuth.sessionTtlMs;
  sessions.set(token, { expiresAt });
  return { token, expiresAt };
}

function getSession(req) {
  cleanupSessions();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.appAuth.cookieName];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function destroySession(req, res) {
  const session = getSession(req);
  if (session) sessions.delete(session.token);
  res.setHeader('Set-Cookie', serializeCookie(config.appAuth.cookieName, '', { maxAge: 0 }));
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (!session || session.expiresAt <= now) sessions.delete(token);
  }
}

function requireAuth(req, res, next) {
  if (getSession(req)) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: '未登录' });
  }
  return res.redirect('/login.html');
}

function setLoginCookie(req, res, session) {
  const maxAge = Math.ceil((session.expiresAt - Date.now()) / 1000);
  res.setHeader('Set-Cookie', serializeCookie(config.appAuth.cookieName, session.token, {
    maxAge,
    secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
  }));
}

module.exports = {
  createSession,
  destroySession,
  ensureAuthState,
  getSession,
  requireAuth,
  setLoginCookie,
  verifyCredentials,
};
