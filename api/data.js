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
  const want = (process.env.EDIT_PASSWORD || '').trim();
  const got = String(req.headers['x-edit-key'] || '').trim();
  if (!want || !got) return false;
  const a = crypto.createHash('sha256').update(want).digest();
  const b = crypto.createHash('sha256').update(got).digest();
  return crypto.timingSafeEqual(a, b);
}

function isGuest(req) {
  const g = String(req.headers['x-guest-id'] || '').trim();
  return g.length >= 6 ? g : null;
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

function validateGuestEdit(curState, nextState, guestId) {
  if (!curState) return true;
  // Core trip settings must remain untouched
  if (JSON.stringify(curState.trip || {}) !== JSON.stringify(nextState.trip || {})) return false;
  if (JSON.stringify(curState.people || []) !== JSON.stringify(nextState.people || [])) return false;
  
  // Existing items not owned by this guest cannot be modified or deleted
  const nextMap = new Map((nextState.items || []).map(i => [i.id, i]));
  for (const item of (curState.items || [])) {
    const isOwner = item.createdBy === guestId;
    if (!isOwner) {
      const nextItem = nextMap.get(item.id);
      if (!nextItem) return false; // Non-owner cannot delete
      if (JSON.stringify(item) !== JSON.stringify(nextItem)) return false; // Non-owner cannot modify
    }
  }

  // Any newly added item or modified item must have createdBy === guestId
  const curMap = new Map((curState.items || []).map(i => [i.id, i]));
  for (const nextItem of (nextState.items || [])) {
    if (!curMap.has(nextItem.id)) {
      if (nextItem.createdBy !== guestId) return false;
    }
  }
  return true;
}

module.exports = async function handler(req, res) {
  const hasStorage = !!(store().url && store().token);
  try {
    if (req.method === 'GET') {
      if (!hasStorage) {
        return send(res, 200, { state: null, storageConfigured: false });
      }
      const v = await redis(['GET', KEY]);
      return send(res, 200, { state: v ? JSON.parse(v) : null, storageConfigured: true });
    }

    const editor = isEditor(req);
    const guestId = !editor ? isGuest(req) : null;

    if (req.method === 'POST') {
      if (editor) return send(res, 200, { ok: true, role: 'editor', storageConfigured: hasStorage });
      if (guestId) return send(res, 200, { ok: true, role: 'guest', storageConfigured: hasStorage });
      return send(res, 401, { error: 'wrong_password' });
    }

    if (req.method === 'PUT') {
      if (!editor && !guestId) return send(res, 401, { error: 'unauthorized' });
      if (!hasStorage) return send(res, 503, { error: 'storage_not_configured', storageConfigured: false });

      const body = await readBody(req);
      const next = body && body.state;
      if (!next || typeof next.rev !== 'number' || !Array.isArray(next.items)) return send(res, 400, { error: 'bad_request' });
      const text = JSON.stringify(next);
      if (text.length > 900000) return send(res, 413, { error: 'too_large' });

      const cur = await redis(['GET', KEY]);
      let curState = cur ? JSON.parse(cur) : null;

      if (!editor && guestId) {
        if (!validateGuestEdit(curState, next, guestId)) {
          return send(res, 403, { error: 'guest_forbidden_edit' });
        }
      }

      if (curState && curState.rev !== body.baseRev) {
        return send(res, 409, { error: 'conflict', state: curState });
      }

      await redis(['SET', KEY, text]);
      return send(res, 200, { ok: true, rev: next.rev, storageConfigured: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT');
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    return send(res, 502, { error: 'upstream_error', message: e.message });
  }
};
