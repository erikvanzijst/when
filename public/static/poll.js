import {
  icon, esc, $, loadSession, renderHeader, loginHref, signIn, api, toast, avatar, bindMenu,
  dateTile, fmtDay, fmtLongDay, fmtTimeRange, fmtTz, timeZones, plural, listNames,
} from './common.js';
import { createPicker } from './picker.js';

const app = document.getElementById('app');
const slug = decodeURIComponent(location.pathname.slice(1).replace(/\/$/, ''));
const me = await loadSession();
renderHeader(me);

let state = null;      // last server state
let pending = null;    // my optimistic selection (array of option ids) while a save is in flight
let saving = false;
let live = false;
let deleted = false;
let justCreated = sessionStorage.getItem('when:new') === slug;
sessionStorage.removeItem('when:new');
let lastToggled = null;
let headSig = '';
let watch = null; // { watching, email } for the signed-in viewer

app.innerHTML = `
  <div class="poll-head">
    <div class="skeleton" style="height:14px;width:110px;margin-bottom:18px"></div>
    <div class="skeleton" style="height:48px;width:70%"></div>
  </div>
  <div class="options" style="margin-top:48px">
    ${'<div class="skeleton" style="height:96px"></div>'.repeat(3)}
  </div>`;


// --- Live updates ----------------------------------------------------------

function connect() {
  const es = new EventSource(`/api/polls/${encodeURIComponent(slug)}/events`);
  es.addEventListener('open', () => setLive(true));
  es.addEventListener('state', (e) => setState(JSON.parse(e.data)));
  es.addEventListener('deleted', () => {
    es.close();
    deleted = true;
    renderMissing('This datepicker was deleted', 'Its creator removed it. Nothing more to vote on here.');
  });
  es.addEventListener('error', () => {
    setLive(false);
    if (es.readyState === EventSource.CLOSED && !deleted) setTimeout(connect, 3000);
  });
  window.addEventListener('pagehide', () => es.close(), { once: true });
}

function setLive(on) {
  live = on;
  const pill = $('[data-live]');
  if (!pill) return;
  pill.classList.toggle('off', !on);
  pill.querySelector('span:last-child').textContent = on ? 'Live' : 'Reconnecting…';
}

function setState(next) {
  if (deleted) return;
  if (state && next.version < state.version) return;
  const first = !state;
  state = next;
  document.title = `${state.title} · When`;
  if (first) renderShell();
  renderHead();
  renderOptions();
  renderRespondents();
}

// --- Derived ---------------------------------------------------------------

const isOwner = () => me.user && state.owner.id === me.user.id;
const canVote = () => !state.closed;

function myIds(s) {
  if (!me.user) return [];
  return s.options.filter((o) => o.voters.some((v) => v.id === me.user.id)).map((o) => o.id);
}

// The state as I should see it: server state with my in-flight selection applied.
function view() {
  if (!pending || !me.user) return state;
  const mine = new Set(pending);
  const meVoter = { id: me.user.id, name: me.user.name, avatar: me.user.avatar };
  const options = state.options.map((o) => {
    const others = o.voters.filter((v) => v.id !== me.user.id);
    return { ...o, voters: mine.has(o.id) ? [...others, meVoter] : others };
  });
  const people = new Map();
  for (const o of options) for (const v of o.voters) people.set(v.id, v);
  return { ...state, options, participants: [...people.values()] };
}

// --- Rendering -------------------------------------------------------------

function renderMissing(title, message) {
  app.innerHTML = `<div class="state-msg">
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <a class="btn btn-primary" href="/">${icon('plus')}Create a datepicker</a>
  </div>`;
  document.title = `${title} · When`;
}

function renderShell() {
  app.innerHTML = `
    <header class="poll-head" data-head></header>
    <div data-banner></div>
    <div class="options-head">
      <h2>Options</h2>
      <span class="aside" data-hint></span>
    </div>
    <div class="options" data-options role="group"></div>
    <section class="respondents" data-respondents></section>`;
  app.querySelector('[data-options]').addEventListener('click', onOptionClick);
  app.querySelector('[data-options]').addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.matches('.option')) {
      e.preventDefault();
      vote(e.target.dataset.id);
    }
  });
}

