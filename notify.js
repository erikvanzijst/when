'use strict';

// Vote-notification emails.
//
// Freepod has no workers or schedulers, so pending notifications live in
// Postgres and this process sends them from an in-process ticker. Each vote
// change upserts one row per (poll, voter) whose due time slides forward with
// every further change (debounce), capped so a voter who keeps fiddling cannot
// postpone the email forever. Rows are claimed with FOR UPDATE SKIP LOCKED plus
// a lease, which is safe with several replicas and survives restarts.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { renderVoteEmail } = require('./emails');

function freepodHostname() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '.freepod.json'), 'utf8')).user_values.hostname;
  } catch {
    return null;
  }
}

const env = process.env;
const config = {
  transport: env.MAIL_TRANSPORT || 'smtp', // smtp | file | off
  smtpHost: env.SMTP_HOST || 'smtp.mailer.svc.cluster.local',
  smtpPort: Number(env.SMTP_PORT || 25),
  smtpSecure: env.SMTP_SECURE === '1', // implicit TLS (port 465)
  smtpUser: env.SMTP_USER || '',
  smtpPass: env.SMTP_PASS || '',
  from: env.MAIL_FROM || 'When <when@freepod.eu>',
  appUrl: (env.APP_URL || (freepodHostname() ? `https://${freepodHostname()}` : `http://localhost:${env.PORT || 8080}`)).replace(/\/$/, ''),
  debounceSeconds: Number(env.NOTIFY_DEBOUNCE_SECONDS || 60),
  maxDelaySeconds: Number(env.NOTIFY_MAX_DELAY_SECONDS || 300),
  tickMs: 10_000,
  maxAttempts: 5,
  outbox: path.join(__dirname, 'var', 'outbox'),
};

let pool;
let loadPollState;
let gravatarHash;
let secret;
let transporter;

// --- Schema --------------------------------------------------------------------

