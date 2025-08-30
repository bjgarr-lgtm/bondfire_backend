// worker.js — Bondfire E2EE (Cloudflare Worker version)
// Endpoints:
//   POST /api/e2ee/store   { channel, e2ee:true, payload } -> { ok:true, ts }
//   GET  /api/e2ee/get?channel=XYZ                         -> { e2ee:true, payload, ts } | 404
//
// Storage: Cloudflare KV (binding name: BOND_E2EE)
// CORS: *  (tighten if you want)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // CORS preflight
    if (request.method === "OPTIONS") {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/e2ee/store") {
        return await handleStore(request, env);
      }
      if (request.method === "GET" && url.pathname === "/api/e2ee/get") {
        return await handleGet(url, env);
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return cors(json({ ok: true }));
      }
      return cors(json({ ok: false, error: "not_found" }, 404));
    } catch (err) {
      return cors(json({ ok: false, error: "server_error", detail: String(err?.message || err) }, 500));
    }
  },
};

function cors(res) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.headers.set("Access-Control-Max-Age", "86400");
  return res;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleStore(request, env) {
  const body = await safeJson(request);
  const channel = String(body?.channel || "").trim();
  const payload = body?.payload;
  const e2ee = !!body?.e2ee;

  if (!channel) return cors(json({ ok: false, error: "missing_channel" }, 400));
  if (typeof payload === "undefined") return cors(json({ ok: false, error: "missing_payload" }, 400));

  const ts = Date.now();
  const record = { e2ee: e2ee === true, payload, ts };

  // Key = channel
  await env.BOND_E2EE.put(channel, JSON.stringify(record));
  return cors(json({ ok: true, ts }));
}

async function handleGet(url, env) {
  const channel = String(url.searchParams.get("channel") || "").trim();
  if (!channel) return cors(json({ ok: false, error: "missing_channel" }, 400));

  const raw = await env.BOND_E2EE.get(channel);
  if (!raw) return cors(json({ ok: false, error: "not_found" }, 404));

  const parsed = safeParse(raw) ?? { payload: raw, e2ee: true, ts: null };
  return cors(json(parsed));
}

async function safeJson(request) {
  try { return await request.json(); } catch { return null; }
}
function safeParse(txt) {
  try { return JSON.parse(txt); } catch { return null; }
}