function respondedText(n) {
  return n ? `${plural(n, 'person', 'people')} responded` : 'No responses yet';
}

function renderHead() {
  const v = view();
  const hasTimes = v.options.some((o) => o.start);
  const head = app.querySelector('[data-head]');
  // Re-rendering the head would close an open Manage menu, so only do it when
  // something it shows (other than the response count) actually changed.
  const sig = JSON.stringify([state.title, state.description, state.closed, state.finalOptionId, state.multi, state.tz, hasTimes, state.owner, justCreated]);
  if (sig === headSig) {
    head.querySelector('[data-responded]').textContent = respondedText(v.participants.length);
    return;
  }
  headSig = sig;
  head.innerHTML = `
    <span class="eyebrow">${state.closed ? (state.finalOptionId ? 'Decided' : 'Voting closed') : 'Find a date'}</span>
    <h1 class="poll-title">${esc(state.title)}</h1>
    ${state.description ? `<p class="poll-desc">${esc(state.description)}</p>` : ''}
    <div class="poll-meta">
      <span class="owner">${avatar(state.owner, { size: 'sm' })}by ${esc(state.owner.name)}</span>
      <span>${icon('users')}<span data-responded>${respondedText(v.participants.length)}</span></span>
      <span>${icon(state.multi ? 'multi' : 'single')}${state.multi ? 'Pick any that work' : 'Pick one'}</span>
      ${hasTimes ? `<span>${icon('globe')}Times in ${esc(fmtTz(state.tz))}</span>` : ''}
      <span class="live-pill ${live ? '' : 'off'}" data-live><span class="live-dot"></span><span>${live ? 'Live' : 'Connecting…'}</span></span>
    </div>
    <div class="poll-actions">
      <button type="button" class="btn btn-primary" data-share>${icon('link')}<span>Copy link</span></button>
      <button type="button" class="btn" data-watch aria-pressed="false"></button>
      ${isOwner() ? `
        <div class="user-menu">
          <button type="button" class="btn" data-manage aria-haspopup="menu" aria-expanded="false">Manage ${icon('chevronDown')}</button>
          <div class="menu" role="menu" hidden style="left:0;right:auto;transform-origin:top left">
            <button class="menu-item" role="menuitem" data-act="edit">${icon('edit')}Edit details & dates</button>
            ${state.closed
              ? `<button class="menu-item" role="menuitem" data-act="reopen">${icon('unlock')}Reopen voting</button>`
              : `<button class="menu-item" role="menuitem" data-act="close">${icon('lock')}Close voting</button>`}
            ${state.finalOptionId ? `<button class="menu-item" role="menuitem" data-act="unfinal">${icon('x')}Clear final date</button>` : ''}
            <div class="menu-sep"></div>
            <button class="menu-item danger" role="menuitem" data-act="delete">${icon('trash')}Delete datepicker</button>
          </div>
        </div>` : ''}
    </div>`;
  head.querySelector('[data-share]').addEventListener('click', (e) => share(e.currentTarget));
  head.querySelector('[data-watch]').addEventListener('click', toggleWatch);
  renderWatch();
  if (isOwner()) {
    bindMenu(head.querySelector('[data-manage]'), head.querySelector('[data-manage] + .menu'));
    head.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => ownerAction(b.dataset.act)));
  }
  renderBanner();
}

