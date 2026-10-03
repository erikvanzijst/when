'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const og = require('./og');

const PORT = Number(process.env.PORT || 8080);
const DEV_AUTH = process.env.DEV_AUTH === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIVE_POLL_MS = 1000;
const HEARTBEAT_MS = 25000;
const MAX_OPTIONS = 60;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 8,
  idleTimeoutMillis: 30000,
});
pool.on('error', (err) => console.error('pg pool error:', err.message));

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         text PRIMARY KEY,
      name       text NOT NULL DEFAULT '',
      email      text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS polls (
      id              bigserial PRIMARY KEY,
      slug            text NOT NULL UNIQUE,
      title           text NOT NULL,
      description     text NOT NULL DEFAULT '',
      multi           boolean NOT NULL,
      tz              text NOT NULL,
      owner_id        text NOT NULL REFERENCES users(id),
      closed          boolean NOT NULL DEFAULT false,
      final_option_id bigint,
      version         bigint NOT NULL DEFAULT 1,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS polls_owner_idx ON polls (owner_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS options (
      id         bigserial PRIMARY KEY,
      poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      day        date NOT NULL,
      start_time time,
      end_time   time
    );
    CREATE INDEX IF NOT EXISTS options_poll_idx ON options (poll_id);
    CREATE TABLE IF NOT EXISTS votes (
      option_id  bigint NOT NULL REFERENCES options(id) ON DELETE CASCADE,
      poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id    text NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (option_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS votes_poll_idx ON votes (poll_id);
    CREATE INDEX IF NOT EXISTS votes_user_idx ON votes (user_id);
  `);
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const RESERVED_SLUGS = new Set([
  'api', 'healthz', 'static', 'assets', 'new', 'me', 'dev', 'login', 'logout',
  'favicon.ico', 'robots.txt', 'about', 'admin', 'settings', 'og',
]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function slugify(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function validSlug(slug) {
  return SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function decodeName(raw) {
  if (!raw) return '';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Identity comes from the Freepod auth proxy, which strips any client-sent copy.
// DEV_AUTH=1 (local only) swaps in a cookie-based fake so two browsers can act
// as two users.
function getIdentity(req) {
  if (DEV_AUTH) {
    const c = parseCookies(req.headers.cookie).dev_user;
    if (c) {
      const [id, name, email] = c.split('|');
      return { id: `dev:${id}`, name: name || id, email: email || `${id}@example.com` };
    }
  }
  const id = req.headers['x-freepod-user'];
  if (!id) return null;
  return {
    id: String(id),
    name: decodeName(req.headers['x-freepod-name']) || String(req.headers['x-freepod-email'] || '').split('@')[0] || 'Someone',
    email: String(req.headers['x-freepod-email'] || ''),
  };
}

async function upsertUser(db, user) {
  await db.query(
    `INSERT INTO users (id, name, email) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = now()
     WHERE users.name <> EXCLUDED.name OR users.email <> EXCLUDED.email`,
    [user.id, user.name, user.email],
  );
}

// Gravatar identifies avatars by the SHA-256 of the normalized address. Only
// this hash leaves the server; email addresses are never sent to clients.
function gravatarHash(email) {
  const e = String(email || '').trim().toLowerCase();
  return e ? crypto.createHash('sha256').update(e).digest('hex') : null;
}

function requireUser(req) {
  const user = getIdentity(req);
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return user;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

async function readJson(req) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'Expected application/json.');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Request too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

function cleanText(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanDescription(v) {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000);
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validDay(day) {
  if (!DAY_RE.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

// Normalizes [{id?, day, start?, end?}] into a deduplicated, sorted list.
function parseOptions(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'Pick at least one date.');
  if (raw.length > MAX_OPTIONS) throw new HttpError(400, `At most ${MAX_OPTIONS} options.`);
  const seen = new Set();
  const out = [];
  for (const o of raw) {
    const day = String(o?.day || '');
    const start = o?.start ? String(o.start) : null;
    const end = o?.end ? String(o.end) : null;
    if (!validDay(day)) throw new HttpError(400, `Invalid date: ${day || '(empty)'}`);
    if (start && !TIME_RE.test(start)) throw new HttpError(400, `Invalid time: ${start}`);
    if (end && !TIME_RE.test(end)) throw new HttpError(400, `Invalid time: ${end}`);
    if (end && !start) throw new HttpError(400, 'An end time needs a start time.');
    if (end && end === start) throw new HttpError(400, 'Start and end time are the same.');
    const key = `${day}|${start}|${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = o?.id != null && /^\d+$/.test(String(o.id)) ? String(o.id) : null;
    out.push({ id, day, start, end });
  }
  out.sort((a, b) => (a.day + (a.start || '') + (a.end || '')).localeCompare(b.day + (b.start || '') + (b.end || '')));
  return out;
}

// ---------------------------------------------------------------------------
// Poll state
// ---------------------------------------------------------------------------

async function loadPollState(db, where, value) {
  const { rows: [p] } = await db.query(
    `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM polls p JOIN users u ON u.id = p.owner_id
      WHERE p.${where} = $1`,
    [value],
  );
  if (!p) return null;
  const [{ rows: options }, { rows: votes }] = await Promise.all([
    db.query(
      `SELECT id, to_char(day, 'YYYY-MM-DD') AS day,
              to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
         FROM options WHERE poll_id = $1
        ORDER BY day, start_time NULLS FIRST, end_time NULLS FIRST, id`,
      [p.id],
    ),
    db.query(
      `SELECT v.option_id, v.user_id, u.name, u.email
         FROM votes v JOIN users u ON u.id = v.user_id
        WHERE v.poll_id = $1
        ORDER BY v.created_at, v.user_id`,
      [p.id],
    ),
  ]);
  const byOption = new Map(options.map((o) => [o.id, []]));
  const participants = new Map();
  for (const v of votes) {
    const person = { id: v.user_id, name: v.name, avatar: gravatarHash(v.email) };
    byOption.get(v.option_id)?.push(person);
    participants.set(v.user_id, person);
  }
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    multi: p.multi,
    tz: p.tz,
    closed: p.closed,
    finalOptionId: p.final_option_id,
    owner: { id: p.owner_id, name: p.owner_name, avatar: gravatarHash(p.owner_email) },
    createdAt: p.created_at,
    version: Number(p.version),
    participants: [...participants.values()],
    options: options.map((o) => ({ ...o, voters: byOption.get(o.id) })),
  };
}

async function loadPollForOwner(db, slug, user) {
  const { rows: [p] } = await db.query('SELECT * FROM polls WHERE slug = $1 FOR UPDATE', [slug]);
  if (!p) throw new HttpError(404, 'Datepicker not found.');
  if (p.owner_id !== user.id) throw new HttpError(403, 'Only the creator can do that.');
  return p;
}

async function bumpVersion(db, pollId) {
  await db.query('UPDATE polls SET version = version + 1, updated_at = now() WHERE id = $1', [pollId]);
}

// ---------------------------------------------------------------------------
// Live updates (SSE)
//
// Freepod's pooler does not support LISTEN/NOTIFY, so each instance polls the
// version column of the polls that currently have viewers attached. Writes on
// this instance trigger an immediate check, so the common case is instant and
// the worst case (a write landing on another replica) is about a second.
// ---------------------------------------------------------------------------

const watched = new Map(); // pollId -> { slug, version, clients: Set<res> }

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function checkPolls(ids) {
  if (ids.length === 0) return;
  const { rows } = await pool.query('SELECT id, version FROM polls WHERE id = ANY($1::bigint[])', [ids]);
  const versions = new Map(rows.map((r) => [r.id, Number(r.version)]));
  for (const id of ids) {
    const w = watched.get(id);
    if (!w) continue;
    const v = versions.get(id);
    if (v === undefined) {
      for (const res of w.clients) { sseSend(res, 'deleted', {}); res.end(); }
      watched.delete(id);
    } else if (v !== w.version) {
      w.version = v;
      const state = await loadPollState(pool, 'id', id);
      if (!state) continue;
      w.version = state.version;
      for (const res of w.clients) sseSend(res, 'state', state);
    }
  }
}

let checking = false;
setInterval(async () => {
  if (checking || watched.size === 0) return;
  checking = true;
  try {
    await checkPolls([...watched.keys()]);
  } catch (err) {
    console.error('live check failed:', err.message);
  } finally {
    checking = false;
  }
}, LIVE_POLL_MS).unref();

setInterval(() => {
  for (const w of watched.values()) for (const res of w.clients) res.write(': ping\n\n');
}, HEARTBEAT_MS).unref();

function notifyChanged(pollId) {
  if (!watched.has(pollId)) return;
  checkPolls([pollId]).catch((err) => console.error('notify failed:', err.message));
}

async function handleEvents(req, res, slug) {
  const state = await loadPollState(pool, 'slug', slug);
  if (!state) throw new HttpError(404, 'Datepicker not found.');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  sseSend(res, 'state', state);
  let w = watched.get(state.id);
  if (!w) {
    w = { slug, version: state.version, clients: new Set() };
    watched.set(state.id, w);
  }
  w.clients.add(res);
  req.on('close', () => {
    w.clients.delete(res);
    if (w.clients.size === 0 && watched.get(state.id) === w) watched.delete(state.id);
  });
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

async function slugAvailable(db, slug) {
  if (!validSlug(slug)) return false;
  const { rowCount } = await db.query('SELECT 1 FROM polls WHERE slug = $1', [slug]);
  return rowCount === 0;
}

async function suggestSlug(db, base) {
  base = slugify(base) || 'datepicker';
  if (RESERVED_SLUGS.has(base)) base = `${base}-poll`;
  const { rows } = await db.query(
    `SELECT slug FROM polls WHERE slug = $1 OR slug LIKE $2`,
    [base, `${base.replace(/[%_]/g, '')}-%`],
  );
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base.slice(0, 60 - String(i).length - 1)}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 50)}-${Date.now().toString(36)}`;
}

const api = {
  async me(req, res) {
    const user = getIdentity(req);
    if (user) await upsertUser(pool, user);
    sendJson(res, 200, {
      user: user ? { id: user.id, name: user.name, email: user.email, avatar: gravatarHash(user.email) } : null,
      loginUrl: DEV_AUTH ? '/dev/login' : '/.freepod/auth/login',
      logoutUrl: DEV_AUTH ? '/dev/logout' : '/.freepod/auth/logout',
    });
  },

  async slugCheck(req, res, url) {
    const slug = String(url.searchParams.get('slug') || '');
    const title = String(url.searchParams.get('title') || '');
    const available = slug ? await slugAvailable(pool, slug) : false;
    const suggestion = await suggestSlug(pool, slug || title);
    sendJson(res, 200, {
      slug,
      valid: validSlug(slug),
      available,
      suggestion,
    });
  },

  async mine(req, res) {
    const user = requireUser(req);
    const { rows } = await pool.query(
      `SELECT p.slug, p.title, p.multi, p.closed, p.final_option_id IS NOT NULL AS decided,
              p.created_at, p.updated_at, p.owner_id = $1 AS owned, u.name AS owner_name,
              (SELECT count(*) FROM options o WHERE o.poll_id = p.id)::int AS option_count,
              (SELECT count(DISTINCT v.user_id) FROM votes v WHERE v.poll_id = p.id)::int AS participant_count,
              EXISTS (SELECT 1 FROM votes v WHERE v.poll_id = p.id AND v.user_id = $1) AS voted,
              (SELECT min(o.day) FROM options o WHERE o.poll_id = p.id)::text AS first_day,
              (SELECT max(o.day) FROM options o WHERE o.poll_id = p.id)::text AS last_day
         FROM polls p JOIN users u ON u.id = p.owner_id
        WHERE p.owner_id = $1
           OR p.id IN (SELECT poll_id FROM votes WHERE user_id = $1)
        ORDER BY p.updated_at DESC
        LIMIT 100`,
      [user.id],
    );
    sendJson(res, 200, {
      polls: rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        multi: r.multi,
        closed: r.closed,
        decided: r.decided,
        owned: r.owned,
        ownerName: r.owner_name,
        voted: r.voted,
        optionCount: r.option_count,
        participantCount: r.participant_count,
        firstDay: r.first_day,
        lastDay: r.last_day,
        updatedAt: r.updated_at,
      })),
    });
  },

  async create(req, res) {
    const user = requireUser(req);
    const body = await readJson(req);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, 'Give your datepicker a name.');
    const slug = String(body.slug || slugify(title));
    if (RESERVED_SLUGS.has(slug)) throw new HttpError(400, 'That link is reserved. Please pick another.');
    if (!validSlug(slug)) {
      throw new HttpError(400, 'Links may only use lowercase letters, digits and dashes.');
    }
    const tz = String(body.tz || 'UTC');
    if (!validTimeZone(tz)) throw new HttpError(400, 'Unknown time zone.');
    const options = parseOptions(body.options);
    const description = cleanDescription(body.description);

    const created = await tx(async (db) => {
      await upsertUser(db, user);
      const { rows: [p] } = await db.query(
        `INSERT INTO polls (slug, title, description, multi, tz, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id, slug`,
        [slug, title, description, !!body.multi, tz, user.id],
      );
      if (!p) return null;
      for (const o of options) {
        await db.query(
          'INSERT INTO options (poll_id, day, start_time, end_time) VALUES ($1, $2, $3, $4)',
          [p.id, o.day, o.start, o.end],
        );
      }
      return p;
    });
    if (!created) {
      const suggestion = await suggestSlug(pool, slug);
      sendJson(res, 409, { error: `“${slug}” is already taken.`, suggestion });
      return;
    }
    console.log(`poll created: ${created.slug} by ${user.id}`);
    sendJson(res, 201, { slug: created.slug });
  },

  async get(req, res, url, slug) {
    const state = await loadPollState(pool, 'slug', slug);
    if (!state) throw new HttpError(404, 'Datepicker not found.');
    sendJson(res, 200, state);
  },

  async vote(req, res, url, slug) {
    const user = requireUser(req);
    const body = await readJson(req);
    const ids = Array.isArray(body.optionIds) ? [...new Set(body.optionIds.map(String))] : null;
    if (!ids || ids.some((id) => !/^\d+$/.test(id))) throw new HttpError(400, 'Invalid selection.');

    const pollId = await tx(async (db) => {
      await upsertUser(db, user);
      const { rows: [p] } = await db.query('SELECT id, multi, closed FROM polls WHERE slug = $1 FOR UPDATE', [slug]);
      if (!p) throw new HttpError(404, 'Datepicker not found.');
      if (p.closed) throw new HttpError(409, 'Voting is closed.');
      if (!p.multi && ids.length > 1) throw new HttpError(400, 'This datepicker allows only one choice.');
      if (ids.length) {
        const { rowCount } = await db.query(
          'SELECT 1 FROM options WHERE poll_id = $1 AND id = ANY($2::bigint[])',
          [p.id, ids],
        );
        if (rowCount !== ids.length) throw new HttpError(409, 'One of those options no longer exists.');
      }
      await db.query(
        'DELETE FROM votes WHERE poll_id = $1 AND user_id = $2 AND NOT (option_id = ANY($3::bigint[]))',
        [p.id, user.id, ids],
      );
      if (ids.length) {
        await db.query(
          `INSERT INTO votes (option_id, poll_id, user_id)
           SELECT unnest($3::bigint[]), $1, $2
           ON CONFLICT DO NOTHING`,
          [p.id, user.id, ids],
        );
      }
      await bumpVersion(db, p.id);
      return p.id;
    });
    notifyChanged(pollId);
    const state = await loadPollState(pool, 'id', pollId);
    sendJson(res, 200, state);
  },

  async update(req, res, url, slug) {
    const user = requireUser(req);
    const body = await readJson(req);

    const pollId = await tx(async (db) => {
      const p = await loadPollForOwner(db, slug, user);
      const sets = [];
      const vals = [];
      const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

      if (body.title !== undefined) {
        const title = cleanText(body.title, 120);
        if (!title) throw new HttpError(400, 'The name cannot be empty.');
        set('title', title);
      }
      if (body.description !== undefined) set('description', cleanDescription(body.description));
      if (body.tz !== undefined) {
        if (!validTimeZone(String(body.tz))) throw new HttpError(400, 'Unknown time zone.');
        set('tz', String(body.tz));
      }
      if (body.closed !== undefined) set('closed', !!body.closed);

      if (body.options !== undefined) {
        const options = parseOptions(body.options);
        const { rows: existing } = await db.query('SELECT id FROM options WHERE poll_id = $1', [p.id]);
        const existingIds = new Set(existing.map((r) => r.id));
        const keep = new Set(options.filter((o) => o.id && existingIds.has(o.id)).map((o) => o.id));
        const drop = [...existingIds].filter((id) => !keep.has(id));
        if (drop.length) await db.query('DELETE FROM options WHERE id = ANY($1::bigint[])', [drop]);
        for (const o of options) {
          if (o.id && keep.has(o.id)) {
            await db.query(
              'UPDATE options SET day = $2, start_time = $3, end_time = $4 WHERE id = $1',
              [o.id, o.day, o.start, o.end],
            );
          } else {
            await db.query(
              'INSERT INTO options (poll_id, day, start_time, end_time) VALUES ($1, $2, $3, $4)',
              [p.id, o.day, o.start, o.end],
            );
          }
        }
        if (p.final_option_id && drop.includes(p.final_option_id) && body.finalOptionId === undefined) {
          set('final_option_id', null);
        }
      }

      if (body.multi !== undefined && !!body.multi !== p.multi) {
        if (!body.multi) {
          const { rowCount } = await db.query(
            'SELECT 1 FROM votes WHERE poll_id = $1 GROUP BY user_id HAVING count(*) > 1 LIMIT 1',
            [p.id],
          );
          if (rowCount) throw new HttpError(409, 'Some people already picked several options, so this can no longer be single-choice.');
        }
        set('multi', !!body.multi);
      }

      if (body.finalOptionId !== undefined) {
        if (body.finalOptionId === null) {
          set('final_option_id', null);
        } else {
          const fid = String(body.finalOptionId);
          const { rowCount } = await db.query('SELECT 1 FROM options WHERE id = $1 AND poll_id = $2', [fid, p.id]);
          if (!rowCount) throw new HttpError(400, 'That option does not belong to this datepicker.');
          set('final_option_id', fid);
        }
      }

      if (sets.length) {
        vals.push(p.id);
        await db.query(`UPDATE polls SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      }
      await bumpVersion(db, p.id);
      return p.id;
    });
    notifyChanged(pollId);
    sendJson(res, 200, await loadPollState(pool, 'id', pollId));
  },

  async remove(req, res, url, slug) {
    const user = requireUser(req);
    const pollId = await tx(async (db) => {
      const p = await loadPollForOwner(db, slug, user);
      await db.query('DELETE FROM polls WHERE id = $1', [p.id]);
      return p.id;
    });
    console.log(`poll deleted: ${slug} by ${user.id}`);
    notifyChanged(pollId);
    sendJson(res, 200, { ok: true });
  },
};

