import {
  icon, esc, loadSession, renderHeader, loginHref, api, ApiError, toast, dateTile, fmtDay, fmtTz, yearOpt,
  localTz, timeZones, plural, relTime,
} from './common.js';
import { createPicker } from './picker.js';

const app = document.getElementById('app');
const me = await loadSession();
renderHeader(me);

if (!me.user) renderLanding();
else renderHome();

// --- Signed out ------------------------------------------------------------

function previewRow(day, time, votes, total, leading = false) {
  return `<div class="opt">
    ${dateTile(day)}
    <div>
      <div class="opt-label"><span>${esc(fmtDay(day, { weekday: 'long' }))}${time ? ` · ${esc(time)}` : ''}</span><span>${votes} of ${total}</span></div>
      <div class="bar"><div class="bar-fill" style="width:${(votes / total) * 100}%;${leading ? '' : 'background:color-mix(in oklab, var(--accent) 62%, var(--bar-track))'}"></div></div>
    </div>
  </div>`;
}

// Thursday..Saturday of next week, so the sample dates are always in order.
function upcoming(weekday) {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + (weekday - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderLanding() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">Group scheduling, minus the thread</span>
        <h1>Find the date that works for <em>everyone.</em></h1>
        <p class="lede">Pick a handful of dates, share one link, and watch the answers come in live. No more “does Thursday work?” replies piling up.</p>
        <div class="hero-cta">
          <a class="btn btn-primary btn-lg" href="${esc(loginHref('/'))}">Create a datepicker ${icon('arrowRight')}</a>
          <span class="note">Free · sign in with Freepod</span>
        </div>
      </div>
      <div class="preview-wrap"><div class="preview card" aria-hidden="true">
        <div class="preview-head">
          <h4>Team dinner</h4>
          <span class="live-pill"><span class="live-dot"></span>Live</span>
        </div>
        <div class="sub">7 people responded · pick any</div>
        ${previewRow(upcoming(4), '7:00 PM', 4, 7)}
        ${previewRow(upcoming(5), '7:30 PM', 6, 7, true)}
        ${previewRow(upcoming(6), '', 3, 7)}
      </div></div>
    </section>
    <section class="steps">
      <div class="step"><div class="step-num">i.</div><h3>Choose your dates</h3><p>Tap days on a calendar, add times if they matter, and decide whether people pick one or several.</p></div>
      <div class="step"><div class="step-num">ii.</div><h3>Share one link</h3><p>Your datepicker’s name becomes a short, readable link. Copy it into any chat.</p></div>
      <div class="step"><div class="step-num">iii.</div><h3>Watch it settle</h3><p>Votes update live for everyone. Change your mind any time, then lock in the final date.</p></div>
    </section>`;
}

// --- Signed in -------------------------------------------------------------

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function renderHome() {
  const firstName = me.user.name.split(/\s+/)[0];
  const tz = localTz();
  app.innerHTML = `
    <div class="home">
      <section>
        <h1 class="page-title">${esc(greeting())}, <em>${esc(firstName)}</em>.</h1>
        <p class="page-sub">What are we planning? Name it, pick some dates, and share the link.</p>
        <form class="composer card" novalidate>
          <div class="composer-section">
            <label class="sr-only" for="title">Name</label>
            <input class="input input-title" id="title" name="title" maxlength="120" placeholder="Team dinner, book club, Q4 offsite…" autocomplete="off" required>
            <div class="slug-field" data-slug-field>
              <span class="slug-prefix">${esc(location.host)}/</span>
              <label class="sr-only" for="slug">Link</label>
              <input id="slug" name="slug" maxlength="60" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="your-link">
              <span class="slug-status" data-slug-status></span>
            </div>
            <div class="slug-note" data-slug-note hidden></div>
            <div data-desc-wrap hidden><textarea class="textarea" name="description" maxlength="1000" placeholder="Add details: where, what to bring, anything people should know."></textarea></div>
            <div><button type="button" class="link-btn" data-add-desc>${icon('plus')}Add a description</button></div>
          </div>

          <div class="composer-section">
            <div class="section-label"><h3>How do people vote?</h3></div>
            <div class="segmented" role="radiogroup" aria-label="Voting mode">
              <label><input type="radio" name="mode" value="multi" checked><span>${icon('multi')}Pick any that work</span></label>
              <label><input type="radio" name="mode" value="single"><span>${icon('single')}Pick just one</span></label>
            </div>
          </div>

          <div class="composer-section">
            <div class="section-label">
              <h3>Dates</h3>
              <div class="tz-row">${icon('globe')}<span>Times in</span>
                <select class="select" name="tz" aria-label="Time zone">
                  ${timeZones().map((z) => `<option value="${esc(z)}" ${z === tz ? 'selected' : ''}>${esc(fmtTz(z))}</option>`).join('')}
                </select>
              </div>
            </div>
            <div data-picker></div>
          </div>

          <div class="composer-foot">
            <div class="summary" data-summary>Pick at least one date to continue.</div>
            <button class="btn btn-primary btn-lg" type="submit" data-submit disabled>Create datepicker ${icon('arrowRight')}</button>
          </div>
        </form>
      </section>
      <aside class="sidebar">
        <h2>Your datepickers <span data-count></span></h2>
        <div class="poll-list" data-list>
          <div class="skeleton" style="height:76px"></div>
          <div class="skeleton" style="height:76px"></div>
        </div>
      </aside>
    </div>`;

  // Some time zones may be missing from the list (e.g. an alias); keep the detected one selectable.
  const tzSelect = app.querySelector('[name="tz"]');
  if (![...tzSelect.options].some((o) => o.value === tz)) {
    tzSelect.insertAdjacentHTML('afterbegin', `<option value="${esc(tz)}" selected>${esc(fmtTz(tz))}</option>`);
  }

  setupComposer(app.querySelector('.composer'));
  loadMine();
}

function setupComposer(form) {
  const title = form.querySelector('#title');
  const slug = form.querySelector('#slug');
  const slugField = form.querySelector('[data-slug-field]');
  const slugStatus = form.querySelector('[data-slug-status]');
  const slugNote = form.querySelector('[data-slug-note]');
  const submit = form.querySelector('[data-submit]');
  const summary = form.querySelector('[data-summary]');
  let slugTouched = false;
  let slugState = 'empty'; // empty | checking | ok | taken | invalid
  let checkSeq = 0;
  let checkTimer;

  const picker = createPicker(form.querySelector('[data-picker]'), { onChange: update });

  form.querySelector('[data-add-desc]').addEventListener('click', (e) => {
    form.querySelector('[data-desc-wrap]').hidden = false;
    e.currentTarget.parentElement.hidden = true;
    form.querySelector('[name="description"]').focus();
  });

  function slugify(s) {
    return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  }

  function setSlugState(state, suggestion) {
    slugState = state;
    slugField.classList.toggle('is-taken', state === 'taken' || state === 'invalid');
    const map = {
      empty: '',
      checking: `<span class="slug-status busy">${icon('spinner')}</span>`,
      ok: `${icon('check')}Available`,
      taken: `${icon('x')}Taken`,
      invalid: `${icon('x')}Invalid`,
    };
    slugStatus.className = `slug-status ${state === 'ok' ? 'ok' : state === 'checking' ? 'busy' : state === 'empty' ? '' : 'bad'}`;
    slugStatus.innerHTML = state === 'checking' ? icon('spinner') : map[state];
    if (state === 'taken' && suggestion) {
      slugNote.hidden = false;
      slugNote.innerHTML = `That link is already in use. <button type="button" data-use="${esc(suggestion)}">Use ${esc(suggestion)}</button>`;
    } else if (state === 'invalid') {
      slugNote.hidden = false;
      slugNote.textContent = 'Use lowercase letters, numbers and dashes.';
    } else {
      slugNote.hidden = true;
    }
    update();
  }

  slugNote.addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (!b) return;
    slug.value = b.dataset.use;
    slugTouched = true;
    checkSlug();
  });

  function checkSlug() {
    clearTimeout(checkTimer);
    const value = slug.value;
    if (!value) return setSlugState('empty');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(value)) return setSlugState('invalid');
    setSlugState('checking');
    const seq = ++checkSeq;
    checkTimer = setTimeout(async () => {
      try {
        const r = await api('GET', `/api/slug-check?slug=${encodeURIComponent(value)}`);
        if (seq !== checkSeq) return;
        if (!r.valid) return setSlugState('invalid');
        if (r.available) return setSlugState('ok');
        if (!slugTouched) {
          // Auto-generated slug collided: quietly take the suggestion.
          slug.value = r.suggestion;
          return setSlugState('ok');
        }
        setSlugState('taken', r.suggestion);
      } catch {
        if (seq === checkSeq) setSlugState('empty');
      }
    }, 280);
  }

  title.addEventListener('input', () => {
    if (!slugTouched) {
      slug.value = slugify(title.value);
      checkSlug();
    }
    update();
  });

  slug.addEventListener('input', () => {
    const pos = slug.selectionStart;
    const cleaned = slug.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/--+/g, '-');
    if (cleaned !== slug.value) { slug.value = cleaned; slug.setSelectionRange(pos, pos); }
    slugTouched = slug.value !== '';
    if (!slugTouched) slug.value = slugify(title.value);
    checkSlug();
  });

  function update() {
    const opts = picker.getOptions();
    const err = picker.validate();
    const ready = title.value.trim() && slugState === 'ok' && !err;
    submit.disabled = !ready;
    if (!title.value.trim()) summary.textContent = 'Start by giving it a name.';
    else if (!opts.length) summary.textContent = 'Now pick at least one date.';
    else if (err) summary.textContent = err;
    else {
      const days = new Set(opts.map((o) => o.day)).size;
      summary.innerHTML = `<strong>${plural(opts.length, 'option')}</strong> across ${plural(days, 'day')}`;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    submit.innerHTML = `${icon('spinner')}Creating…`;
    try {
      const r = await api('POST', '/api/polls', {
        title: title.value,
        slug: slug.value,
        description: form.querySelector('[name="description"]').value,
        multi: form.querySelector('[name="mode"]:checked').value === 'multi',
        tz: form.querySelector('[name="tz"]').value,
        options: picker.getOptions(),
      });
      sessionStorage.setItem('when:new', r.slug);
      location.href = `/${r.slug}`;
    } catch (err) {
      submit.innerHTML = `Create datepicker ${icon('arrowRight')}`;
      if (err instanceof ApiError && err.status === 409 && err.body?.suggestion) {
        slugTouched = true;
        setSlugState('taken', err.body.suggestion);
      } else if (err.status !== 401) {
        toast(err.message, { type: 'error' });
      }
      update();
    }
  });

  update();
}

async function loadMine() {
  const list = app.querySelector('[data-list]');
  const count = app.querySelector('[data-count]');
  try {
    const { polls } = await api('GET', '/api/mine');
    count.textContent = polls.length ? String(polls.length) : '';
    if (!polls.length) {
      list.innerHTML = `<div class="list-empty">Datepickers you create or vote in will show up here.</div>`;
      return;
    }
    list.innerHTML = polls.map((p) => {
      const range = p.firstDay
        ? p.firstDay === p.lastDay
          ? fmtDay(p.firstDay, { month: 'short', day: 'numeric', year: yearOpt(p.firstDay) })
          : `${fmtDay(p.firstDay, { month: 'short', day: 'numeric', year: p.firstDay.slice(0, 4) !== p.lastDay.slice(0, 4) ? 'numeric' : undefined })} – ${fmtDay(p.lastDay, { month: 'short', day: 'numeric', year: yearOpt(p.lastDay) })}`
        : '';
      const status = p.decided
        ? `<span class="badge badge-good">${icon('check')}Decided</span>`
        : p.closed
          ? `<span class="badge badge-muted">${icon('lock')}Closed</span>`
          : p.voted || p.owned ? '' : `<span class="badge badge-accent">Your vote needed</span>`;
      return `<a class="poll-item" href="/${esc(p.slug)}">
        <div class="poll-item-title">${esc(p.title)}</div>
        <div class="poll-item-meta">
          <span>${icon('calendar')}${esc(range)}</span>
          <span>${icon('users')}${p.participantCount}</span>
          <span>${p.owned ? 'Yours' : `by ${esc(p.ownerName)}`} · ${esc(relTime(p.updatedAt))}</span>
          ${status}
        </div>
      </a>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<div class="list-empty">Couldn’t load your datepickers.</div>`;
  }
}