function renderBanner() {
  const el = app.querySelector('[data-banner]');
  const hint = app.querySelector('[data-hint]');
  const final = state.options.find((o) => o.id === state.finalOptionId);
  let html = '';
  if (final) {
    html = `<div class="banner banner-final">${icon('party')}
      <div class="grow"><span>It’s decided</span><span class="final-date">${esc(fmtLongDay(final.day))}${final.start ? ` · ${esc(fmtTimeRange(final.start, final.end))}` : ''}</span></div>
      <button type="button" class="btn" data-ics>${icon('download')}Add to calendar</button>
    </div>`;
  } else if (justCreated && isOwner()) {
    html = `<div class="banner banner-accent">${icon('party')}
      <div class="grow"><strong>Your datepicker is ready.</strong> Share the link so people can vote. Results appear here as they come in.</div>
      <button type="button" class="btn btn-primary" data-share>${icon('link')}<span>Copy link</span></button>
    </div>`;
  } else if (state.closed) {
    html = `<div class="banner">${icon('lock')}<div class="grow"><strong>Voting is closed.</strong> ${isOwner() ? 'Reopen it from Manage if people still need to respond.' : 'The results below are final.'}</div></div>`;
  } else if (!me.user) {
    html = `<div class="banner banner-accent">${icon('info')}
      <div class="grow"><strong>Which dates work for you?</strong> Sign in to add your vote. It only takes a moment.</div>
      <a class="btn btn-primary" href="${esc(loginHref())}">${icon('login')}Sign in to vote</a>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelector('[data-ics]')?.addEventListener('click', () => downloadIcs(final));
  el.querySelector('[data-share]')?.addEventListener('click', (e) => share(e.currentTarget));

  if (state.closed) hint.textContent = '';
  else if (!me.user) hint.textContent = 'Sign in to vote';
  else hint.textContent = state.multi ? 'Tap every date that works · saves instantly' : 'Tap the one that works best · saves instantly';
}

function optionHtml(o) {
  return `
    <span class="check ${state.multi ? 'box' : 'radio'}">${icon('check')}</span>
    ${dateTile(o.day)}
    <div class="option-main">
      <div class="option-top">
        <div class="option-label">
          <span class="when">${esc(fmtLongDay(o.day))}</span>
          ${o.start ? `<span class="time">${esc(fmtTimeRange(o.start, o.end))}</span>` : ''}
          <span class="option-tags" data-tags></span>
        </div>
        <div class="option-count" data-count></div>
      </div>
      <div class="bar" aria-hidden="true"><div class="bar-fill"></div></div>
      <div class="voters" data-voters></div>
    </div>
    <div class="option-side" data-side></div>`;
}

function renderOptions() {
  const v = view();
  const list = app.querySelector('[data-options]');
  const mine = new Set(pending ?? myIds(state));
  const total = v.participants.length;
  const max = Math.max(0, ...v.options.map((o) => o.voters.length));
  const votable = !!me.user && canVote();
  list.setAttribute('role', state.multi ? 'group' : 'radiogroup');
  list.setAttribute('aria-label', 'Date options');

  const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
  const seen = new Set();
  let prev = null;
  for (const o of v.options) {
    const key = `${o.day}|${o.start}|${o.end}|${state.multi}`;
    let el = existing.get(o.id);
    if (!el || el.dataset.key !== key) {
      el?.remove();
      el = document.createElement('div');
      el.dataset.id = o.id;
      el.dataset.key = key;
      el.innerHTML = optionHtml(o);
    }
    seen.add(o.id);
    const n = o.voters.length;
    const isMine = mine.has(o.id);
    const isFinal = state.finalOptionId === o.id;
    const isLeading = n > 0 && n === max;
    el.className = ['option', votable && 'is-votable', isMine && 'is-mine', isFinal && 'is-final', isLeading && 'is-leading', lastToggled === o.id && 'just-voted'].filter(Boolean).join(' ');
    el.setAttribute('role', state.multi ? 'checkbox' : 'radio');
    el.setAttribute('aria-checked', String(isMine));
    el.setAttribute('aria-disabled', String(!votable));
    el.tabIndex = votable ? 0 : -1;
    el.setAttribute('aria-label', `${fmtLongDay(o.day)}${o.start ? `, ${fmtTimeRange(o.start, o.end)}` : ''}: ${plural(n, 'vote')}`);

    el.querySelector('[data-count]').innerHTML = `<strong>${n}</strong>${total ? ` of ${total}` : ''}`;
    el.querySelector('.bar-fill').style.width = `${total ? (n / total) * 100 : 0}%`;
    el.querySelector('.bar').title = n ? `${plural(n, 'vote')}: ${o.voters.map((p) => p.name).join(', ')}` : 'No votes yet';

    const tags = [];
    if (isFinal) tags.push(`<span class="badge badge-good">${icon('check')}Final</span>`);
    else if (isLeading && max > 0 && v.options.length > 1) tags.push(`<span class="badge badge-accent">${icon('star')}Most popular</span>`);
    el.querySelector('[data-tags]').innerHTML = tags.join('');

    const voters = o.voters;
    el.querySelector('[data-voters]').innerHTML = voters.length
      ? `<span class="avatar-stack">${voters.slice(0, 6).map((p) => avatar(p, { size: 'sm', me: me.user && p.id === me.user.id })).join('')}</span>
         <span class="names">${esc(listNames(voters.map((p) => (me.user && p.id === me.user.id ? 'You' : p.name))))}</span>`
      : `<span class="names">No votes yet</span>`;

    const side = el.querySelector('[data-side]');
    if (isOwner()) {
      if (!side.firstChild) {
        side.innerHTML = `<div class="user-menu">
          <button type="button" class="icon-btn" data-opt-menu aria-label="Option actions" aria-haspopup="menu">${icon('more')}</button>
          <div class="menu" role="menu" hidden></div>
        </div>`;
        bindMenu(side.querySelector('[data-opt-menu]'), side.querySelector('.menu'));
      }
      side.querySelector('.menu').innerHTML = isFinal
        ? `<button class="menu-item" role="menuitem" data-final="">${icon('x')}Remove final mark</button>`
        : `<button class="menu-item" role="menuitem" data-final="${o.id}">${icon('flag')}Choose as final date</button>`;
    } else {
      side.innerHTML = '';
    }

    const anchor = prev ? prev.nextSibling : list.firstChild;
    if (anchor !== el) list.insertBefore(el, anchor);
    prev = el;
  }
  for (const [id, el] of existing) if (!seen.has(id)) el.remove();
  lastToggled = null;
}

function renderRespondents() {
  const v = view();
  const el = app.querySelector('[data-respondents]');
  if (!v.participants.length) { el.innerHTML = ''; return; }
  const counts = new Map();
  for (const o of v.options) for (const p of o.voters) counts.set(p.id, (counts.get(p.id) || 0) + 1);
  el.innerHTML = `
    <div class="options-head"><h2>Who’s responded</h2><span class="aside">${plural(v.participants.length, 'person', 'people')}</span></div>
    <div class="respondents-list">
      ${v.participants.map((p) => {
        const isMe = me.user && p.id === me.user.id;
        return `<span class="person">${avatar(p, { size: 'sm', me: isMe })}${esc(isMe ? `${p.name} (you)` : p.name)}${state.multi ? `<span class="n">${counts.get(p.id) || 0}</span>` : ''}</span>`;
      }).join('')}
    </div>`;
}

// --- Voting ----------------------------------------------------------------

function onOptionClick(e) {
  const finalBtn = e.target.closest('[data-final]');
  if (finalBtn) {
    const id = finalBtn.dataset.final || null;
    patch(id ? { finalOptionId: id, closed: true } : { finalOptionId: null }, id ? 'Final date chosen. Voting is now closed.' : 'Final mark removed');
    return;
  }
  if (e.target.closest('.option-side')) return;
  const opt = e.target.closest('.option');
  if (opt) vote(opt.dataset.id);
}

function vote(id) {
  if (!me.user) return signIn();
  if (state.closed) return toast('Voting is closed', { type: 'error' });
  const current = pending ?? myIds(state);
  let next;
  if (state.multi) next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  else next = current.includes(id) ? [] : [id];
  pending = next;
  lastToggled = id;
  renderHead();
  renderOptions();
  renderRespondents();
  save();
}

async function save() {
  if (saving) return;
  saving = true;
  let sent;
  try {
    do {
      sent = pending;
      const result = await api('PUT', `/api/polls/${encodeURIComponent(slug)}/votes`, { optionIds: sent });
      if (pending === sent) {
        pending = null;
        setState(result);
      }
    } while (pending && pending !== sent);
  } catch (err) {
    pending = null;
    if (err.status !== 401) toast(err.message, { type: 'error' });
    if (err.status === 404) return renderMissing('This datepicker was deleted', 'Its creator removed it.');
    try { setState(await api('GET', `/api/polls/${encodeURIComponent(slug)}`)); } catch { /* keep last */ }
    renderOptions();
  } finally {
    saving = false;
  }
}

// --- Watching --------------------------------------------------------------

function renderWatch() {
  const btn = app.querySelector('[data-watch]');
  if (!btn) return;
  const on = !!watch?.watching;
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.innerHTML = on ? `${icon('bellRing')}<span>Watching</span>` : `${icon('bell')}<span>Email me updates</span>`;
  btn.title = on
    ? `You get an email at ${watch.email} when people vote. Click to stop.`
    : 'Get an email when people vote';
}

async function loadWatch() {
  if (!me.user) return;
  try {
    watch = await api('GET', `/api/polls/${encodeURIComponent(slug)}/watch`);
    renderWatch();
  } catch { /* the button just stays in its default state */ }
}

async function toggleWatch() {
  if (!me.user) return signIn();
  const next = !watch?.watching;
  const prev = watch;
  watch = { ...(watch || {}), watching: next };
  renderWatch();
  try {
    watch = await api('PUT', `/api/polls/${encodeURIComponent(slug)}/watch`, { watching: next });
    renderWatch();
    toast(next ? `We’ll email ${watch.email} when people vote` : 'You won’t get emails about this datepicker');
  } catch (err) {
    watch = prev;
    renderWatch();
    if (err.status !== 401) toast(err.message, { type: 'error' });
  }
}

// --- Sharing ---------------------------------------------------------------

async function share(button) {
  const url = `${location.origin}/${slug}`;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: state.title, text: `Which dates work for you? ${state.title}`, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  let ok = false;
  try {
    await navigator.clipboard.writeText(url);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
  }
  if (!ok) {
    window.prompt('Copy this link:', url);
    return;
  }
  const label = button.querySelector('span');
  const original = label.textContent;
  button.classList.add('is-done');
  button.querySelector('svg').outerHTML = icon('check');
  label.textContent = 'Copied!';
  toast('Link copied to clipboard');
  setTimeout(() => {
    if (!button.isConnected) return;
    button.classList.remove('is-done');
    button.querySelector('svg').outerHTML = icon('link');
    label.textContent = original;
  }, 2000);
}

// --- Calendar export -------------------------------------------------------

function downloadIcs(o) {
  const e = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const d = o.day.replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//When//Datepicker//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${slug}-${o.id}@${location.host}`, `DTSTAMP:${stamp}`];
  if (!o.start) {
    const next = new Date(`${o.day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`);
  } else {
    lines.push(`DTSTART;TZID=${state.tz}:${d}T${o.start.replace(':', '')}00`);
    if (o.end) {
      const endDay = new Date(`${o.day}T00:00:00Z`);
      if (o.end < o.start) endDay.setUTCDate(endDay.getUTCDate() + 1);
      lines.push(`DTEND;TZID=${state.tz}:${endDay.toISOString().slice(0, 10).replace(/-/g, '')}T${o.end.replace(':', '')}00`);
    } else {
      lines.push('DURATION:PT1H');
    }
  }
  lines.push(`SUMMARY:${e(state.title)}`, `URL:${location.origin}/${slug}`);
  if (state.description) lines.push(`DESCRIPTION:${e(state.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Owner tools -----------------------------------------------------------

async function patch(body, message) {
  try {
    setState(await api('PATCH', `/api/polls/${encodeURIComponent(slug)}`, body));
    if (message) toast(message);
    return true;
  } catch (err) {
    if (err.status !== 401) toast(err.message, { type: 'error' });
    return false;
  }
}

function ownerAction(act) {
  if (act === 'close') patch({ closed: true }, 'Voting closed');
  else if (act === 'reopen') patch({ closed: false, finalOptionId: null }, 'Voting reopened');
  else if (act === 'unfinal') patch({ finalOptionId: null }, 'Final mark removed');
  else if (act === 'edit') openEdit();
  else if (act === 'delete') openDelete();
}

function openDialog(html, cls = '') {
  const dlg = document.createElement('dialog');
  dlg.className = cls;
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.showModal();
  return dlg;
}

function openEdit() {
  const voteCounts = new Map(state.options.map((o) => [String(o.id), o.voters.length]));
  const zones = timeZones();
  if (!zones.includes(state.tz)) zones.unshift(state.tz);
  const dlg = openDialog(`
    <form method="dialog" novalidate>
      <div class="dialog-head"><h2>Edit datepicker</h2><button type="button" class="icon-btn" data-cancel aria-label="Close">${icon('x')}</button></div>
      <div class="dialog-body">
        <div class="field"><label class="label" for="e-title">Name</label>
          <input class="input" id="e-title" name="title" maxlength="120" value="${esc(state.title)}" required>
          <span class="hint">The link stays <strong>${esc(location.host)}/${esc(slug)}</strong> so shared links keep working.</span></div>
        <div class="field"><label class="label" for="e-desc">Description</label>
          <textarea class="textarea" id="e-desc" name="description" maxlength="1000" placeholder="Optional">${esc(state.description)}</textarea></div>
        <div class="field"><span class="label">Voting</span>
          <div class="segmented" role="radiogroup" aria-label="Voting mode" style="justify-self:start">
            <label><input type="radio" name="mode" value="multi" ${state.multi ? 'checked' : ''}><span>${icon('multi')}Pick any that work</span></label>
            <label><input type="radio" name="mode" value="single" ${state.multi ? '' : 'checked'}><span>${icon('single')}Pick just one</span></label>
          </div></div>
        <div class="field">
          <div class="section-label"><span class="label">Dates</span>
            <div class="tz-row">${icon('globe')}<span>Times in</span>
              <select class="select" name="tz" aria-label="Time zone">${zones.map((z) => `<option value="${esc(z)}" ${z === state.tz ? 'selected' : ''}>${esc(fmtTz(z))}</option>`).join('')}</select>
            </div></div>
          <div data-picker></div>
        </div>
      </div>
      <div class="dialog-foot">
        <span class="dialog-error" data-error></span>
        <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn btn-primary" data-save>Save changes</button>
      </div>
    </form>`);
  const errEl = dlg.querySelector('[data-error]');
  const picker = createPicker(dlg.querySelector('[data-picker]'), {
    options: state.options, voteCounts, onChange: warn,
  });
  function warn() {
    const lost = picker.removedIds().reduce((sum, id) => sum + (voteCounts.get(id) || 0), 0);
    errEl.style.color = lost ? 'var(--warn)' : '';
    errEl.textContent = picker.validate() || (lost ? `${plural(lost, 'vote')} on removed dates will be discarded.` : '');
  }
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const invalid = picker.validate();
    const title = dlg.querySelector('[name="title"]').value.trim();
    if (!title) { errEl.style.color = ''; errEl.textContent = 'The name cannot be empty.'; return; }
    if (invalid) { errEl.style.color = ''; errEl.textContent = invalid; return; }
    const btn = dlg.querySelector('[data-save]');
    btn.disabled = true;
    const ok = await patch({
      title,
      description: dlg.querySelector('[name="description"]').value,
      multi: dlg.querySelector('[name="mode"]:checked').value === 'multi',
      tz: dlg.querySelector('[name="tz"]').value,
      options: picker.getOptions(),
    }, 'Changes saved');
    btn.disabled = false;
    if (ok) dlg.close();
  });
}

function openDelete() {
  const votes = state.options.reduce((n, o) => n + o.voters.length, 0);
  const dlg = openDialog(`
    <div class="dialog-head"><h2>Delete datepicker?</h2></div>
    <div class="dialog-body"><p style="margin:0;color:var(--ink-2)">“${esc(state.title)}”${votes ? ` and its ${plural(votes, 'vote')} from ${plural(state.participants.length, 'person', 'people')}` : ''} will be permanently removed, and the link <strong>/${esc(slug)}</strong> becomes available again. This can’t be undone.</p></div>
    <div class="dialog-foot">
      <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
      <button type="button" class="btn btn-danger" data-confirm>${icon('trash')}Delete</button>
    </div>`, 'dialog-sm');
  dlg.querySelector('[data-confirm]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      deleted = true;
      await api('DELETE', `/api/polls/${encodeURIComponent(slug)}`);
      location.href = '/';
    } catch (err) {
      deleted = false;
      e.currentTarget.disabled = false;
      if (err.status !== 401) toast(err.message, { type: 'error' });
    }
  });
}

// --- Start ------------------------------------------------------------------

try {
  setState(await api('GET', `/api/polls/${encodeURIComponent(slug)}`));
  connect();
  loadWatch();
} catch (err) {
  if (err.status === 404) renderMissing('This datepicker doesn’t exist', 'It may have been deleted, or the link has a typo.');
  else if (err.status !== 401) renderMissing('Something went wrong', err.message);
}
