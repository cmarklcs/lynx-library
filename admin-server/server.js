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
// Each site has its own password and its own hidden list. "lynx" is the 1st grade Lynx Library.
const SITES = {
  lynx: { password: process.env.TEACHER_PASSWORD || '', file: 'visibility.json' },
  journeys: { password: process.env.TEACHER_PASSWORD_JOURNEYS || '', file: 'visibility-journeys.json' }
};
const siteOf = name => (Object.hasOwn(SITES, name) ? name : 'lynx');
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// Sites allowed to send teacher changes (the Lynx Library, plus any extra origins for local testing).
const ALLOWED_ORIGINS = new Set([new URL(SITE_URL).origin, ...(process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);
const SESSION_HOURS = 8;

if (!SESSION_SECRET) console.warn('SESSION_SECRET is not set; teacher changes are disabled.');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- storage ---------- */
function readSettings(site) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, SITES[site].file), 'utf8')); }
  catch { return { hidden: [], updatedAt: null }; }
}
function writeSettings(site, s) {
  const file = path.join(DATA_DIR, SITES[site].file), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------- signed teacher tokens ---------- */
const sign = value => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken(site) {
  const body = Buffer.from(JSON.stringify({ site, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return body + '.' + sign(body);
}
function validToken(req, site) {
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!SESSION_SECRET || !tok.includes('.')) return false;
  const [body, sig] = tok.split('.');
  if (!safeEqual(sig, sign(body))) return false;
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString());
    return t.exp > Date.now() && (t.site || 'lynx') === site;
  } catch { return false; }
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
  const u = new URL(req.url, 'http://x'), p = u.pathname, site = siteOf(u.searchParams.get('site'));

  // Public, read-only list for the student site (any page may read it).
  if (p === '/api/visibility' && req.method === 'GET') {
    return send(res, 200, { hidden: readSettings(site).hidden }, { 'Access-Control-Allow-Origin': '*' });
  }
  if (p === '/health') return send(res, 200, { ok: true });
  if (p === '/' || p === '/index.html') { res.writeHead(302, { Location: SITE_URL + '/admin.html' }); return res.end(); }

  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (p === '/api/login' && req.method === 'POST') {
    if (!SITES[site].password || !SESSION_SECRET) return send(res, 503, { error: 'not set up' });
    const ip = clientIp(req);
    if (tooManyTries(ip)) return send(res, 429, { error: 'too many tries' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    if (!safeEqual(String(body.password || ''), SITES[site].password)) {
      attempts.get(ip).push(Date.now());
      return send(res, 401, { error: 'wrong password' });
    }
    attempts.delete(ip);
    return send(res, 200, { token: makeToken(site), hours: SESSION_HOURS });
  }

  if (p === '/api/settings' && req.method === 'GET') {
    if (!validToken(req, site)) return send(res, 401, { error: 'signed out' });
    return send(res, 200, readSettings(site));
  }
  if (p === '/api/settings' && req.method === 'POST') {
    if (!validToken(req, site)) return send(res, 401, { error: 'signed out' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    const slugs = Array.isArray(body.slugs) ? body.slugs.filter(s => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)).slice(0, 200) : [];
    if (!slugs.length || typeof body.show !== 'boolean') return send(res, 400, { error: 'need slugs and show' });
    const hidden = new Set(readSettings(site).hidden);
    slugs.forEach(x => body.show ? hidden.delete(x) : hidden.add(x));
    const next = { hidden: [...hidden].sort(), updatedAt: new Date().toISOString() };
    writeSettings(site, next);
    console.log(`[${site}] ${body.show ? 'showed' : 'hid'} ${slugs.join(', ')}`);
    return send(res, 200, next);
  }
  return send(res, 404, { error: 'not found' });
}

http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); });
}).listen(PORT, () => console.log(`Lynx Library settings server on port ${PORT}`));
