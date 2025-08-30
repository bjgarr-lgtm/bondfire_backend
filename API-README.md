
# Bondfire Internal E2EE — Replit backends (no Element, no Express)

Pick one:

## Option A: Node (no Express)
Files: `node-http/index.js`, `node-http/package.json`
- Runs on Replit Node without Express.
- Uses `REPLIT_DB_URL` for persistence if present; else in-memory.
- CORS enabled (`*`).

**Run:**
1. Open the `node-http` folder as your repl (or copy the files into your repl).
2. Ensure your repl exposes port `3000` (default).
3. Start with `npm start`.

## Option B: Python (Flask)
Files: `python-flask/main.py`, `python-flask/requirements.txt`
- Uses `REPLIT_DB_URL` for persistence if present; else in-memory.
- CORS enabled (`*`).

**Run:**
1. Open the `python-flask` folder as your repl (or copy files into your repl).
2. `pip install -r requirements.txt` (Replit may do this automatically).
3. Run `python main.py`.

---

## API

### POST /api/e2ee/store
Body:
```json
{ "channel": "general", "e2ee": true, "payload": "<ciphertext package string>" }
```
Response:
```json
{ "ok": true, "ts": 1724800000000 }
```

### GET /api/e2ee/get?channel=general
Response (example):
```json
{ "e2ee": true, "payload": "<ciphertext package string>", "ts": 1724800000000 }
```

The **server never sees plaintext**; it just stores the encrypted string.

---

## Frontend wiring

Use the kit we shipped (`bfCrypto`, `orgSecret`, `e2eeTransport`). Example:

```js
import { sendEncrypted, readDecrypted } from "@/utils/e2eeTransport";

// Send
await sendEncrypted("https://<your-repl-url>/api/e2ee/store", {
  channel: "general",         // include alongside your payload if you want the server to keep it too
  text: "hello",
});

// Read
const res = await fetch("https://<your-repl-url>/api/e2ee/get?channel=general");
const pkg = await res.json();
const data = await readDecrypted(pkg); // => { channel: "general", text: "hello" }
```

If you're already using the helper I sent earlier, its default `sendEncrypted` expects just `url` and a JSON object — it will wrap it as `{ e2ee: true, payload: "..." }`. The Node/Flask servers above expect exactly that.
