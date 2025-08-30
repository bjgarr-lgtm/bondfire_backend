// server.js (drop-in)
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import speakeasy from 'speakeasy';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Accept either a single origin (FRONTEND_ORIGIN) or a comma-separated list (CORS_ORIGINS)
const defaultOrigins = [
  'https://bondfire.netlify.app',
  'http://localhost:5173',
];
const envOrigins =
  (process.env.CORS_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean)) ||
  (process.env.FRONTEND_ORIGIN ? [process.env.FRONTEND_ORIGIN] : []);
const ALLOWED_ORIGINS = envOrigins.length ? envOrigins : defaultOrigins;

// ---- Public Org Pages (in-memory) ----
const publicPages = new Map(); // orgId -> { enabled, slug, title, about, features[], links[] }
const slugToOrg   = new Map(); // slug -> orgId

/* =========================
   CORS & Parsing — apply FIRST
   ========================= */
const corsOptions = {
  origin(origin, cb) {
    // Allow requests without Origin header (curl, same-origin, server-to-server)
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: Origin not allowed: ${origin}`), false);
  },
  credentials: true, // ok even if you don't use cookies; allows Authorization headers + flexibility
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
};
app.use((req, res, next) => { res.header('Vary', 'Origin'); next(); });
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // respond to all preflights

// Parse JSON bodies
app.use(express.json());

/* ================
   Auth helpers
   ================ */
function authRequired(req, res, next){
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/);
  if(!m) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(m[1], JWT_SECRET);
    req.user = payload; // { sub, email, name }
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function slugify(s){
  return (s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
function uniqueSlug(base){
  let trySlug = base || 'org';
  let n = 0;
  while (slugToOrg.has(trySlug)) {
    n += 1; trySlug = `${base}-${n}`;
  }
  return trySlug;
}

/* ==============================
   Public page config (requires auth to write)
   ============================== */
app.post('/api/orgs/:orgId/public/save', authRequired, (req, res) => {
  const { orgId } = req.params;
  const { enabled, title, about, features, links, slug } = req.body || {};

  const prev = publicPages.get(orgId) || {};
  let newSlug = prev.slug;

  if (typeof slug === 'string' && slug.trim()) {
    const base = slugify(slug);
    if (!base) return res.status(400).json({ ok:false, error:'BAD_SLUG' });
    if (prev.slug && slugToOrg.get(prev.slug) === orgId) slugToOrg.delete(prev.slug);
    const final = uniqueSlug(base);
    slugToOrg.set(final, orgId);
    newSlug = final;
  } else if (!prev.slug) {
    const base = slugify(title) || slugify(orgId) || 'org';
    const final = uniqueSlug(base);
    slugToOrg.set(final, orgId);
    newSlug = final;
  }

  const cleaned = {
    enabled: !!enabled,
    slug: newSlug,
    title: (title || '').trim(),
    about: (about || '').trim(),
    features: Array.isArray(features) ? features.filter(Boolean).slice(0, 50) : [],
    links: Array.isArray(links) ? links.filter(l => l && l.text && l.url).slice(0, 20) : [],
  };
  publicPages.set(orgId, cleaned);
  return res.json({ ok:true, public: cleaned });
});

app.post('/api/orgs/:orgId/public/generate', authRequired, (req, res) => {
  const { orgId } = req.params;
  const prev = publicPages.get(orgId) || {};
  const base = slugify(prev.title) || slugify(orgId) || 'org';
  const final = uniqueSlug(base);
  if (prev.slug && slugToOrg.get(prev.slug) === orgId) slugToOrg.delete(prev.slug);
  slugToOrg.set(final, orgId);
  const saved = { ...prev, slug: final };
  publicPages.set(orgId, saved);
  return res.json({ ok:true, public: saved });
});

// Public read (no auth)
app.get('/api/public/:slug', (req, res) => {
  const { slug } = req.params;
  const orgId = slugToOrg.get(slug);
  if (!orgId) return res.status(404).json({ ok:false, error:'NOT_FOUND' });
  const cfg = publicPages.get(orgId);
  if (!cfg || !cfg.enabled) return res.status(404).json({ ok:false, error:'NOT_PUBLIC' });
  return res.json({ ok:true, public: cfg, orgId });
});

/* ================
   In-memory "database"
   ================ */
const users = [
  // password: password123
  { id: 'u_1', name: 'Test User', email: 'test@bondfire.org', passwordHash: bcrypt.hashSync('password123', 10), mfaEnabled: false, mfaSecret: null, mfaTempSecret: null, resetToken: null }
];

function generateToken(user){
  return jwt.sign({ sub: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
}

function authMiddleware(req, res, next){
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if(!token) return res.status(401).json({ message: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

/* ================
   Auth routes
   ================ */
app.post('/api/auth/login', (req, res) => {
  const { email, password, mfa } = req.body || {};
  const user = users.find(u => u.email.toLowerCase() === String(email||'').toLowerCase());
  if(!user) return res.status(401).json({ message: 'Invalid email or password' });
  const ok = bcrypt.compareSync(password || '', user.passwordHash);
  if(!ok) return res.status(401).json({ message: 'Invalid email or password' });

  if(user.mfaEnabled){
    if(!mfa) return res.status(401).json({ message: 'MFA code required' });
    const verified = speakeasy.totp.verify({ secret: user.mfaSecret, encoding: 'base32', token: String(mfa), window: 1 });
    if(!verified) return res.status(401).json({ message: 'Invalid MFA code' });
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.sub);
  if(!user) return res.status(401).json({ message: 'Not found' });
  res.json({ id: user.id, name: user.name, email: user.email, mfaEnabled: user.mfaEnabled });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body || {};
  if(!name || !email || !password){
    return res.status(400).json({ message: 'Missing fields' });
  }
  const exists = users.some(u => u.email.toLowerCase() === String(email||'').toLowerCase());
  if(exists) return res.status(409).json({ message: 'Email already registered' });
  const id = 'u_' + (users.length + 1);
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = { id, name, email, passwordHash, mfaEnabled:false, mfaSecret:null, mfaTempSecret:null, resetToken:null };
  users.push(user);
  const token = generateToken(user);
  res.status(201).json({ token, user: { id, name, email } });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const user = users.find(u => u.email.toLowerCase() === String(email||'').toLowerCase());
  if(user){
    user.resetToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    console.log(`Password reset for ${user.email}: token ${user.resetToken}`);
  }
  res.json({ ok:true });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  const user = users.find(u => u.resetToken && u.resetToken === token);
  if(!user) return res.status(400).json({ message: 'Invalid token' });
  user.passwordHash = bcrypt.hashSync(newPassword || '', 10);
  user.resetToken = null;
  res.json({ ok:true });
});

app.post('/api/auth/magic-link', (req, res) => {
  const { email } = req.body || {};
  console.log(`(dev) Would send a one-time login link to: ${email}`);
  res.json({ ok: true });
});

/* ================
   MFA routes
   ================ */
// Start setup: returns a temporary secret + otpauth URL
app.get('/api/auth/mfa/setup', authRequired, (req, res) => {
  const user = users.find(u => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const secret = speakeasy.generateSecret({
    name: `Bondfire (${user.email})`,
    length: 20
  });

  user.mfaTempSecret = secret.base32;

  res.json({
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url
  });
});

// Verify 6-digit code and enable MFA
app.post('/api/auth/mfa/verify', authRequired, (req, res) => {
  const { token, secret } = req.body || {};
  const user = users.find(u => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const base32 = secret || user.mfaTempSecret;
  if (!token || !base32) {
    return res.status(400).json({ error: 'Missing token or secret' });
  }

  const ok = speakeasy.totp.verify({
    secret: base32,
    encoding: 'base32',
    token: String(token),
    window: 1
  });

  if (!ok) return res.status(400).json({ error: 'Invalid code' });

  user.mfaEnabled = true;
  user.mfaSecret = base32;
  user.mfaTempSecret = null;

  res.json({ ok: true });
});

// Optional: disable MFA
app.post('/api/auth/mfa/disable', authRequired, (req, res) => {
  const user = users.find(u => u.id === req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.mfaTempSecret = null;
  res.json({ ok: true });
});

/* ================
   Start server
   ================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on http://0.0.0.0:${PORT}`);
  console.log('Allowed CORS origins:', ALLOWED_ORIGINS.join(', '));
  console.log('Seed login -> email: test@bondfire.org   password: password123');
});
