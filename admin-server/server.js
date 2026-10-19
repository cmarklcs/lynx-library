// Lynx Library settings server.
// Stores which topics are hidden, serves the teacher checklist, and signs teachers in with Microsoft.
// No dependencies: Node 18+ only.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 8080;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_URL = (process.env.SITE_URL || 'https://cmarklcs.github.io/lynx-library').replace(/\/$/, '');
const TENANT_ID = process.env.MS_TENANT_ID || '';
const CLIENT_ID = process.env.MS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || '';
const TEACHER_DOMAIN = (process.env.TEACHER_DOMAIN || 'lausanneschool.com').toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'visibility.json');
const DEV_LOGIN = process.env.DEV_LOGIN === '1' && !process.env.RAILWAY_ENVIRONMENT; // local testing only
const SESSION_HOURS = 8;

if (!SESSION_SECRET && !DEV_LOGIN) console.warn('SESSION_SECRET is not set; teacher sign-in is disabled.');
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- storage ---------- */
function readSettings() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { hidden: [], updatedBy: null, updatedAt: null }; }
}
function writeSettings(s) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

/* ---------- signed cookies ---------- */
const b64u = buf => Buffer.from(buf).toString('base64url');
const sign = value => crypto.createHmac('sha256', SESSION_SECRET || 'dev-only').update(value).digest('base64url');
function setCookie(res, name, value, maxAgeSec) {
  const secure = BASE_URL.startsWith('https://') ? '; Secure' : '';
  const cookie = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, cookie) : cookie);
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function makeToken(obj) { const body = b64u(JSON.stringify(obj)); return body + '.' + sign(body); }
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [body, sig] = tok.split('.');
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const obj = JSON.parse(Buffer.from(body, 'base64url').toString()); return obj.exp > Date.now() ? obj : null; }
  catch { return null; }
}
const currentTeacher = req => readToken(getCookie(req, 'lynx_session'));

/* ---------- helpers ---------- */
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function redirect(res, to) { res.writeHead(302, { Location: to }); res.end(); }
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
const sameOrigin = req => (req.headers.origin || '') === new URL(BASE_URL).origin;
const msBase = () => `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;

/* ---------- routes ---------- */
async function handle(req, res) {
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;

  // Public, read-only list for the student site.
  if (p === '/api/visibility' && req.method === 'GET') {
    const s = readSettings();
    return send(res, 200, { hidden: s.hidden }, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  }
  if (p === '/health') return send(res, 200, 'ok');

  // Teacher sign-in with Microsoft (authorization code flow).
  if (p === '/login') {
    if (DEV_LOGIN) {
      setCookie(res, 'lynx_session', makeToken({ email: 'test.teacher@' + TEACHER_DOMAIN, name: 'Test Teacher', exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
      return redirect(res, '/');
    }
    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) return send(res, 503, 'Teacher sign-in is not set up yet.');
    const state = b64u(crypto.randomBytes(18)), nonce = b64u(crypto.randomBytes(18));
    setCookie(res, 'lynx_oauth', makeToken({ state, nonce, exp: Date.now() + 10 * 60e3 }), 600);
    const q = new URLSearchParams({
      client_id: CLIENT_ID, response_type: 'code', redirect_uri: BASE_URL + '/auth/callback',
      response_mode: 'query', scope: 'openid profile email', state, nonce,
      prompt: 'select_account', domain_hint: TEACHER_DOMAIN
    });
    return redirect(res, `${msBase()}/authorize?${q}`);
  }

  if (p === '/auth/callback') {
    const pending = readToken(getCookie(req, 'lynx_oauth'));
    setCookie(res, 'lynx_oauth', '', 0);
    if (url.searchParams.get('error')) return redirect(res, '/?error=' + encodeURIComponent(url.searchParams.get('error_description') || 'Sign in was cancelled.'));
    if (!pending || pending.state !== url.searchParams.get('state')) return redirect(res, '/?error=' + encodeURIComponent('Sign in timed out. Please try again.'));
    try {
      const r = await fetch(`${msBase()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code',
          code: url.searchParams.get('code') || '', redirect_uri: BASE_URL + '/auth/callback', scope: 'openid profile email'
        })
      });
      const tok = await r.json();
      if (!r.ok || !tok.id_token) throw new Error(tok.error_description || 'No ID token');
      // The ID token came straight from Microsoft over TLS using our client secret, so its claims can be trusted.
      const claims = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString());
      const email = String(claims.email || claims.preferred_username || '').toLowerCase();
      if (claims.aud !== CLIENT_ID || claims.tid !== TENANT_ID || claims.nonce !== pending.nonce) throw new Error('Token did not match this app');
      if (!email.endsWith('@' + TEACHER_DOMAIN)) return redirect(res, '/?error=' + encodeURIComponent(`Only @${TEACHER_DOMAIN} accounts can change settings.`));
      setCookie(res, 'lynx_session', makeToken({ email, name: claims.name || email, exp: Date.now() + SESSION_HOURS * 3600e3 }), SESSION_HOURS * 3600);
      return redirect(res, '/');
    } catch (e) {
      console.error('Sign-in failed:', e.message);
      return redirect(res, '/?error=' + encodeURIComponent('Sign in did not work. Please try again.'));
    }
  }

  if (p === '/logout' && req.method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad origin' });
    setCookie(res, 'lynx_session', '', 0);
    return send(res, 200, { ok: true });
  }

  // Teacher-only API.
  if (p === '/api/me') {
    const t = currentTeacher(req);
    return t ? send(res, 200, { email: t.email, name: t.name, siteUrl: SITE_URL }) : send(res, 401, { error: 'signed out', siteUrl: SITE_URL });
  }
  if (p === '/api/settings' && req.method === 'GET') {
    if (!currentTeacher(req)) return send(res, 401, { error: 'signed out' });
    return send(res, 200, readSettings(), { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/settings' && req.method === 'POST') {
    const t = currentTeacher(req);
    if (!t) return send(res, 401, { error: 'signed out' });
    if (!sameOrigin(req) || !(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 403, { error: 'bad request origin' });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    const slugs = Array.isArray(body.slugs) ? body.slugs.filter(s => typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)).slice(0, 100) : [];
    if (!slugs.length || typeof body.show !== 'boolean') return send(res, 400, { error: 'need slugs and show' });
    const s = readSettings();
    const hidden = new Set(s.hidden);
    slugs.forEach(x => body.show ? hidden.delete(x) : hidden.add(x));
    const next = { hidden: [...hidden].sort(), updatedBy: t.email, updatedAt: new Date().toISOString() };
    writeSettings(next);
    console.log(`${t.email} ${body.show ? 'showed' : 'hid'} ${slugs.join(', ')}`);
    return send(res, 200, next);
  }

  // Teacher page.
  if (p === '/' || p === '/index.html') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  }
  return send(res, 404, 'Not found');
}

http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: 'server error' }); });
}).listen(PORT, () => console.log(`Lynx Library settings server on ${BASE_URL}${DEV_LOGIN ? ' (DEV_LOGIN on)' : ''}`));
