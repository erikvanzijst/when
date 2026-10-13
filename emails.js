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
  goodSoft: '#e1f0e7',
  goodLine: '#b9dcc7',
  neutralBar: '#d6cdbf',
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

// "Friday, November 6" (year only when it isn't this year)
function longDay(day) {
  return fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: day.slice(0, 4) === thisYear() ? undefined : 'numeric' });
}

function timeLine(o, tz) {
  if (!o.start) return 'All day';
  return `${fmtTime(o.start)}${o.end ? ` – ${fmtTime(o.end)}` : ''} · ${String(tz).replace(/_/g, ' ')}`;
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

function button(href, label, { secondary = false } = {}) {
  // "Bulletproof" button: a padded link inside a table cell renders in Outlook too.
  if (secondary) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="btn2" style="border-radius:10px;border:1px solid ${C.line};">
      <a href="${esc(href)}" class="ink" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:${C.ink};text-decoration:none;border-radius:10px;">${esc(label)}</a>
    </td></tr></table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="btn" bgcolor="${C.accent}" style="border-radius:10px;background:${C.accent};">
      <a href="${esc(href)}" style="display:inline-block;padding:13px 22px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1;color:#fff8f1;text-decoration:none;border-radius:10px;">${esc(label)} &rarr;</a>
    </td></tr></table>`;
}

function sectionHead(label) {
  return `<tr><td class="rule" style="border-top:1px solid ${C.line};padding-top:20px;font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${C.ink2};">
    <span class="ink2">${label}</span>
  </td></tr>`;
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

// tag: null | 'leading' | 'final'
function standingRow(o, total, { bold = false, tag = null, fill = C.accentMid } = {}) {
  const n = o.voters.length;
  const pct = total ? Math.round((n / total) * 100) : 0;
  const tagHtml = {
    leading: `&nbsp;&nbsp;<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#f8e4d9;color:${C.accentInk};font-size:11.5px;font-weight:600;" class="tag">Leading</span>`,
    final: `&nbsp;&nbsp;<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${C.goodSoft};color:${C.good};font-size:11.5px;font-weight:600;" class="tag-good">Final</span>`,
  }[tag] || '';
  const bar = pct > 0
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:6px;overflow:hidden;"><tr>
        <td class="fill${fill === C.neutralBar ? ' fill-muted' : ''}" width="${pct}%" height="8" bgcolor="${fill}" style="background:${fill};height:8px;font-size:0;line-height:0;border-radius:6px 0 0 6px;${pct === 100 ? 'border-radius:6px;' : ''}">&nbsp;</td>
        ${pct < 100 ? `<td class="track" height="8" bgcolor="${C.track}" style="background:${C.track};height:8px;font-size:0;line-height:0;border-radius:0 6px 6px 0;">&nbsp;</td>` : ''}
      </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="track" height="8" bgcolor="${C.track}" style="background:${C.track};height:8px;font-size:0;line-height:0;border-radius:6px;">&nbsp;</td>
      </tr></table>`;
  return `<tr><td style="padding:9px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="ink" style="font-family:${SANS};font-size:14.5px;font-weight:${bold ? 600 : 500};color:${C.ink};padding-bottom:7px;">${esc(shortLabel(o))}${tagHtml}</td>
        <td align="right" class="muted" style="font-family:${SANS};font-size:13.5px;color:${C.muted};padding-bottom:7px;white-space:nowrap;"><strong class="ink" style="color:${C.ink};font-weight:600;">${n}</strong> of ${total}</td>
      </tr>
      <tr><td colspan="2">${bar}</td></tr>
    </table>
  </td></tr>`;
}

// The page around every email: brand header, one card, small print.
function layout({ subject, preheader, baseUrl, card, footer }) {
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
    .date-big { font-size: 22px !important; }
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
    .good, .tag-good { color: #5fc28f !important; }
    .tag-good, .good-box { background: #17301f !important; }
    .good-box { border-color: #24452f !important; }
    .note { background: #2a2622 !important; }
    .btn2 { border-color: #3a352f !important; }
    .fill-muted { background: #4d463e !important; }
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
        ${card}
      </td></tr>

      <tr><td class="muted" style="padding:22px 8px 0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${C.muted};">
        ${footer}
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Eyebrow label over the poll title.
function heading(label, title, { color = C.accentInk, cls = 'eyebrow' } = {}) {
  return `<div class="${cls}" style="font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:1.4px;text-transform:uppercase;color:${color};">${label}</div>
        <h1 class="title ink" style="margin:10px 0 6px;font-family:${SERIF};font-size:29px;line-height:1.2;font-weight:500;letter-spacing:-0.4px;color:${C.ink};">${esc(title)}</h1>`;
}

function moreRow(rest, one, many = `${one}s`) {
  return rest > 0 ? `<tr><td class="muted" style="padding-top:4px;font-family:${SANS};font-size:13.5px;color:${C.muted};">and ${rest} more ${rest === 1 ? one : many}</td></tr>` : '';
}

// --- Vote email -----------------------------------------------------------------

function renderHtml({ poll, changes, pollUrl, unsubscribeUrl, baseUrl, subject }) {
  const { total, max, ranked } = standings(poll);
  const shown = ranked.slice(0, 5);
  const touched = new Set(changes.flatMap((c) => c.after.map(String)));
  const leader = ranked[0];
  const preheader = total && leader.voters.length
    ? `${shortLabel(leader)} leads with ${leader.voters.length} of ${total}.`
    : `See where “${poll.title}” stands.`;
  const leading = (o) => o.voters.length > 0 && o.voters.length === max;

  const card = `${heading(changes.every((c) => !c.before.length) ? (changes.length === 1 ? 'New vote' : 'New votes') : 'Votes updated', poll.title)}
        <div class="muted" style="font-family:${SANS};font-size:14px;color:${C.muted};">${total} ${total === 1 ? 'person has' : 'people have'} responded so far</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
          ${changes.map((c) => changeRow(c, poll, baseUrl)).join('')}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
          ${sectionHead('Where it stands')}
          ${shown.map((o) => standingRow(o, total, {
            bold: touched.has(String(o.id)),
            tag: leading(o) && total ? 'leading' : null,
            fill: leading(o) ? C.accent : C.accentMid,
          })).join('')}
          ${moreRow(ranked.length - shown.length, 'date')}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr><td>${button(pollUrl, 'Open datepicker')}</td></tr></table>`;

  const footer = `You’re getting this because you’re watching <a href="${esc(pollUrl)}" style="color:${C.muted};">${esc(poll.title)}</a> on When.
        <a href="${esc(unsubscribeUrl)}" style="color:${C.muted};">Stop watching this datepicker</a>.`;

  return layout({ subject, preheader, baseUrl, card, footer });
}

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

// --- Decision email -------------------------------------------------------------
//
// Sent to every voter and the owner when the owner picks the final date, and
// again (as a change) when they pick a different one later. The calendar invite
// itself travels as a text/calendar part; this is the human-readable side.

// input = { poll, final, previous: {day,start,end}|null, recipient: {id,name}, pollUrl, baseUrl, googleUrl, icsUrl }
function decisionFacts({ poll, final, previous, recipient }) {
  const isOwner = recipient.id === poll.owner.id;
  const voted = poll.participants.some((p) => p.id === recipient.id);
  const canMake = final.voters.some((v) => v.id === recipient.id);
  const who = isOwner ? 'You' : poll.owner.name;
  const changed = !!previous;
  const { total, ranked } = standings(poll);
  return { isOwner, voted, canMake, who, changed, total, ranked };
}

function decisionSubject({ poll, final, previous }) {
  return previous
    ? `New date: “${poll.title}” moved to ${shortLabel(final)}`
    : `It’s decided: “${poll.title}” is on ${shortLabel(final)}`;
}

function decisionIntro(f) {
  if (f.changed) return `${f.who} moved it to a new date. If you added the earlier date to your calendar, open the attached invite to update it.`;
  return `${f.who} closed voting and picked the date.`;
}

// A heads-up for voters who said this date doesn't work for them.
function decisionNote(f, poll) {
  if (f.isOwner || !f.voted || f.canMake) return '';
  return `You didn’t mark this date as one that works for you. If you can’t make it, let ${firstName(poll.owner.name)} know.`;
}

function personRow(p, recipient, baseUrl) {
  const you = p.id === recipient.id;
  return `<tr>
    <td width="36" valign="middle" style="padding:6px 10px 6px 0;">
      <img src="${esc(avatarUrl(p, baseUrl))}" width="26" height="26" alt="" style="display:block;width:26px;height:26px;border-radius:13px;border:0;">
    </td>
    <td valign="middle" class="ink" style="padding:6px 0;font-family:${SANS};font-size:14.5px;color:${C.ink};">${esc(p.name)}${you ? `<span class="muted" style="color:${C.muted};"> (you)</span>` : ''}</td>
  </tr>`;
}

function renderDecisionHtml(input, subject) {
  const { poll, final, previous, recipient, pollUrl, baseUrl, googleUrl, icsUrl } = input;
  const f = decisionFacts(input);
  const note = decisionNote(f, poll);
  const yes = final.voters;
  const shownPeople = yes.slice(0, 12);
  const shownOptions = f.ranked.slice(0, 5);
  if (!shownOptions.includes(final)) shownOptions[shownOptions.length - 1] = final;
  const footerRole = f.isOwner ? 'created' : f.voted ? 'voted on' : 'were sent the earlier date for';

  const card = `${heading(f.changed ? 'Date changed' : 'It’s decided', poll.title, { color: C.good, cls: 'eyebrow good' })}
        <div class="ink2" style="font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink2};">${esc(decisionIntro(f))}</div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr>
          <td class="good-box" bgcolor="${C.goodSoft}" style="background:${C.goodSoft};border:1px solid ${C.goodLine};border-radius:12px;padding:20px 22px;">
            <div class="date-big ink" style="font-family:${SERIF};font-size:26px;line-height:1.2;font-weight:500;letter-spacing:-0.3px;color:${C.ink};">${esc(longDay(final.day))}</div>
            <div class="ink2" style="margin-top:6px;font-family:${SANS};font-size:15px;color:${C.ink2};">${esc(timeLine(final, poll.tz))}</div>
            ${previous ? `<div class="muted" style="margin-top:10px;font-family:${SANS};font-size:13.5px;color:${C.muted};">Was <span style="text-decoration:line-through;">${esc(shortLabel(previous))}</span></div>` : ''}
          </td>
        </tr></table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr><td>${button(googleUrl, 'Add to Google Calendar')}</td></tr></table>
        <div class="muted" style="margin-top:12px;font-family:${SANS};font-size:13.5px;line-height:1.55;color:${C.muted};">
          Using Apple Calendar or Outlook? Open the attached invite, or <a href="${esc(icsUrl)}" style="color:${C.accentInk};">download the .ics file</a>.
        </div>

        ${note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;"><tr>
          <td class="note ink2" bgcolor="${C.sunken}" style="background:${C.sunken};border-radius:10px;padding:12px 16px;font-family:${SANS};font-size:14px;line-height:1.5;color:${C.ink2};">${esc(note)}</td>
        </tr></table>` : ''}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
          ${sectionHead(`Can make it &nbsp;<span class="muted" style="color:${C.muted};font-weight:500;letter-spacing:0;text-transform:none;font-size:13px;">${yes.length} of ${f.total}</span>`)}
          <tr><td style="padding-top:8px;">
            ${yes.length
              ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${shownPeople.map((p) => personRow(p, recipient, baseUrl)).join('')}</table>`
              : `<div class="muted" style="font-family:${SANS};font-size:14px;color:${C.muted};">Nobody picked this date in the vote.</div>`}
          </td></tr>
          ${moreRow(yes.length - shownPeople.length, 'person', 'people')}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
          ${sectionHead('How the vote went')}
          ${shownOptions.map((o) => standingRow(o, f.total, {
            bold: o === final,
            tag: o === final ? 'final' : null,
            fill: o === final ? C.good : C.neutralBar,
          })).join('')}
          ${moreRow(f.ranked.length - shownOptions.length, 'date')}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr><td>${button(pollUrl, 'Open datepicker', { secondary: true })}</td></tr></table>`;

  const footer = `You’re getting this because you ${footerRole} <a href="${esc(pollUrl)}" style="color:${C.muted};">${esc(poll.title)}</a> on When.`;

  const preheader = `${shortLabel(final)}. ${yes.length} of ${f.total} can make it.`;
  return layout({ subject, preheader, baseUrl, card, footer });
}

function renderDecisionText(input) {
  const { poll, final, previous, recipient, pollUrl, googleUrl, icsUrl } = input;
  const f = decisionFacts(input);
  const note = decisionNote(f, poll);
  const name = (p) => (p.id === recipient.id ? `${p.name} (you)` : p.name);
  const lines = [
    poll.title,
    '='.repeat(Math.min(poll.title.length, 60)),
    '',
    decisionIntro(f),
    '',
    `  ${longDay(final.day)}`,
    `  ${timeLine(final, poll.tz)}`,
    ...(previous ? [`  (was ${shortLabel(previous)})`] : []),
    '',
    'The calendar invite is attached.',
    `Add to Google Calendar: ${googleUrl}`,
    `Download .ics: ${icsUrl}`,
    ...(note ? ['', note] : []),
    '',
    `Can make it (${final.voters.length} of ${f.total}):`,
    ...(final.voters.length ? final.voters.map((p) => `  - ${name(p)}`) : ['  Nobody picked this date in the vote.']),
    '',
    'How the vote went:',
    ...f.ranked.map((o) => `  ${String(o.voters.length).padStart(2)} of ${f.total}  ${shortLabel(o)}${o === final ? '  <- final' : ''}`),
    '',
    `Open datepicker: ${pollUrl}`,
  ];
  return lines.join('\n');
}

function renderDecisionEmail(input) {
  const subject = decisionSubject(input);
  return { subject, html: renderDecisionHtml(input, subject), text: renderDecisionText(input) };
}

module.exports = { renderVoteEmail, renderDecisionEmail };
