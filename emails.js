'use strict';

// Notification emails. HTML is table-based with inline styles, because email
// clients (Gmail, Outlook) ignore most of modern CSS; a small <style> block adds
// web fonts and dark mode for the clients that do support them (Apple Mail, iOS).

const { AVATAR_TONES } = require('./og');

const C = {
  bg: '#f6f2ea',
  surface: '#fffdf9',
  sunken: '#efe9de',
  ink: '#1d1a16',
  ink2: '#57514a',
  muted: '#847d73',
  line: '#e4ddd1',
  accent: '#c8461b',
  accentInk: '#a8380f',
  accentMid: '#de8a6a',
  track: '#ede6da',
  good: '#2c7a55',
};

const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Formatting --------------------------------------------------------------

const thisYear = () => String(new Date().getUTCFullYear());

function fmtDay(day, opts) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

// "Fri, Nov 6 · 7:30 PM" (year only when it isn't this year)
function shortLabel(o) {
  const day = fmtDay(o.day, { weekday: 'short', month: 'short', day: 'numeric', year: o.day.slice(0, 4) === thisYear() ? undefined : 'numeric' });
  if (!o.start) return day;
  return `${day} · ${fmtTime(o.start)}${o.end ? ` – ${fmtTime(o.end)}` : ''}`;
}

