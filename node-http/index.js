
// node-http/index.js — Minimal HTTP server for Bondfire internal E2EE
// No Express. Works on Replit. Persists via REPLIT_DB_URL if available.
// Endpoints:
//   POST /api/e2ee/store   { channel, e2ee:true, payload } -> { ok:true, ts }
//   GET  /api/e2ee/get?channel=XYZ                  -> { e2ee:true, payload, ts } | 404
//
// CORS: * (adjust if you need)
//
const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const DB_URL = process.env.REPLIT_DB_URL || null;

// Basic in-memory fallback
const mem = new Map();

async function dbSet(key, value) {
  if (!DB_URL) { mem.set(key, value); return; }
  // REPLIT_DB_URL supports POST of "key=value"
  const body = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  await fetch(DB_URL, { method: 'POST', body });
}
async function dbGet(key) {
  if (!DB_URL) { return mem.get(key) || null; }
  const res = await fetch(`${DB_URL}/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DB get failed: ${res.status}`);
  return await res.text();
}

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function notFound(res) {
  send(res, 404, { ok:false, error:'not_found' });
}

async function handleStore(req, res) {
  let raw = '';
  req.on('data', (c) => raw += c);
  req.on('end', async () => {
    try {
      const data = JSON.parse(raw || '{}');
      const { channel, e2ee, payload } = data || {};
      if (!channel || !e2ee || typeof payload !== 'string') {
        return send(res, 400, { ok:false, error: 'expected { channel, e2ee:true, payload:string }' });
      }
      const ts = Date.now();
      const key = `e2ee:${channel}:last`;
      await dbSet(key, JSON.stringify({ e2ee:true, payload, ts }));
      send(res, 200, { ok:true, ts });
    } catch (e) {
      send(res, 500, { ok:false, error: String(e.message || e) });
    }
  });
}

async function handleGet(req, res, url) {
  const channel = url.searchParams.get('channel');
  if (!channel) return send(res, 400, { ok:false, error:'missing channel' });
  const key = `e2ee:${channel}:last`;
  try {
    const val = await dbGet(key);
    if (!val) return notFound(res);
    const obj = JSON.parse(val);
    send(res, 200, obj);
  } catch (e) {
    send(res, 500, { ok:false, error:String(e.message || e) });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'POST' && url.pathname === '/api/e2ee/store') {
    return handleStore(req, res);
  }
  if (req.method === 'GET' && url.pathname === '/api/e2ee/get') {
    return handleGet(req, res, url);
  }

  notFound(res);
});

server.listen(PORT, () => {
  console.log(`Bondfire E2EE server (no Express) listening on ${PORT}`);
  console.log(DB_URL ? 'Using Replit DB' : 'Using in-memory store (non-persistent)');
});