// ---------------------------------------------------------------------------
// Static files & pages
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const templates = {};
function template(name) {
  if (!templates[name] || DEV_AUTH) {
    templates[name] = fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
  }
  return templates[name];
}

function serveStatic(req, res, pathname) {
  const rel = pathname.replace(/^\/static\//, '');
  const file = path.normalize(path.join(PUBLIC_DIR, 'static', rel));
  if (!file.startsWith(path.join(PUBLIC_DIR, 'static') + path.sep)) return false;
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': DEV_AUTH ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0];
  return `${proto}://${host}`;
}

function sendPage(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(html);
}

function renderPage(name, req, meta) {
  const origin = originOf(req);
  return template(name)
    .replaceAll('{{TITLE}}', escapeHtml(meta.title))
    .replaceAll('{{DESCRIPTION}}', escapeHtml(meta.description))
    .replaceAll('{{URL}}', escapeHtml(origin + meta.path))
    .replaceAll('{{IMAGE}}', escapeHtml(origin + meta.image))
    .replaceAll('{{IMAGE_ALT}}', escapeHtml(meta.imageAlt))
    .replaceAll('{{ORIGIN}}', escapeHtml(origin));
}

const SITE_DESCRIPTION = 'Pick a few dates, share one link, and see live which one works for everyone.';
const HOME_IMAGE = { image: '/og/home.png', imageAlt: 'When: find the date that works for everyone' };

function hostOf(req) {
  return new URL(originOf(req)).host;
}

async function ogImage(req, res, name) {
  let png;
  if (name === 'home') {
    png = await og.homeImage(hostOf(req));
  } else {
    const state = await loadPollState(pool, 'slug', name);
    if (!state) throw new HttpError(404, 'Not found.');
    png = await og.pollImage(state, hostOf(req));
  }
  res.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': png.length,
    'Cache-Control': 'public, max-age=300',
  });
  res.end(req.method === 'HEAD' ? undefined : png);
}

