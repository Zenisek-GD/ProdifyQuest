import express from 'express';
import { HttpError, asyncHandler, isFirebaseServiceError } from './shared.js';

export function requireAuth(auth) {
  return asyncHandler(async (req, res, next) => {
    const header = req.get('authorization') || '';
    if (!/^Bearer \S+$/.test(header)) throw new HttpError(401, 'Please sign in to continue.');
    try {
      req.auth = await auth.verifyIdToken(header.slice(7), true);
    } catch (error) {
      if (isFirebaseServiceError(error)) throw error;
      throw new HttpError(401, 'Your session has expired. Please sign in again.');
    }
    next();
  });
}

// An instance-local limiter. Use a shared gateway limiter when running multiple servers.
export function rateLimit({ limit = 30, windowMs = 15 * 60 * 1000, now = Date.now, keyFor = req => req.ip } = {}) {
  const clients = new Map();
  return (req, res, next) => {
    const time = now();
    if (clients.size >= 10000) {
      for (const [key, value] of clients) if (value.resetAt <= time) clients.delete(key);
    }
    const key = keyFor(req);
    let bucket = clients.get(key);
    if (!bucket || bucket.resetAt <= time) {
      if (clients.size >= 10000 && !bucket) return res.status(429).json({ error: 'Please try again later.' });
      bucket = { count: 0, resetAt: time + windowMs };
      clients.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.set('Retry-After', String(Math.ceil((bucket.resetAt - time) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    next();
  };
}

function credentials(body, registering = false) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address.');
  if (!password || password.length > 128 || (registering && password.length < 8)) throw new HttpError(400, registering ? 'Use a password with 8 to 128 characters.' : 'Enter your password.');
  return { email, password };
}

export function createAuthRouter({ auth, db, apiKey, fetchImpl = globalThis.fetch }) {
  const router = express.Router();
  const loginLimit = rateLimit();
  const refreshLimit = rateLimit({ limit: 120 });
  async function identity(action, body, refresh = false) {
    if (!apiKey) throw new HttpError(503, 'Authentication is not configured. Set FIREBASE_API_KEY on the server.');
    const base = refresh ? 'https://securetoken.googleapis.com/v1/token' : `https://identitytoolkit.googleapis.com/v1/accounts:${action}`;
    let response;
    try {
      response = await fetchImpl(`${base}?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', headers: { 'Content-Type': refresh ? 'application/x-www-form-urlencoded' : 'application/json' },
        body: refresh ? new URLSearchParams(body).toString() : JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new HttpError(503, 'The sign-in service is unavailable. Please try again.');
    }
    const data = await response.json();
    if (!response.ok || data.error) {
      const code = data.error?.message || '';
      if (code.includes('TOO_MANY_ATTEMPTS')) throw new HttpError(429, 'Too many attempts. Please try again later.');
      if (code.includes('OPERATION_NOT_ALLOWED') || code.includes('API_KEY_INVALID') || code.includes('PROJECT_NOT_FOUND')) throw new HttpError(503, 'Email/password authentication is not configured on the server.');
      throw new HttpError(401, refresh ? 'Your session has expired. Please sign in again.' : 'Unable to sign in. Check your email and password.');
    }
    return data;
  }
  const tokens = (data) => ({ uid: data.localId || data.user_id, idToken: data.idToken || data.id_token, refreshToken: data.refreshToken || data.refresh_token, expiresIn: Number(data.expiresIn || data.expires_in || 3600) });

  router.post('/login', loginLimit, asyncHandler(async (req, res) => {
    const body = credentials(req.body);
    res.json(tokens(await identity('signInWithPassword', { ...body, returnSecureToken: true })));
  }));

  router.post('/register', loginLimit, asyncHandler(async (req, res) => {
    const { email, password } = credentials(req.body, true);
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    if (username.length < 2 || username.length > 60) throw new HttpError(400, 'Your name must have 2 to 60 characters.');
    const timeZone = req.body.timeZone || 'UTC';
    if (typeof timeZone !== 'string' || timeZone.length > 80) throw new HttpError(400, 'Choose a valid time zone.');
    try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new HttpError(400, 'Choose a valid time zone.'); }
    if (!apiKey) throw new HttpError(503, 'Authentication is not configured. Set FIREBASE_API_KEY on the server.');
    let record;
    try { record = await auth.createUser({ email, password, displayName: username }); }
    catch (error) {
      if (error.code === 'auth/email-already-exists') throw new HttpError(409, 'Unable to create this account. Try signing in or resetting your password.');
      if (error.code === 'auth/invalid-password' || error.code === 'auth/invalid-email') throw new HttpError(400, 'Check your email and password.');
      throw error;
    }
    try {
      await db.collection('users').doc(record.uid).set({
        username, email, role: 'student', timeZone, coins: 0, streak: 0, bestStreak: 0,
        character: { level: 1, exp: 0, image: 'apprenticemage', tier: 'common' },
        createdAt: new Date(),
      });
    } catch (error) {
      // Do not leave an unusable Auth account when creating its profile fails.
      try { await auth.deleteUser(record.uid); } catch { console.error('Unable to roll back incomplete registration.'); }
      throw error;
    }
    try { res.status(201).json(tokens(await identity('signInWithPassword', { email, password, returnSecureToken: true }))); }
    catch { throw new HttpError(503, 'Your account was created. Please sign in to continue.'); }
  }));

  router.post('/refresh', refreshLimit, asyncHandler(async (req, res) => {
    const refreshToken = req.body.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length > 8192) throw new HttpError(400, 'A refresh token is required.');
    res.json(tokens(await identity('', { grant_type: 'refresh_token', refresh_token: refreshToken }, true)));
  }));

  router.post('/reset-password', loginLimit, asyncHandler(async (req, res) => {
    const { email } = credentials({ email: req.body.email, password: 'unused' });
    try { await identity('sendOobCode', { requestType: 'PASSWORD_RESET', email }); }
    catch (error) { if (error.status !== 401) throw error; }
    res.json({ message: 'If an account exists for this email, a password reset link has been sent.' });
  }));

  router.post('/logout', requireAuth(auth), asyncHandler(async (req, res) => {
    await auth.revokeRefreshTokens(req.auth.uid);
    res.json({ message: 'Signed out on all devices.' });
  }));
  return router;
}