function list(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function firstName(name) {
  return String(name || 'Someone').trim().split(/\s+/)[0];
}

function initials(name) {
  const ascii = String(name || '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  const parts = ascii.trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '').slice(0, 2);
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'X';
}

function toneOf(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % AVATAR_TONES.length;
}

function avatarUrl(person, baseUrl, px = 64) {
  const fallback = `${baseUrl}/avatar/${initials(person.name)}-${toneOf(person.id)}.png`;
  if (!/^[0-9a-f]{64}$/.test(person.avatar || '')) return fallback;
  return `https://gravatar.com/avatar/${person.avatar}?s=${px}&d=${encodeURIComponent(fallback)}`;
}

// --- Describing changes ------------------------------------------------------

// change = { voter: {id, name, avatar}, before: [optionId], after: [optionId] }
function describe(change, poll, { html }) {
  const byId = new Map(poll.options.map((o) => [String(o.id), o]));
  const label = (id) => {
    const o = byId.get(String(id));
    const s = o ? shortLabel(o) : 'a removed date';
    if (!html) return s;
    // Keep "Fri, Nov 6" and "7:30 PM" intact; only break around the separators.
    const parts = s.split(/( · | – )/).map((p, i) => (i % 2 ? `&nbsp;${esc(p.trim())} ` : `<span style="white-space:nowrap;">${esc(p)}</span>`)).join('');
    return `<strong class="ink" style="font-weight:600;color:${C.ink};">${parts}</strong>`;
  };
  const before = new Set(change.before.map(String));
  const after = new Set(change.after.map(String));
  const added = [...after].filter((id) => !before.has(id)).sort(byDate(byId));
  const removed = [...before].filter((id) => !after.has(id)).sort(byDate(byId));

  if (!before.size) return `picked ${list(added.map(label))}`;
  if (!after.size) return before.size > 1 ? 'withdrew their votes' : 'withdrew their vote';
  if (!poll.multi) return `switched from ${label(removed[0])} to ${label(added[0])}`;
  const parts = [];
  if (added.length) parts.push(`added ${list(added.map(label))}`);
  if (removed.length) parts.push(`removed ${list(removed.map(label))}`);
  return parts.join(' and ');
}

function byDate(byId) {
  return (a, b) => {
    const oa = byId.get(a);
    const ob = byId.get(b);
    return `${oa?.day}${oa?.start || ''}`.localeCompare(`${ob?.day}${ob?.start || ''}`);
  };
}

function subjectFor(changes, poll) {
  const names = changes.map((c) => firstName(c.voter.name));
  const title = `“${poll.title}”`;
  if (changes.length === 1 && !changes[0].after.length) return `${names[0]} withdrew from ${title}`;
  const who = names.length <= 2 ? list(names) : `${names[0]}, ${names[1]} and ${names.length - 2} ${names.length - 2 === 1 ? 'other' : 'others'}`;
  if (changes.every((c) => !c.before.length)) return `${who} voted on ${title}`;
  if (changes.length === 1) return `${who} changed ${poll.multi ? 'their votes' : 'their vote'} on ${title}`;
  return `${who} updated their votes on ${title}`;
}

function standings(poll) {
  const total = poll.participants.length;
  const max = Math.max(0, ...poll.options.map((o) => o.voters.length));
  const ranked = [...poll.options].sort((a, b) => b.voters.length - a.voters.length || `${a.day}${a.start || ''}`.localeCompare(`${b.day}${b.start || ''}`));
  return { total, max, ranked };
}

// --- HTML --------------------------------------------------------------------

function button(href, label) {
  // "Bulletproof" button: a padded link inside a table cell renders in Outlook too.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="btn" bgcolor="${C.accent}" style="border-radius:10px;background:${C.accent};">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:#fff8f1;text-decoration:none;border-radius:10px;">${esc(label)} &rarr;</a>
    </td></tr></table>`;
}

function changeRow(change, poll, baseUrl) {
  const v = change.voter;
  return `<tr>
    <td width="40" valign="top" style="padding:10px 12px 10px 0;">
      <img src="${esc(avatarUrl(v, baseUrl))}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border-radius:16px;border:0;">
    </td>
    <td valign="middle" class="ink2" style="padding:10px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink2};">
      <strong class="ink" style="font-weight:600;color:${C.ink};">${esc(v.name)}</strong> ${describe(change, poll, { html: true })}
    </td>
  </tr>`;
}

function standingRow(o, total, max, highlight) {
  const n = o.voters.length;
  const pct = total ? Math.round((n / total) * 100) : 0;
  const leading = n > 0 && n === max;
  const fill = leading ? C.accent : C.accentMid;
  const bar = pct > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;"><tr>
        <td class="fill" width="${pct}%" height="8" bgcolor="${fill}" style="background:${fill};height:8px;font-size:0;line-height:0;border-radius:6px 0 0 6px;${pct === 100 ? 'border-radius:6px;' : ''}">&nbsp;</td>
        ${pct < 100 ? `<td class="track" height="8" bgcolor="${C.track}" style="background:${C.track};height:8px;font-size:0;line-height:0;border-radius:0 6px 6px 0;">&nbsp;</td>` : ''}
      </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="track" height="8" bgcolor="${C.track}" style="background:${C.track};height:8px;font-size:0;line-height:0;border-radius:6px;">&nbsp;</td>
      </tr></table>`;
  return `<tr><td style="padding:9px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="ink" style="font-family:${SANS};font-size:14.5px;font-weight:${highlight ? 600 : 500};color:${C.ink};padding-bottom:7px;">${esc(shortLabel(o))}${leading && total ? `&nbsp;&nbsp;<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#f8e4d9;color:${C.accentInk};font-size:11.5px;font-weight:600;" class="tag">Leading</span>` : ''}</td>
        <td align="right" class="muted" style="font-family:${SANS};font-size:13.5px;color:${C.muted};padding-bottom:7px;white-space:nowrap;"><strong class="ink" style="color:${C.ink};font-weight:600;">${n}</strong> of ${total}</td>
      </tr>
      <tr><td colspan="2">${bar}</td></tr>
    </table>
  </td></tr>`;
}

function renderHtml({ poll, changes, pollUrl, unsubscribeUrl, baseUrl, subject }) {
  const { total, max, ranked } = standings(poll);
  const shown = ranked.slice(0, 5);
  const rest = ranked.length - shown.length;
  const touched = new Set(changes.flatMap((c) => c.after.map(String)));
  const leader = ranked[0];
  const preheader = total && leader.voters.length
    ? `${shortLabel(leader)} leads with ${leader.voters.length} of ${total}.`
    : `See where “${poll.title}” stands.`;

  return `<!doctype html>
<html lang="en-US" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; }
  a { color: ${C.accentInk}; }
  @media (max-width: 620px) {
    .container { width: 100% !important; }
    .card { padding: 24px 20px !important; }
    .pad { padding-left: 16px !important; padding-right: 16px !important; }
    .title { font-size: 25px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .bg { background: #131210 !important; }
    .card { background: #1c1a17 !important; border-color: #2f2b26 !important; }
    .ink { color: #f3eee6 !important; }
    .ink2 { color: #c4bcb0 !important; }
    .muted { color: #8f877c !important; }
    .rule { border-color: #2f2b26 !important; }
    .track { background: #2a2622 !important; }
    .eyebrow, .tag { color: #f59a76 !important; }
    .tag { background: #3a2219 !important; }
    .brand-q { color: #f0794c !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
  <tr><td align="center" class="pad" style="padding:32px 24px 40px;">
    <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">

      <tr><td style="padding:0 4px 20px;">
        <a href="${esc(baseUrl)}/" style="text-decoration:none;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle"><img src="${esc(baseUrl)}/static/email-logo.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
            <td valign="middle" class="ink" style="padding-left:10px;font-family:${SERIF};font-size:21px;font-weight:600;color:${C.ink};letter-spacing:-0.3px;">When<span class="brand-q" style="color:${C.accent};font-style:italic;font-weight:400;">?</span></td>
          </tr></table>
        </a>
      </td></tr>

      <tr><td class="card" bgcolor="${C.surface}" style="background:${C.surface};border:1px solid ${C.line};border-radius:16px;padding:32px 32px 30px;">
        <div class="eyebrow" style="font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${C.accentInk};">${changes.every((c) => !c.before.length) ? (changes.length === 1 ? 'New vote' : 'New votes') : 'Votes updated'}</div>
        <h1 class="title ink" style="margin:10px 0 6px;font-family:${SERIF};font-size:29px;line-height:1.2;font-weight:500;letter-spacing:-0.4px;color:${C.ink};">${esc(poll.title)}</h1>
        <div class="muted" style="font-family:${SANS};font-size:14px;color:${C.muted};">${total} ${total === 1 ? 'person has' : 'people have'} responded so far</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
          ${changes.map((c) => changeRow(c, poll, baseUrl)).join('')}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
          <tr><td class="rule" style="border-top:1px solid ${C.line};padding-top:20px;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${C.ink2};" >
            <span class="ink2">Where it stands</span>
          </td></tr>
          ${shown.map((o) => standingRow(o, total, max, touched.has(String(o.id)))).join('')}
          ${rest > 0 ? `<tr><td class="muted" style="padding-top:4px;font-family:${SANS};font-size:13.5px;color:${C.muted};">and ${rest} more ${rest === 1 ? 'date' : 'dates'}</td></tr>` : ''}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr><td>${button(pollUrl, 'Open datepicker')}</td></tr></table>
      </td></tr>

      <tr><td class="muted" style="padding:22px 8px 0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${C.muted};">
        You’re getting this because you’re watching <a href="${esc(pollUrl)}" style="color:${C.muted};">${esc(poll.title)}</a> on When.
        <a href="${esc(unsubscribeUrl)}" style="color:${C.muted};">Stop watching this datepicker</a>.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// --- Plain text alternative ----------------------------------------------------

function renderText({ poll, changes, pollUrl, unsubscribeUrl }) {
  const { total, ranked } = standings(poll);
  const lines = [
    poll.title,
    '='.repeat(Math.min(poll.title.length, 60)),
    '',
    ...changes.map((c) => `- ${c.voter.name} ${describe(c, poll, { html: false })}`),
    '',
    `Where it stands (${total} ${total === 1 ? 'person' : 'people'} responded):`,
    ...ranked.slice(0, 5).map((o) => `  ${String(o.voters.length).padStart(2)} of ${total}  ${shortLabel(o)}`),
    ...(ranked.length > 5 ? [`  and ${ranked.length - 5} more`] : []),
    '',
    `Open datepicker: ${pollUrl}`,
    '',
    '--',
    `You're getting this because you're watching "${poll.title}" on When.`,
    `Stop watching: ${unsubscribeUrl}`,
  ];
  return lines.join('\n');
}

function renderVoteEmail(input) {
  const subject = subjectFor(input.changes, input.poll);
  return { subject, html: renderHtml({ ...input, subject }), text: renderText(input) };
}

module.exports = { renderVoteEmail };