function formatRange(first, last) {
  const fmt = (d, opts) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  if (!first) return '';
  if (first === last) return fmt(first, { weekday: 'short', month: 'short', day: 'numeric' });
  const firstYear = first.slice(0, 4) !== last.slice(0, 4) ? 'numeric' : undefined;
  return `${fmt(first, { month: 'short', day: 'numeric', year: firstYear })} – ${fmt(last, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

async function pollPage(req, res, slug) {
  const { rows: [p] } = await pool.query(
    `SELECT p.title, p.description, p.version, u.name AS owner_name,
            (SELECT count(*) FROM options o WHERE o.poll_id = p.id)::int AS n,
            (SELECT min(day)::text FROM options o WHERE o.poll_id = p.id) AS first_day,
            (SELECT max(day)::text FROM options o WHERE o.poll_id = p.id) AS last_day
       FROM polls p JOIN users u ON u.id = p.owner_id WHERE p.slug = $1`,
    [slug],
  );
  if (!p) {
    return sendPage(res, 404, renderPage('poll.html', req, {
      title: 'Not found · When', description: SITE_DESCRIPTION, path: `/${slug}`, ...HOME_IMAGE,
    }));
  }
  const summary = p.description
    || `${p.owner_name} is looking for a date: ${p.n} option${p.n === 1 ? '' : 's'}, ${formatRange(p.first_day, p.last_day)}. Vote for the ones that work for you.`;
  sendPage(res, 200, renderPage('poll.html', req, {
    title: `${p.title} · When`,
    description: summary,
    path: `/${slug}`,
    // The version in the URL makes unfurlers refetch after votes change.
    image: `/og/${slug}.png?v=${p.version}`,
    imageAlt: `${p.title}: date options and live vote tallies`,
  }));
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/healthz') {
    await pool.query('SELECT 1');
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/')) {
    const parts = pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts[1] === 'me' && method === 'GET') return api.me(req, res);
    if (parts[1] === 'mine' && method === 'GET') return api.mine(req, res);
    if (parts[1] === 'slug-check' && method === 'GET') return api.slugCheck(req, res, url);
    if (parts[1] === 'polls') {
      if (parts.length === 2 && method === 'POST') return api.create(req, res);
      const slug = parts[2];
      if (slug && SLUG_RE.test(slug)) {
        if (parts.length === 3) {
          if (method === 'GET') return api.get(req, res, url, slug);
          if (method === 'PATCH') return api.update(req, res, url, slug);
          if (method === 'DELETE') return api.remove(req, res, url, slug);
        }
        if (parts.length === 4 && parts[3] === 'votes' && method === 'PUT') return api.vote(req, res, url, slug);
        if (parts.length === 4 && parts[3] === 'events' && method === 'GET') return handleEvents(req, res, slug);
      }
    }
    throw new HttpError(404, 'Not found.');
  }

  if (DEV_AUTH && pathname === '/dev/login') {
    const u = slugify(url.searchParams.get('u') || 'alice') || 'alice';
    const n = url.searchParams.get('n') || u[0].toUpperCase() + u.slice(1);
    const e = (url.searchParams.get('e') || '').replace(/\|/g, '');
    const rd = url.searchParams.get('rd') || '/';
    res.writeHead(302, {
      'Set-Cookie': `dev_user=${encodeURIComponent(`${u}|${n}|${e}`)}; Path=/; SameSite=Lax`,
      Location: rd.startsWith('/') ? rd : '/',
    });
    return res.end();
  }
  if (DEV_AUTH && pathname === '/dev/logout') {
    res.writeHead(302, { 'Set-Cookie': 'dev_user=; Path=/; Max-Age=0', Location: url.searchParams.get('rd') || '/' });
    return res.end();
  }

  if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

  if (pathname.startsWith('/static/') && serveStatic(req, res, pathname)) return;
  if (pathname === '/favicon.ico' || pathname === '/favicon.svg') {
    return serveStatic(req, res, '/static/favicon.svg') || sendPage(res, 404, '');
  }
  if (pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('User-agent: *\nAllow: /\n');
  }

  if (pathname === '/') {
    return sendPage(res, 200, renderPage('index.html', req, {
      title: 'When — find the date that works for everyone', description: SITE_DESCRIPTION, path: '/', ...HOME_IMAGE,
    }));
  }

  const ogMatch = /^\/og\/([a-z0-9-]+)\.png$/.exec(pathname);
  if (ogMatch) return ogImage(req, res, ogMatch[1]);

  const slug = pathname.slice(1).replace(/\/$/, '');
  if (SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug)) return pollPage(req, res, slug);

  sendPage(res, 404, renderPage('poll.html', req, { title: 'Not found · When', description: SITE_DESCRIPTION, path: pathname, ...HOME_IMAGE }));
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    if (err instanceof HttpError) {
      if (!res.headersSent) sendJson(res, err.status, { error: err.message });
      else res.end();
      return;
    }
    console.error(`${req.method} ${req.url} failed:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong. Please try again.' });
    else res.end();
  }
});
server.keepAliveTimeout = 65000;
server.requestTimeout = 0; // SSE streams are long-lived

migrate()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`when listening on 0.0.0.0:${PORT}${DEV_AUTH ? ' (DEV_AUTH)' : ''}`);
    });
  })
  .catch((err) => {
    console.error('migration failed:', err);
    process.exit(1);
  });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    for (const w of watched.values()) for (const r of w.clients) r.end();
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
