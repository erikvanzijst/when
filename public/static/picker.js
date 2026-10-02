// Calendar + time-slot editor used by the composer and the edit dialog.

import { icon, esc, fmtDay, dateTile, todayStr, parseDay, plural } from './common.js';

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export function createPicker(root, { options = [], voteCounts = new Map(), onChange = () => {} } = {}) {
  let items = options.map((o) => ({ key: nextKey(), id: o.id ?? null, day: o.day, start: o.start || '', end: o.end || '' }));
  const today = todayStr();
  const first = items.length ? items.map((i) => i.day).sort()[0] : today;
  let cursor = { y: Number(first.slice(0, 4)), m: Number(first.slice(5, 7)) - 1 };

  root.classList.add('picker');
  root.innerHTML = `
    <div class="cal">
      <div class="cal-head">
        <div class="cal-title" aria-live="polite"></div>
        <div class="cal-nav">
          <button type="button" data-nav="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
          <button type="button" data-nav="1" aria-label="Next month">${icon('chevronRight')}</button>
        </div>
      </div>
      <div class="cal-grid" role="grid"></div>
      <div class="cal-hint">Click days to add or remove them.</div>
    </div>
    <div class="slots"></div>`;

  const calTitle = root.querySelector('.cal-title');
  const grid = root.querySelector('.cal-grid');
  const slots = root.querySelector('.slots');

  root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    cursor.m += Number(b.dataset.nav);
    if (cursor.m < 0) { cursor.m = 11; cursor.y--; }
    if (cursor.m > 11) { cursor.m = 0; cursor.y++; }
    renderCal();
  }));

  function dayStr(y, m, d) {
    const dt = new Date(Date.UTC(y, m, d));
    return dt.toISOString().slice(0, 10);
  }

  function countByDay() {
    const map = new Map();
    for (const i of items) map.set(i.day, (map.get(i.day) || 0) + 1);
    return map;
  }

  function renderCal() {
    const monthStart = new Date(Date.UTC(cursor.y, cursor.m, 1));
    calTitle.textContent = monthStart.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const thisMonth = today.slice(0, 7);
    root.querySelector('[data-nav="-1"]').disabled = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}` <= thisMonth;
    const counts = countByDay();
    // Weeks start on Monday.
    const offset = (monthStart.getUTCDay() + 6) % 7;
    const cells = [];
    for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) cells.push(`<div class="cal-dow" role="columnheader">${d}</div>`);
    for (let i = 0; i < 42; i++) {
      const ds = dayStr(cursor.y, cursor.m, 1 - offset + i);
      const dt = parseDay(ds);
      if (i >= 35 && dt.getUTCMonth() !== cursor.m) break;
      const outside = dt.getUTCMonth() !== cursor.m;
      const n = counts.get(ds) || 0;
      const past = ds < today && !n;
      const cls = ['cal-day', outside && 'is-outside', past && 'is-past', ds === today && 'is-today', n && 'is-selected'].filter(Boolean).join(' ');
      const label = `${fmtDay(ds, { weekday: 'long', month: 'long', day: 'numeric' })}${n ? ', selected' : ''}`;
      cells.push(`<button type="button" class="${cls}" data-day="${ds}" aria-pressed="${!!n}" aria-label="${esc(label)}" ${past ? 'disabled' : ''}>
        ${dt.getUTCDate()}${n > 1 ? `<span class="count">${n}</span>` : ''}</button>`);
    }
    grid.innerHTML = cells.join('');
  }

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn || btn.disabled) return;
    const day = btn.dataset.day;
    if (items.some((i) => i.day === day)) {
      items = items.filter((i) => i.day !== day);
    } else {
      items.push({ key: nextKey(), id: null, day, start: '', end: '' });
    }
    renderAll();
    changed();
  });

  function renderSlots() {
    if (!items.length) {
      slots.innerHTML = `<div class="slots-empty">${icon('calendar')}<div><strong>No dates yet</strong></div><div>Pick one or more days on the calendar.</div></div>`;
      return;
    }
    const days = [...new Set(items.map((i) => i.day))].sort();
    const html = [`<div class="slots-head"><span class="count">${plural(items.length, 'option')} on ${plural(days.length, 'day')}</span><button type="button" class="clear" data-clear>Clear all</button></div>`];
    for (const day of days) {
      const dayItems = items.filter((i) => i.day === day).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      const allDayOnly = dayItems.length === 1 && !dayItems[0].start;
      const rows = dayItems.map((it) => {
        const votes = it.id ? voteCounts.get(String(it.id)) || 0 : 0;
        const voteNote = votes ? `<span class="badge badge-muted" title="Existing votes on this option">${plural(votes, 'vote')}</span>` : '';
        if (!it.start && allDayOnly) {
          return `<div class="slot-row" data-key="${it.key}">
            <span class="allday">All day</span>${voteNote}
            <button type="button" class="chip-btn" data-add-time="${it.key}">${icon('clock')}Add time</button>
          </div>`;
        }
        return `<div class="slot-row timed" data-key="${it.key}">
          <input class="time-input" type="time" step="900" value="${esc(it.start)}" data-start="${it.key}" aria-label="Start time" required>
          <span class="time-sep">to</span>
          <input class="time-input" type="time" step="900" value="${esc(it.end)}" data-end="${it.key}" aria-label="End time (optional)">
          ${voteNote}
          <button type="button" class="icon-btn danger" data-remove="${it.key}" aria-label="Remove this time">${icon('x')}</button>
        </div>`;
      }).join('');
      html.push(`<div class="slot-day" data-day-card="${day}">
        ${dateTile(day)}
        <div class="slot-body">
          <div class="slot-title">${esc(fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric', year: day.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined }))}</div>
          ${rows}
          ${allDayOnly ? '' : `<div class="slot-row"><button type="button" class="chip-btn" data-add-slot="${day}">${icon('plus')}Another time</button></div>`}
        </div>
        <button type="button" class="icon-btn danger" data-remove-day="${day}" aria-label="Remove ${esc(fmtDay(day, { month: 'long', day: 'numeric' }))}">${icon('trash')}</button>
      </div>`);
    }
    slots.innerHTML = html.join('');
  }

  slots.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.clear !== undefined) {
      items = [];
    } else if (t.dataset.addTime) {
      const it = items.find((i) => i.key === t.dataset.addTime);
      it.start = '19:00';
      renderAll();
      slots.querySelector(`[data-start="${it.key}"]`)?.focus();
      return changed();
    } else if (t.dataset.addSlot) {
      const day = t.dataset.addSlot;
      const last = items.filter((i) => i.day === day && i.start).map((i) => i.start).sort().pop() || '18:00';
      const [h, m] = last.split(':').map(Number);
      const start = `${String(Math.min(h + 2, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const it = { key: nextKey(), id: null, day, start, end: '' };
      items.push(it);
      renderAll();
      slots.querySelector(`[data-start="${it.key}"]`)?.focus();
      return changed();
    } else if (t.dataset.remove) {
      const it = items.find((i) => i.key === t.dataset.remove);
      const sameDay = items.filter((i) => i.day === it.day);
      if (sameDay.length === 1) { it.start = ''; it.end = ''; } else items = items.filter((i) => i !== it);
    } else if (t.dataset.removeDay) {
      items = items.filter((i) => i.day !== t.dataset.removeDay);
    } else {
      return;
    }
    renderAll();
    changed();
  });

  slots.addEventListener('input', (e) => {
    const key = e.target.dataset.start || e.target.dataset.end;
    if (!key) return;
    const it = items.find((i) => i.key === key);
    if (e.target.dataset.start) it.start = e.target.value;
    else it.end = e.target.value;
    changed();
  });

  function renderAll() {
    renderCal();
    renderSlots();
  }

  function changed() {
    onChange(api.getOptions());
  }

  const api = {
    getOptions() {
      return items
        .map((i) => ({ id: i.id, day: i.day, start: i.start || null, end: i.start && i.end ? i.end : null }))
        .sort((a, b) => (a.day + (a.start || '')).localeCompare(b.day + (b.start || '')));
    },
    removedIds() {
      const kept = new Set(items.filter((i) => i.id).map((i) => String(i.id)));
      return options.filter((o) => o.id && !kept.has(String(o.id))).map((o) => String(o.id));
    },
    validate() {
      if (!items.length) return 'Pick at least one date.';
      for (const i of items) {
        if (items.filter((j) => j.day === i.day).length > 1 && !i.start) return `Give each time on ${fmtDay(i.day, { month: 'short', day: 'numeric' })} a start time.`;
        if (i.end && i.end === i.start) return 'A time slot cannot start and end at the same time.';
      }
      return null;
    },
  };

  renderAll();
  return api;
}
