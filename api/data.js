/* ============================================================
   api/data.js — the whole backend, one serverless function
   ------------------------------------------------------------
   Storage: Neon Postgres (Vercel Marketplace).

   IMPORTANT: there must be NO package.json inside this folder.
   One here makes Vercel treat api/ as a separate package, and
   the database driver never gets installed — which surfaces as
   FUNCTION_INVOCATION_FAILED with "Cannot find package".

   The driver is loaded with a dynamic import inside try/catch so
   a missing dependency returns readable JSON instead of taking
   the whole function down before it can respond.

   Accounts:
     - Passwords stored as PBKDF2-SHA256 (210k rounds) with a
       per-user random salt. Never stored or returned in plain.
     - Sign-in returns a session token; the browser holds only
       the token.

   Roles:
     - maintenance : create/edit assets, PMs, parts, work orders
     - admin       : all of that, plus delete, import, and users
   ============================================================ */

import crypto from 'node:crypto';

const COLLECTIONS = ['assets', 'pms', 'parts', 'wos'];
const ROLES = ['maintenance', 'admin'];
const SESSION_DAYS = 30;
const PBKDF2_ROUNDS = 210000;

/* ---------- driver ---------- */
let _neon = null;
async function getNeon() {
  if (_neon) return _neon;
  try {
    const mod = await import('@neondatabase/serverless');
    _neon = mod.neon;
    return _neon;
  } catch (e) {
    const err = new Error(
      'The database driver could not be loaded. Check that "@neondatabase/serverless" is in ' +
      'dependencies in the ROOT package.json, and that there is no package.json inside api/. (' + e.message + ')');
    err.code = 'NO_DRIVER';
    throw err;
  }
}

async function connect() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    const err = new Error('DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.');
    err.code = 'NO_URL';
    throw err;
  }
  /* channel_binding is meaningless over Neon's HTTP driver and can trip it up. */
  const url = raw.replace(/([?&])channel_binding=[^&]*/i, '$1').replace(/[?&]$/, '');
  const neon = await getNeon();
  return neon(url);
}