async function migrate(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poll_watchers (
      poll_id    bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      user_id    text NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (poll_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS vote_notifications (
      poll_id      bigint NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      voter_id     text NOT NULL REFERENCES users(id),
      baseline     bigint[] NOT NULL,
      first_change timestamptz NOT NULL DEFAULT now(),
      due_at       timestamptz NOT NULL,
      lease_until  timestamptz,
      attempts     int NOT NULL DEFAULT 0,
      PRIMARY KEY (poll_id, voter_id)
    );
    CREATE INDEX IF NOT EXISTS vote_notifications_due_idx ON vote_notifications (due_at);
  `);

  // One-time: creators of polls that predate notifications start out watching.
  const { rowCount } = await db.query(
    `INSERT INTO app_meta (key, value) VALUES ('backfill_owner_watchers', now()::text) ON CONFLICT DO NOTHING`,
  );
  if (rowCount) {
    await db.query('INSERT INTO poll_watchers (poll_id, user_id) SELECT id, owner_id FROM polls ON CONFLICT DO NOTHING');
  }

  // Unsubscribe links are HMAC-signed. The key comes from UNSUBSCRIBE_SECRET or
  // is generated once and kept in the database, so links survive restarts.
  if (env.UNSUBSCRIBE_SECRET) {
    secret = env.UNSUBSCRIBE_SECRET;
  } else {
    await db.query(
      `INSERT INTO app_meta (key, value) VALUES ('unsubscribe_secret', $1) ON CONFLICT DO NOTHING`,
      [crypto.randomBytes(32).toString('hex')],
    );
    const { rows: [r] } = await db.query(`SELECT value FROM app_meta WHERE key = 'unsubscribe_secret'`);
    secret = r.value;
  }
}

// --- Watchers ------------------------------------------------------------------

async function isWatching(db, pollId, userId) {
  const { rowCount } = await db.query('SELECT 1 FROM poll_watchers WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
  return rowCount > 0;
}

async function setWatching(db, pollId, userId, watching) {
  if (watching) {
    await db.query('INSERT INTO poll_watchers (poll_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [pollId, userId]);
  } else {
    await db.query('DELETE FROM poll_watchers WHERE poll_id = $1 AND user_id = $2', [pollId, userId]);
  }
}

// --- Recording changes ---------------------------------------------------------

// Called inside the vote transaction with the voter's selection before and
// after. The baseline is only set when the row is created, so a burst of
// changes is summarized against where the voter started.
async function recordChange(db, pollId, voterId, before, after) {
  const same = before.length === after.length && before.every((id) => after.includes(id));
  if (same) return;
  await db.query(
    `INSERT INTO vote_notifications (poll_id, voter_id, baseline, due_at)
     VALUES ($1, $2, $3::bigint[], now() + make_interval(secs => $4))
     ON CONFLICT (poll_id, voter_id) DO UPDATE
       SET due_at = least(now() + make_interval(secs => $4),
                          vote_notifications.first_change + make_interval(secs => $5))`,
    [pollId, voterId, before, config.debounceSeconds, config.maxDelaySeconds],
  );
}

// --- Unsubscribe tokens --------------------------------------------------------

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 32);

function unsubscribeToken(pollId, userId) {
  const payload = `${pollId}.${b64(userId)}`;
  return `${payload}.${sign(payload)}`;
}

function parseUnsubscribeToken(token) {
  const m = /^(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{32})$/.exec(String(token));
  if (!m) return null;
  const expected = sign(`${m[1]}.${m[2]}`);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(m[3]))) return null;
  return { pollId: m[1], userId: Buffer.from(m[2], 'base64url').toString('utf8') };
}

// --- Sending -------------------------------------------------------------------

function makeTransport() {
  if (config.transport === 'smtp') {
    return nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
      name: new URL(config.appUrl).hostname, // EHLO name
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  if (config.transport === 'file') {
    // Local development: write each message to var/outbox/ instead of sending.
    return {
      async sendMail(msg) {
        fs.mkdirSync(config.outbox, { recursive: true });
        const base = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(msg.to.address).replace(/[^\w.@-]/g, '_')}`;
        fs.writeFileSync(path.join(config.outbox, `${base}.html`), msg.html);
        fs.writeFileSync(path.join(config.outbox, `${base}.json`), JSON.stringify({ ...msg, html: undefined }, null, 2));
        return { messageId: base };
      },
    };
  }
  return null;
}

async function sendOne(watcher, poll, changes) {
  const pollUrl = `${config.appUrl}/${poll.slug}`;
  const unsubscribeUrl = `${config.appUrl}/unsubscribe/${unsubscribeToken(poll.id, watcher.id)}`;
  const email = renderVoteEmail({ poll, changes, pollUrl, unsubscribeUrl, baseUrl: config.appUrl });
  await transporter.sendMail({
    from: config.from,
    to: { name: watcher.name, address: watcher.email },
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    },
  });
}

