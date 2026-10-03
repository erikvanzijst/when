#!/usr/bin/env node
'use strict';

// Renders sample notification emails to var/email-previews/ for design review.
// Open var/email-previews/index.html in a browser.
//
//   node scripts/preview-emails.js [baseUrl]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { renderVoteEmail } = require('../emails');

const baseUrl = (process.argv[2] || 'https://when.prutser.freepod.eu').replace(/\/$/, '');
const outDir = path.join(__dirname, '..', 'var', 'email-previews');

const sha = (email) => crypto.createHash('sha256').update(email).digest('hex');
const people = {
  erik: { id: 'u-erik', name: 'Erik van Zijst', avatar: null },
  // Gravatar's own documentation example address, so one sample has a photo.
  anna: { id: 'u-anna', name: 'Anna Müller', avatar: sha('beau@dentedreality.com.au') },
  bob: { id: 'u-bob', name: 'Bob Smith', avatar: null },
  chen: { id: 'u-chen', name: 'Chen Wei', avatar: null },
  dana: { id: 'u-dana', name: 'Dana Okafor', avatar: null },
  ed: { id: 'u-ed', name: 'Ed', avatar: null },
};

// Builds a poll state like the API's, from [option, [voterKeys]] pairs.
function poll({ slug, title, multi, owner = 'erik', options }) {
  const opts = options.map(([o, voters], i) => ({ id: String(i + 1), ...o, start: o.start || null, end: o.end || null, voters: voters.map((k) => people[k]) }));
  const participants = [...new Map(opts.flatMap((o) => o.voters).map((p) => [p.id, p])).values()];
  return { slug, title, multi, owner: people[owner], tz: 'Europe/Amsterdam', closed: false, finalOptionId: null, participants, options: opts };
}

const dinner = poll({
  slug: 'team-dinner-q4', title: 'Team Dinner Q4', multi: true,
  options: [
    [{ day: '2026-11-05', start: '19:00', end: '22:00' }, ['anna', 'dana']],
    [{ day: '2026-11-06', start: '19:30' }, ['anna', 'bob', 'chen', 'erik']],
    [{ day: '2026-11-07' }, ['chen', 'ed']],
    [{ day: '2026-11-12' }, ['erik']],
    [{ day: '2026-11-13' }, []],
    [{ day: '2026-11-14' }, ['ed']],
    [{ day: '2026-11-19', start: '18:00' }, []],
  ],
});

const book = poll({
  slug: 'book-club-november', title: 'Book club: The Overstory', multi: false, owner: 'anna',
  options: [
    [{ day: '2026-11-06', start: '21:00' }, ['dana', 'erik']],
    [{ day: '2026-11-07' }, ['bob']],
    [{ day: '2026-11-08', start: '15:00' }, ['chen']],
  ],
});

const scenarios = [
  {
    name: 'first-vote',
    description: 'One person votes for the first time on a multiple-choice poll',
    poll: dinner,
    changes: [{ voter: people.anna, before: [], after: ['1', '2'] }],
  },
  {
    name: 'several-voters',
    description: 'Several people change things in the same minute: a new vote, an edit, a withdrawal',
    poll: dinner,
    changes: [
      { voter: people.bob, before: [], after: ['2'] },
      { voter: people.chen, before: ['1', '4'], after: ['2', '3'] },
      { voter: people.dana, before: ['3', '6'], after: [] },
    ],
  },
  {
    name: 'single-choice-switch',
    description: 'Someone switches their pick on a single-choice poll',
    poll: book,
    changes: [{ voter: people.erik, before: ['2'], after: ['1'] }],
  },
  {
    name: 'withdrawal',
    description: 'Someone withdraws their only vote',
    poll: book,
    changes: [{ voter: people.chen, before: ['2'], after: [] }].map((c) => c),
  },
];

fs.mkdirSync(outDir, { recursive: true });
const entries = [];
for (const s of scenarios) {
  const pollUrl = `${baseUrl}/${s.poll.slug}`;
  const email = renderVoteEmail({
    poll: s.poll, changes: s.changes, baseUrl, pollUrl, unsubscribeUrl: `${baseUrl}/unsubscribe/preview-token`,
  });
  fs.writeFileSync(path.join(outDir, `${s.name}.html`), email.html);
  fs.writeFileSync(path.join(outDir, `${s.name}.txt`), `Subject: ${email.subject}\n\n${email.text}\n`);
  entries.push({ ...s, subject: email.subject, size: Buffer.byteLength(email.html) });
}

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html>
<html lang="en-US"><head><meta charset="utf-8"><title>Email previews · When</title>
<style>
  body { margin: 0; padding: 32px; background: #e9e4da; font: 14px/1.5 -apple-system, 'Segoe UI', Inter, sans-serif; color: #1d1a16; }
  h1 { font: 500 28px Georgia, serif; margin: 0 0 4px; }
  .lede { color: #57514a; margin: 0 0 32px; }
  section { margin-bottom: 56px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: baseline; margin-bottom: 12px; }
  .meta h2 { font-size: 17px; margin: 0; }
  .meta .desc, .meta a { color: #6f685e; }
  .inbox { background: #fff; border: 1px solid #d8d0c2; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; max-width: 1240px; }
  .inbox b { font-weight: 600; }
  .inbox .from { color: #57514a; }
  .frames { display: flex; gap: 20px; align-items: flex-start; overflow-x: auto; padding-bottom: 8px; }
  figure { margin: 0; flex: none; }
  figcaption { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #6f685e; margin-bottom: 6px; }
  iframe { display: block; border: 1px solid #d8d0c2; border-radius: 10px; background: #fff; }
  .dark { color-scheme: dark; }
</style></head><body>
<h1>Notification email previews</h1>
<p class="lede">Rendered ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC against ${esc(baseUrl)}. Regenerate with <code>node scripts/preview-emails.js</code>. Dark previews show clients that honor <code>prefers-color-scheme</code> (Apple Mail, iOS); Gmail applies its own dark mode.</p>
${entries.map((e) => `<section>
  <div class="meta"><h2>${esc(e.name)}</h2><span class="desc">${esc(e.description)}</span>
    <a href="${e.name}.html">open</a><a href="${e.name}.txt">plain text</a><span class="desc">${(e.size / 1024).toFixed(1)} KB</span></div>
  <div class="inbox"><span class="from">When &lt;when@freepod.eu&gt;</span> &nbsp;·&nbsp; <b>${esc(e.subject)}</b></div>
  <div class="frames">
    <figure><figcaption>Desktop · light</figcaption><iframe src="${e.name}.html" width="680" height="900" loading="lazy"></iframe></figure>
    <figure><figcaption>Phone · light</figcaption><iframe src="${e.name}.html" width="375" height="900" loading="lazy"></iframe></figure>
    <figure><figcaption>Phone · dark</figcaption><iframe class="dark" src="${e.name}.html" width="375" height="900" loading="lazy"></iframe></figure>
  </div>
</section>`).join('\n')}
</body></html>
`);

console.log(`Wrote ${entries.length} previews to ${path.relative(process.cwd(), outDir)}/index.html`);
for (const e of entries) console.log(`  ${e.name.padEnd(22)} ${e.subject}`);
