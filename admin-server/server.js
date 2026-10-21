// Lynx Library settings server.
// Stores which topics are hidden. Teachers unlock changes with a shared password;
// the teacher panel itself lives on the Lynx Library site (admin.html).
// No dependencies: Node 18+ only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 8080;
const SITE_URL = (process.env.SITE_URL || 'https://cmarklcs.github.io/lynx-library').replace(/\/$/, '');
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'visibility.json');
// Sites allowed to send teacher changes (the Lynx Library, plus any extra origins for local testing).
const ALLOWED_ORIGINS = new Set([new URL(SITE_URL).origin, ...(process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
const SESSION_HOURS = 8;

if (!TEACHER_PASSWORD || !SESSION_SECRET) console.warn('TEACHER_PASSWORD or SESSION_SECRET is not set; teacher changes are disabled.');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- storage ---------- */
function readSettings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { hidden: [], updatedAt: null }; }
}
function writeSettings(s) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- signed teacher tokens ---------- */
const sign = value => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return body + '.' + sign(body);
}
function validToken(req) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!SESSION_SECRET || !tok.includes('.')) return false;
  const [body, sig] = tok.split('.');
  if (!safeEqual(sig, sign(body))) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

/* ---------- slow down password guessing: 10 wrong tries per 15 minutes per address ---------- */
const attempts = new Map();
function tooManyTries(ip) {
  const now = Date.now(), list = (attempts.get(ip) || []).filter(t => now - t < 15 * 60e3);
  attempts.set(ip, list);
  return list.length >= 10;
}
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

/* ---------- helpers ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

/* ---------- routes ---------- */
async function handle(req, res) {
  const p = new URL(req.url, 'http://x').pathname;

  // Public, read-only list for the student site (any page may read it).
  if (p === '/api/visibility' && req.method === 'GET') {
    return send(res, 200, { hidden: readSettings().hidden }, { 'Access-Control-Allow-Origin': '*' });
  }
  if (p === '/health') return send(res, 200, { ok: true });
  if (p === '/' || p === '/index.html') { res.writeHead(302, { Location: SITE_URL + '/admin.html' }); return res.end(); }

  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (p === '/api/login' && req.method === 'POST') {
    if (!TEACHER_PASSWORD || !SESSION_SECRET) return send(res, 503, { error: 'not set up' });
    const ip = clientIp(req);
    if (tooManyTries(ip)) return send(res, 429, { error: 'too many tries' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    if (!safeEqual(String(body.password || ''), TEACHER_PASSWORD)) {
      attempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'wrong password' });
    }
    attempts.delete(ip);
    return send(res, 200, { token: makeToken(), hours: SESSION_HOURS });
  }

  if (p === '/api/settings' && req.method === 'GET') {
    if (!validToken(req)) return send(res, 401, { error: 'signed out' });
    return send(res, 200, readSettings());
  }
  if (p === '/api/settings' && req.method === 'POST') {
    if (!validToken(req)) return send(res, 401, { error: 'signed out' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    const slugs = Array.isArray(body.slugs) ? body.slugs.filter(s => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)).slice(0, 200) : [];
    if (!slugs.length || typeof body.show !== 'boolean') return send(res, 400, { error: 'need slugs and show' });
    const hidden = new Set(readSettings().hidden);
    slugs.forEach(x => body.show ? hidden.delete(x) : hidden.add(x));
    const next = { hidden: [...hidden].sort(), updatedAt: new Date().toISOString() };
    writeSettings(next);
    console.log(`${body.show ? 'showed' : 'hid'} ${slugs.join(', ')}`);
    return send(res, 200, next);
  }
  return send(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); });
}).listen(PORT, () => console.log(`Lynx Library settings server on port ${PORT}`));