async function processPoll(pollId, claims) {
  const poll = await loadPollState(pool, 'id', pollId);
  if (!poll) return; // deleted; rows went with it (ON DELETE CASCADE)

  const optionIds = new Set(poll.options.map((o) => String(o.id)));
  const { rows: voters } = await pool.query(
    'SELECT id, name, email FROM users WHERE id = ANY($1::text[])',
    [claims.map((c) => c.voter_id)],
  );
  const voterById = new Map(voters.map((u) => [u.id, { id: u.id, name: u.name, avatar: gravatarHash(u.email) }]));

  const current = new Map();
  const changes = [];
  for (const c of claims) {
    const after = poll.options.filter((o) => o.voters.some((v) => v.id === c.voter_id)).map((o) => String(o.id));
    current.set(c.voter_id, after);
    // Options the owner deleted are not the voter's doing; leave them out.
    const before = c.baseline.map(String).filter((id) => optionIds.has(id));
    const same = before.length === after.length && before.every((id) => after.includes(id));
    if (!same) changes.push({ voter: voterById.get(c.voter_id), before, after });
  }

  let sent = 0;
  let failed = 0;
  if (changes.length) {
    const { rows: watchers } = await pool.query(
      `SELECT u.id, u.name, u.email FROM poll_watchers w JOIN users u ON u.id = w.user_id
        WHERE w.poll_id = $1 AND u.email <> ''`,
      [pollId],
    );
    for (const w of watchers) {
      const theirs = changes.filter((c) => c.voter.id !== w.id); // never email people about their own votes
      if (!theirs.length) continue;
      try {
        await sendOne(w, poll, theirs);
        sent++;
      } catch (err) {
        failed++;
        console.error(`notify: sending to ${w.id} for poll ${poll.slug} failed: ${err.message}`);
      }
    }
  }

  const attempts = Math.max(...claims.map((c) => c.attempts));
  if (failed && !sent && attempts < config.maxAttempts) {
    // Nothing got through (mailer down?): back off and retry the whole batch.
    await pool.query(
      `UPDATE vote_notifications SET lease_until = now() + make_interval(mins => $3)
        WHERE poll_id = $1 AND voter_id = ANY($2::text[])`,
      [pollId, claims.map((c) => c.voter_id), attempts],
    );
    return;
  }

  for (const c of claims) {
    // Delete only if the voter didn't change anything since we claimed the row.
    // Otherwise keep it, re-baselined to what this email reported.
    const { rowCount } = await pool.query(
      'DELETE FROM vote_notifications WHERE poll_id = $1 AND voter_id = $2 AND due_at = $3::timestamptz',
      [pollId, c.voter_id, c.due_at],
    );
    if (!rowCount) {
      await pool.query(
        `UPDATE vote_notifications SET baseline = $3::bigint[], first_change = now(), lease_until = NULL, attempts = 0
          WHERE poll_id = $1 AND voter_id = $2`,
        [pollId, c.voter_id, current.get(c.voter_id)],
      );
    }
  }
  if (sent || failed) console.log(`notify: ${poll.slug}: ${changes.length} change(s), ${sent} email(s) sent, ${failed} failed`);
}

let flushing = false;

async function flush() {
  if (flushing || !transporter) return;
  flushing = true;
  try {
    const { rows } = await pool.query(
      `UPDATE vote_notifications n
          SET lease_until = now() + interval '2 minutes', attempts = n.attempts + 1
         FROM (SELECT poll_id, voter_id FROM vote_notifications
                WHERE due_at <= now() AND (lease_until IS NULL OR lease_until < now())
                ORDER BY due_at
                LIMIT 100
                FOR UPDATE SKIP LOCKED) due
        WHERE n.poll_id = due.poll_id AND n.voter_id = due.voter_id
        RETURNING n.poll_id, n.voter_id, n.baseline, n.due_at::text AS due_at, n.attempts`,
    );
    const byPoll = new Map();
    for (const r of rows) {
      if (!byPoll.has(r.poll_id)) byPoll.set(r.poll_id, []);
      byPoll.get(r.poll_id).push(r);
    }
    for (const [pollId, claims] of byPoll) {
      try {
        await processPoll(pollId, claims);
      } catch (err) {
        console.error(`notify: poll ${pollId} failed:`, err);
      }
    }
  } catch (err) {
    console.error('notify: flush failed:', err.message);
  } finally {
    flushing = false;
  }
}

function start(deps) {
  ({ pool, loadPollState, gravatarHash } = deps);
  transporter = makeTransport();
  const where = config.transport === 'smtp' ? `smtp://${config.smtpHost}:${config.smtpPort}` : config.transport;
  console.log(`notify: ${where}, from ${config.from}, links to ${config.appUrl}, debounce ${config.debounceSeconds}s (max ${config.maxDelaySeconds}s)`);
  if (!transporter) return;
  flush();
  setInterval(flush, config.tickMs).unref();
}

module.exports = {
  config, migrate, start, flush, recordChange, isWatching, setWatching, unsubscribeToken, parseUnsubscribeToken,
};
