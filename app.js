import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createAuthRouter, requireAuth, rateLimit } from './api/auth.js';
import { createCoreRouter } from './api/core.js';
import { createGuildRouter } from './api/guilds.js';
import { createCompanionRouter } from './api/companions.js';
import { createRaidRouter } from './api/raids.js';
import { createQuestBoxRouter } from './api/quest-boxes.js';
import { createCustomizationRouter } from './api/customization.js';
import { HttpError, errorHandler } from './api/shared.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ auth, db, apiKey = process.env.FIREBASE_API_KEY, fetchImpl, now = () => new Date(), questBoxRandom, bossChestRandom, battleRandom, gearRandom, wardrobeRandom, origins = (process.env.CORS_ORIGINS || 'http://localhost:8081,http://localhost:19006,http://localhost:3000').split(',').map(value => value.trim()), webDirectory = path.join(directory, '../quest-frontend/dist') }) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(cors({ origin(origin, callback) {
    if (!origin || origins.includes(origin)) return callback(null, true);
    callback(new HttpError(403, 'This origin is not allowed.'));
  }, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body != null && (typeof req.body !== 'object' || Array.isArray(req.body))) return next(new HttpError(400, 'The request body must be a JSON object.'));
    req.body ??= {};
    next();
  });
  app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ProdifyQuest API' }));
  app.use('/characters', express.static(path.join(directory, 'characters'), { dotfiles: 'deny', maxAge: '1d' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/auth', createAuthRouter({ auth, db, apiKey, fetchImpl }));
  app.use('/api', requireAuth(auth), rateLimit({ limit: 300, windowMs: 60000, keyFor: req => req.auth.uid }), createCoreRouter({ db, now, questBoxRandom }), createGuildRouter({ db }), createCompanionRouter({ db, now }), createRaidRouter({ db, now, bossChestRandom, battleRandom, gearRandom, wardrobeRandom }), createQuestBoxRouter({ db, now, random: questBoxRandom }), createCustomizationRouter({ db, now }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));

  if (existsSync(path.join(webDirectory, 'index.html'))) {
    app.use(express.static(webDirectory));
    app.get('*', (req, res) => res.sendFile(path.join(webDirectory, 'index.html')));
  } else {
    app.get('/', (req, res) => res.json({ name: 'ProdifyQuest', message: 'The API is running. Start quest-frontend with npm start to open the app.' }));
  }
  // Keep legacy source for reference, but never expose its unsafe mutations.
  // GET paths can serve the SPA above, including direct links to /home or /guild.
  app.all(['/login', '/register', '/logout', '/home', '/tasks*', '/rewards*', '/guild*', '/shop*', '/profile*', '/admin*', '/teacher*', '/boxes*', '/debug*', '/friends*', '/private*', '/chat*'], (req, res) => {
    res.status(410).json({ error: 'This legacy endpoint has been retired. Use the ProdifyQuest app and authenticated /api endpoints.' });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}
