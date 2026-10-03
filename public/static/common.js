// Shared helpers for every page: API access, identity, header, icons, dates.

const ICON_PATHS = {
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  users: '<path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20"/><circle cx="9.5" cy="7.5" r="3.5"/><path d="M21 20v-1.5a4 4 0 0 0-3-3.87M15.5 4.13a3.5 3.5 0 0 1 0 6.75"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  unlock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 7.75-1.4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  flag: '<path d="M4 21V4M4 4h12l-2 4 2 4H4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01"/>',
  party: '<path d="M5.8 11.3 2 22l10.7-3.8"/><path d="M4 3h.01M22 8h.01M15 2h.01M22 20h.01M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10M22 13l-.82-.33c-.86-.34-1.82.2-1.98 1.11-.11.7-.72 1.22-1.43 1.22H17M11 2l.33.82c.34.86-.2 1.82-1.11 1.98-.7.1-1.22.72-1.22 1.43V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  spinner: '<path d="M12 3a9 9 0 1 0 9 9" style="transform-origin:center;animation:spin .8s linear infinite"/>',
  single: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  multi: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/>',
};

export function icon(name, extra = '') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICON_PATHS[name] || ''}</svg>`;
}

const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
document.head.appendChild(spinStyle);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// --- Identity --------------------------------------------------------------

let session = null;

export async function loadSession() {
  if (session) return session;
  const res = await fetch('/api/me', { headers: { Accept: 'application/json' } });
  session = await res.json();
  return session;
}

export function loginHref(rd = location.pathname + location.search) {
  const base = session?.loginUrl || '/.freepod/auth/login';
  return `${base}?rd=${encodeURIComponent(rd)}`;
}

export function logoutHref(rd = '/') {
  const base = session?.logoutUrl || '/.freepod/auth/logout';
  return `${base}?rd=${encodeURIComponent(rd)}`;
}

export function signIn() {
  location.href = loginHref();
}

// --- API -------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    signIn();
    throw new ApiError(401, 'Signing you in…');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data);
  return data;
}

// --- Header ----------------------------------------------------------------

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return s.toUpperCase();
}

const AVATAR_TONES = ['#b4532a', '#8a6f2f', '#5b7a3a', '#2f7466', '#3d6a8f', '#6a5a9b', '#9b4f78', '#7a6656'];

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

const AVATAR_PX = { sm: 22, '': 28, lg: 36 };

// Initials are always rendered; a Gravatar, when the person has one, is laid
// over them. d=404 makes Gravatar fail instead of serving a generic image, and
// the error handler below then drops the <img> so the initials show through.
export function avatar(person, { size = '', me = false } = {}) {
  const tone = AVATAR_TONES[hash(person.id) % AVATAR_TONES.length];
  const px = (AVATAR_PX[size] || 28) * 2;
  const img = /^[0-9a-f]{64}$/.test(person.avatar || '')
    ? `<img class="avatar-img" src="https://gravatar.com/avatar/${person.avatar}?s=${px}&d=404" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<span class="avatar ${size ? `avatar-${size}` : ''} ${me ? 'is-me' : ''}" style="--av:${tone}" title="${esc(person.name)}">${esc(initials(person.name))}${img}</span>`;
}

document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.classList.contains('avatar-img')) e.target.remove();
}, true);

export function renderHeader(me) {
  const header = document.querySelector('.site-header .wrap');
  const slot = header.querySelector('[data-user]');
  if (!me.user) {
    slot.innerHTML = `<a class="btn btn-sm" href="${esc(loginHref())}">${icon('login')}Sign in</a>`;
    return;
  }
  slot.innerHTML = `
    <div class="user-menu">
      <button class="user-button" type="button" aria-haspopup="menu" aria-expanded="false">
        ${avatar(me.user, { me: true })}
        <span class="name">${esc(me.user.name)}</span>
      </button>
      <div class="menu" role="menu" hidden>
        <div class="menu-label"><strong>${esc(me.user.name)}</strong>${esc(me.user.email)}</div>
        <div class="menu-sep"></div>
        <a class="menu-item" role="menuitem" href="/">${icon('calendar')}My datepickers</a>
        <a class="menu-item" role="menuitem" href="${esc(logoutHref())}">${icon('logout')}Sign out</a>
      </div>
    </div>`;
  bindMenu(slot.querySelector('.user-button'), slot.querySelector('.menu'));
}

export function bindMenu(button, menu) {
  const close = () => { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    document.dispatchEvent(new Event('closemenus'));
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('.menu-item')?.focus({ preventScroll: true });
  });
  document.addEventListener('closemenus', close);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); button.focus(); } });
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu-item')) close(); });
}

window.addEventListener('scroll', () => {
  document.querySelector('.site-header')?.classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

// --- Toast -----------------------------------------------------------------

export function toast(message, { type = 'info', ms = 2400 } = {}) {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(type === 'error' ? 'info' : 'check')}<span>${esc(message)}</span>`;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}

// --- Dates -----------------------------------------------------------------
// Dates are calendar days ("2026-10-17") and times are wall-clock ("19:00").
// They are formatted in UTC so no viewer timezone shifts them.

export function parseDay(day) {
  return new Date(`${day}T00:00:00Z`);
}

export function fmtDay(day, opts) {
  return parseDay(day).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
}

// Options include the year only when it isn't the current one.
export function yearOpt(day) {
  return day.slice(0, 4) !== String(new Date().getFullYear()) ? 'numeric' : undefined;
}

export function fmtLongDay(day) {
  return fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: yearOpt(day) });
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const d = new Date(Date.UTC(2000, 0, 1, h, m));
  return d.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

export function fmtTimeRange(start, end) {
  if (!start) return '';
  return end ? `${fmtTime(start)} – ${fmtTime(end)}` : fmtTime(start);
}

export function dateTile(day) {
  return `<span class="date-tile" aria-hidden="true">
    <span class="dow">${esc(fmtDay(day, { weekday: 'short' }))}</span>
    <span class="dom">${esc(fmtDay(day, { day: 'numeric' }))}</span>
    <span class="mon">${esc(fmtDay(day, { month: 'short' }))}</span>
  </span>`;
}

export function fmtTz(tz) {
  return String(tz || 'UTC').replace(/_/g, ' ');
}

export function localTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function timeZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return [localTz(), 'UTC']; }
}

export function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  if (diff < 60) return 'just now';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function listNames(names, max = 3) {
  if (names.length <= max) {
    return new Intl.ListFormat('en-US', { style: 'long', type: 'conjunction' }).format(names);
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
