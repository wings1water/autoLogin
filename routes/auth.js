const router = require('express').Router();
const authService = require('../services/app-auth-service');

router.get('/status', (req, res) => {
  const state = authService.ensureAuthState();
  const session = authService.getSession(req);
  res.json({
    success: true,
    authenticated: Boolean(session),
    username: state.username,
  });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!authService.verifyCredentials(username, password)) {
    return res.status(401).json({ success: false, error: '用户名或密码错误' });
  }

  const session = authService.createSession();
  authService.setLoginCookie(req, res, session);
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  authService.destroySession(req, res);
  res.json({ success: true });
});

module.exports = router;