/* ---------- passwords ---------- */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), s, PBKDF2_ROUNDS, 32, 'sha256').toString('hex');
  return { salt: s, hash };
}
function passwordMatches(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(String(expectedHash || ''), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
const newToken = () => crypto.randomBytes(32).toString('hex');

/* ---------- schema ---------- */
let ready = false;
async function ensureSchema(sql) {
  if (ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS records (
      collection  TEXT        NOT NULL,
      id          TEXT        NOT NULL,
      data        JSONB       NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by  TEXT,
      deleted     BOOLEAN     NOT NULL DEFAULT false,
      PRIMARY KEY (collection, id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value JSONB NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      username    TEXT PRIMARY KEY,
      full_name   TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'maintenance',
      salt        TEXT NOT NULL,
      hash        TEXT NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true,
      must_change BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login  TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS records_updated_idx ON records (updated_at DESC)`;
  ready = true;
}

async function ensureFoundingAdmin(sql) {
  const count = await sql`SELECT COUNT(*)::int AS n FROM users`;
  if (count[0].n > 0) return false;
  const user = String(process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD;
  if (!pass) return false;
  const name = process.env.ADMIN_NAME || 'Administrator';
  const { salt, hash } = hashPassword(pass);
  await sql`
    INSERT INTO users (username, full_name, role, salt, hash, active, must_change)
    VALUES (${user}, ${name}, 'admin', ${salt}, ${hash}, true, false)
    ON CONFLICT (username) DO NOTHING`;
  return true;
}

/* ---------- session ---------- */
async function currentUser(sql, req) {
  const token = req.headers['x-session'] || '';
  if (!token) return null;
  const rows = await sql`
    SELECT s.username, s.expires_at, u.full_name, u.role, u.active
    FROM sessions s JOIN users u ON u.username = s.username
    WHERE s.token = ${String(token)}`;
  if (!rows.length) return null;
  const r = rows[0];
  if (!r.active) return null;
  if (new Date(r.expires_at) < new Date()) {
    await sql`DELETE FROM sessions WHERE token = ${String(token)}`;
    return null;
  }
  return { username: r.username, name: r.full_name, role: r.role };
}

const isAdmin = u => u && u.role === 'admin';

async function revision(sql) {
  const r = await sql`SELECT COALESCE(MAX(updated_at)::text,'0') AS rev FROM records`;
  return r[0].rev;
}

async function readAll(sql) {
  const rows = await sql`
    SELECT collection, id, data, updated_by, updated_at
    FROM records WHERE deleted = false ORDER BY collection, id`;
  const out = { assets: [], pms: [], parts: [], wos: [] };
  rows.forEach(r => {
    /* updated_by comes from the session, so it cannot be spoofed. */
    if (out[r.collection]) out[r.collection].push(Object.assign({}, r.data, {
      id: r.id,
      updatedBy: r.updated_by || r.data.updatedBy || '',
      updatedAt: r.updated_at || r.data.updatedAt
    }));
  });
  const s = await sql`SELECT value FROM settings WHERE key = 'meta'`;
  out.meta = s.length ? s[0].value : { site: 'IAC Cottondale, AL' };
  out.rev = await revision(sql);
  return out;
}

function cleanRecord(rec) {
  const copy = Object.assign({}, rec);
  delete copy.id;
  return copy;
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  /* Unauthenticated health check — reports what is configured, never values. */
  if (req.method === 'GET' && req.query && req.query.diag) {
    const out = {
      ok: true, node: process.version,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasAdminUsername: !!process.env.ADMIN_USERNAME,
      hasAdminPassword: !!process.env.ADMIN_PASSWORD,
      driverLoads: false, databaseReachable: false, tablesReady: false, userCount: null
    };
    try {
      await getNeon();
      out.driverLoads = true;
      const sql = await connect();
      const ping = await sql`SELECT 1 AS ok`;
      out.databaseReachable = ping.length === 1;
      await ensureSchema(sql);
      out.tablesReady = true;
      await ensureFoundingAdmin(sql);
      const c = await sql`SELECT COUNT(*)::int AS n FROM users`;
      out.userCount = c[0].n;
    } catch (e) {
      out.ok = false;
      out.error = e.message;
      out.errorCode = e.code || null;
    }
    return res.status(200).json(out);
  }

  let sql;
  try {
    sql = await connect();
    await ensureSchema(sql);
    await ensureFoundingAdmin(sql);
  } catch (e) {
    return res.status(500).json({ error: e.message, code: e.code || 'SETUP' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

  try {
    /* ===== public: sign in ===== */
    if (req.method === 'POST' && body.op === 'login') {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
      const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
      const fail = () => res.status(401).json({ error: 'Wrong username or password' });
      if (!rows.length) return fail();
      const u = rows[0];
      if (!u.active) return res.status(403).json({ error: 'That account has been deactivated' });
      if (!passwordMatches(password, u.salt, u.hash)) return fail();

      const token = newToken();
      const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
      await sql`INSERT INTO sessions (token, username, expires_at) VALUES (${token}, ${username}, ${expires})`;
      await sql`UPDATE users SET last_login = now() WHERE username = ${username}`;
      await sql`DELETE FROM sessions WHERE expires_at < now()`;
      return res.status(200).json({
        ok: true, token,
        user: { username: u.username, name: u.full_name, role: u.role, mustChange: u.must_change }
      });
    }

    const me = await currentUser(sql, req);
    if (!me) return res.status(401).json({ error: 'Please sign in' });

    if (req.method === 'GET') {
      if (req.query.rev) return res.status(200).json({ rev: await revision(sql) });
      if (req.query.me) return res.status(200).json({ user: me });

      /* People list for assignment dropdowns. Any signed-in user may read it
         — a technician has to be able to assign work to a colleague. Returns
         only names and roles: no salts, hashes, or login history. */
      if (req.query.people) {
        const rows = await sql`
          SELECT username, full_name, role FROM users WHERE active = true ORDER BY full_name`;
        return res.status(200).json({ people: rows });
      }

      /* Full account list, including inactive and last-login. Admins only. */
      if (req.query.users) {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Admins only' });
        const rows = await sql`
          SELECT username, full_name, role, active, created_at, last_login
          FROM users ORDER BY full_name`;
        return res.status(200).json({ users: rows });
      }

      const data = await readAll(sql);
      data.user = me;
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const { op } = body;
      const who = me.name;

      if (op === 'logout') {
        const token = req.headers['x-session'] || '';
        await sql`DELETE FROM sessions WHERE token = ${String(token)}`;
        return res.status(200).json({ ok: true });
      }

      if (op === 'changePassword') {
        const current = String(body.current || '');
        const next = String(body.next || '');
        if (next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
        const rows = await sql`SELECT * FROM users WHERE username = ${me.username}`;
        const u = rows[0];
        if (!passwordMatches(current, u.salt, u.hash))
          return res.status(401).json({ error: 'Your current password is not correct' });
        const { salt, hash } = hashPassword(next);
        await sql`UPDATE users SET salt = ${salt}, hash = ${hash}, must_change = false WHERE username = ${me.username}`;
        const token = req.headers['x-session'] || '';
        await sql`DELETE FROM sessions WHERE username = ${me.username} AND token <> ${String(token)}`;
        return res.status(200).json({ ok: true });
      }

      if (op === 'upsert') {
        const { collection, record } = body;
        if (!COLLECTIONS.includes(collection)) return res.status(400).json({ error: 'Unknown collection' });
        if (!record || !record.id) return res.status(400).json({ error: 'Record needs an id' });
        await sql`
          INSERT INTO records (collection, id, data, updated_at, updated_by, deleted)
          VALUES (${collection}, ${String(record.id)}, ${JSON.stringify(cleanRecord(record))}, now(), ${who}, false)
          ON CONFLICT (collection, id) DO UPDATE
            SET data = records.data || EXCLUDED.data,
                updated_at = now(), updated_by = EXCLUDED.updated_by, deleted = false`;
        return res.status(200).json({ ok: true, rev: await revision(sql) });
      }

      if (op === 'remove') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Only an admin can delete records' });
        const { collection, id } = body;
        if (!COLLECTIONS.includes(collection)) return res.status(400).json({ error: 'Unknown collection' });
        await sql`
          UPDATE records SET deleted = true, updated_at = now(), updated_by = ${who}
          WHERE collection = ${collection} AND id = ${String(id)}`;
        return res.status(200).json({ ok: true, rev: await revision(sql) });
      }

      if (op === 'bulk') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Only an admin can import data' });
        const { collection, records } = body;
        if (!COLLECTIONS.includes(collection)) return res.status(400).json({ error: 'Unknown collection' });
        const list = Array.isArray(records) ? records.filter(r => r && r.id) : [];
        for (const record of list) {
          await sql`
            INSERT INTO records (collection, id, data, updated_at, updated_by, deleted)
            VALUES (${collection}, ${String(record.id)}, ${JSON.stringify(cleanRecord(record))}, now(), ${who}, false)
            ON CONFLICT (collection, id) DO UPDATE
              SET data = records.data || EXCLUDED.data,
                  updated_at = now(), updated_by = EXCLUDED.updated_by, deleted = false`;
        }
        return res.status(200).json({ ok: true, count: list.length, rev: await revision(sql) });
      }

      if (op === 'meta') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Only an admin can change site settings' });
        await sql`
          INSERT INTO settings (key, value) VALUES ('meta', ${JSON.stringify(body.meta || {})})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        return res.status(200).json({ ok: true });
      }

      if (op === 'seed') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Only an admin can migrate data' });
        const payload = body.payload || {};
        let total = 0;
        for (const c of COLLECTIONS) {
          for (const record of (payload[c] || []).filter(r => r && r.id)) {
            await sql`
              INSERT INTO records (collection, id, data, updated_at, updated_by, deleted)
              VALUES (${c}, ${String(record.id)}, ${JSON.stringify(cleanRecord(record))}, now(), ${who}, false)
              ON CONFLICT (collection, id) DO UPDATE
                SET data = records.data || EXCLUDED.data,
                    updated_at = now(), updated_by = EXCLUDED.updated_by, deleted = false`;
            total++;
          }
        }
        if (payload.meta) {
          await sql`
            INSERT INTO settings (key, value) VALUES ('meta', ${JSON.stringify(payload.meta)})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
        }
        return res.status(200).json({ ok: true, count: total, rev: await revision(sql) });
      }

      if (op === 'addUser') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Admins only' });
        const username = String(body.username || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        const role = ROLES.includes(body.role) ? body.role : 'maintenance';
        const password = String(body.password || '');
        if (!/^[a-z0-9._-]{3,32}$/.test(username))
          return res.status(400).json({ error: 'Username must be 3–32 characters, letters/numbers/dot/dash only' });
        if (!name) return res.status(400).json({ error: 'Full name is required' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
        const exists = await sql`SELECT 1 FROM users WHERE username = ${username}`;
        if (exists.length) return res.status(409).json({ error: 'That username is already taken' });
        const { salt, hash } = hashPassword(password);
        await sql`
          INSERT INTO users (username, full_name, role, salt, hash, active, must_change)
          VALUES (${username}, ${name}, ${role}, ${salt}, ${hash}, true, true)`;
        return res.status(200).json({ ok: true });
      }

      if (op === 'updateUser') {
        if (!isAdmin(me)) return res.status(403).json({ error: 'Admins only' });
        const username = String(body.username || '').trim().toLowerCase();
        const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
        if (!rows.length) return res.status(404).json({ error: 'No such user' });

        if (body.name !== undefined)
          await sql`UPDATE users SET full_name = ${String(body.name).trim()} WHERE username = ${username}`;

        if (body.role !== undefined && ROLES.includes(body.role)) {
          /* Never let the last admin be demoted — it would lock everyone out. */
          if (rows[0].role === 'admin' && body.role !== 'admin') {
            const admins = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active = true`;
            if (admins[0].n <= 1) return res.status(400).json({ error: 'This is the only admin — promote someone else first' });
          }
          await sql`UPDATE users SET role = ${body.role} WHERE username = ${username}`;
        }
        if (body.active !== undefined) {
          if (rows[0].role === 'admin' && body.active === false) {
            const admins = await sql`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active = true`;
            if (admins[0].n <= 1) return res.status(400).json({ error: 'This is the only admin — promote someone else first' });
          }
          await sql`UPDATE users SET active = ${!!body.active} WHERE username = ${username}`;
          if (!body.active) await sql`DELETE FROM sessions WHERE username = ${username}`;
        }
        if (body.password) {
          if (String(body.password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
          const { salt, hash } = hashPassword(String(body.password));
          await sql`UPDATE users SET salt = ${salt}, hash = ${hash}, must_change = true WHERE username = ${username}`;
          await sql`DELETE FROM sessions WHERE username = ${username}`;
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown operation' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (e) {
    return res.status(500).json({ error: e.message || 'Database error' });
  }
}
