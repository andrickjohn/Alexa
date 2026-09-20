// Shared itinerary storage for the Detroit Wedding Trip page.
// GET  /api/data  -> { state }            (anyone)
// POST /api/data  -> { ok }               (editor password check)
// PUT  /api/data  -> save { state, baseRev } (editor only; rejects stale saves with 409)
const crypto = require('crypto');
const KEY = 'wedding-trip:state';

function store() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
async function redis(cmd) {
  const { url, token } = store();
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error('storage ' + r.status);
  return (await r.json()).result;
}
function isEditor(req) {
  const want = process.env.EDIT_PASSWORD || '';
  const got = String(req.headers['x-edit-key'] || '');
  if (!want || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (!store().url) return send(res, 500, { error: 'storage_not_configured' });
  try {
    if (req.method === 'GET') {
      const v = await redis(['GET', KEY]);
      return send(res, 200, { state: v ? JSON.parse(v) : null });
    }
    if (!isEditor(req)) return send(res, 401, { error: 'wrong_password' });
    if (req.method === 'POST') return send(res, 200, { ok: true });
    if (req.method === 'PUT') {
      const body = await readBody(req);
      const next = body && body.state;
      if (!next || typeof next.rev !== 'number' || !Array.isArray(next.items)) return send(res, 400, { error: 'bad_request' });
      const text = JSON.stringify(next);
      if (text.length > 900000) return send(res, 413, { error: 'too_large' });
      const cur = await redis(['GET', KEY]);
      if (cur) {
        const curState = JSON.parse(cur);
        if (curState.rev !== body.baseRev) return send(res, 409, { error: 'conflict', state: curState });
      }
      await redis(['SET', KEY, text]);
      return send(res, 200, { ok: true, rev: next.rev });
    }
    res.setHeader('Allow', 'GET, POST, PUT');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    return send(res, 502, { error: 'upstream_error' });
  }
};
