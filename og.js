'use strict';

// Open Graph preview images (1200×630 PNG), rendered with satori (layout →
// SVG) and resvg (SVG → PNG). Link unfurlers like Slack, WhatsApp, iMessage
// and X do not accept SVG, hence the rasterization.

const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const W = 1200;
const H = 630;

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
  accentSoft: '#f8e4d9',
  accentMid: '#de8a6a',
  track: '#ede6da',
  good: '#2c7a55',
  goodSoft: '#e1f0e7',
};

let satoriPromise;
let fonts;

function loadFonts() {
  if (fonts) return fonts;
  const file = (pkg, name) => fs.readFileSync(path.join(__dirname, 'node_modules', '@fontsource', pkg, 'files', name));
  fonts = [];
  // latin first, then latin-ext as glyph fallback (satori tries fonts in order).
  for (const subset of ['latin', 'latin-ext']) {
    for (const weight of [400, 500, 600]) {
      fonts.push({ name: 'Inter', weight, style: 'normal', data: file('inter', `inter-${subset}-${weight}-normal.woff`) });
      fonts.push({ name: 'Fraunces', weight, style: 'normal', data: file('fraunces', `fraunces-${subset}-${weight}-normal.woff`) });
      fonts.push({ name: 'Fraunces', weight, style: 'italic', data: file('fraunces', `fraunces-${subset}-${weight}-italic.woff`) });
    }
  }
  return fonts;
}

// Minimal element builder in the shape satori expects.
function h(type, style, ...children) {
  const flat = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const props = { style: { display: 'flex', ...style } };
  if (type === 'img') {
    Object.assign(props, style.__img);
    delete props.style.__img;
  } else if (flat.length) {
    props.children = flat.length === 1 ? flat[0] : flat;
  }
  return { type, props };
}

const text = (style, s) => h('div', style, String(s));

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${C.accent}"/><rect x="14" y="18" width="36" height="32" rx="5" fill="none" stroke="#FFF8F1" stroke-width="4"/><path d="M14 27h36M24 13v9M40 13v9" stroke="#FFF8F1" stroke-width="4" stroke-linecap="round"/><path d="m25 38 5 5 10-10" fill="none" stroke="#FFF8F1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MARK_SRC = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString('base64')}`;

function brand(host) {
  return h('div', { alignItems: 'center', gap: 14 },
    h('img', { width: 44, height: 44, __img: { src: MARK_SRC, width: 44, height: 44 } }),
    h('div', { fontFamily: 'Fraunces', fontWeight: 600, fontSize: 34, color: C.ink, letterSpacing: -0.5 },
      'When',
      text({ fontStyle: 'italic', fontWeight: 400, color: C.accent }, '?')),
    host ? text({ marginLeft: 10, fontSize: 22, color: C.muted, fontFamily: 'Inter' }, host) : null,
  );
}

function pill(label, fg, bg) {
  return h('div', { alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 999, background: bg, color: fg, fontSize: 22, fontWeight: 600, fontFamily: 'Inter' },
    h('div', { width: 10, height: 10, borderRadius: 999, background: fg }),
    label);
}

const fmt = (day, opts) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

function fmtTime(t) {
  const [hh, mm] = t.split(':').map(Number);
  return new Date(Date.UTC(2000, 0, 1, hh, mm)).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
}

function optionLabel(o) {
  const day = fmt(o.day, { weekday: 'long', month: 'long', day: 'numeric' });
  if (!o.start) return day;
  return `${day} · ${fmtTime(o.start)}${o.end ? ` – ${fmtTime(o.end)}` : ''}`;
}

function dateTile(day, size = 76) {
  return h('div', { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: size, height: size + 6, borderRadius: 14, background: C.sunken, fontFamily: 'Inter', flexShrink: 0 },
    text({ fontSize: 15, fontWeight: 600, letterSpacing: 1.5, color: C.accentInk }, fmt(day, { weekday: 'short' }).toUpperCase()),
    text({ fontFamily: 'Fraunces', fontSize: 32, fontWeight: 500, color: C.ink, lineHeight: 1.1 }, fmt(day, { day: 'numeric' })),
    text({ fontSize: 14, fontWeight: 600, letterSpacing: 1.2, color: C.muted }, fmt(day, { month: 'short' }).toUpperCase()),
  );
}

function shell(children) {
  return h('div', { width: W, height: H, flexDirection: 'column', padding: '50px 72px 56px', background: C.bg, fontFamily: 'Inter', color: C.ink }, children);
}

function pollTree(poll, host) {
  const total = poll.participants.length;
  const final = poll.options.find((o) => o.id === poll.finalOptionId);
  const status = final
    ? pill('Decided', C.good, C.goodSoft)
    : poll.closed ? pill('Voting closed', C.muted, C.sunken) : pill('Open for votes', C.accent, C.accentSoft);
  const titleSize = poll.title.length > 48 ? 54 : poll.title.length > 28 ? 64 : 76;
  const byline = [
    `by ${poll.owner.name}`,
    `${poll.options.length} ${poll.options.length === 1 ? 'option' : 'options'}`,
    total ? `${total} ${total === 1 ? 'person' : 'people'} responded` : 'Be the first to respond',
  ].join('  ·  ');

  // Busiest options first once people have voted; otherwise chronological.
  const ranked = [...poll.options].sort((a, b) => b.voters.length - a.voters.length || a.day.localeCompare(b.day));
  // A title long enough to wrap to two lines leaves room for two rows only.
  const rows = poll.title.length > 28 ? 2 : 3;
  const shown = total ? ranked.slice(0, rows) : poll.options.slice(0, rows);
  const rest = final ? 0 : poll.options.length - shown.length;

  let body;
  if (final) {
    body = h('div', { alignItems: 'center', gap: 28, padding: '28px 32px', borderRadius: 22, background: C.goodSoft, border: `2px solid #b9dcc8` },
      dateTile(final.day, 84),
      h('div', { flexDirection: 'column', gap: 6 },
        text({ fontSize: 24, color: C.good, fontWeight: 600 }, 'It’s decided'),
        text({ fontFamily: 'Fraunces', fontSize: 44, fontWeight: 500, color: C.ink }, optionLabel(final))));
  } else {
    const max = Math.max(0, ...poll.options.map((o) => o.voters.length));
    body = h('div', { flexDirection: 'column', gap: 14 },
      shown.map((o) => {
        const n = o.voters.length;
        const leading = n > 0 && n === max;
        return h('div', { alignItems: 'center', gap: 22, padding: '14px 22px 14px 14px', borderRadius: 18, background: C.surface, border: `1.5px solid ${C.line}` },
          dateTile(o.day, 58),
          h('div', { flexDirection: 'column', flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 10 },
            h('div', { justifyContent: 'space-between', alignItems: 'baseline' },
              text({ fontSize: 25, fontWeight: 600, color: C.ink }, optionLabel(o)),
              total ? text({ fontSize: 22, color: C.muted }, `${n} of ${total}`) : null),
            h('div', { height: 12, borderRadius: 999, background: C.track, width: '100%', overflow: 'hidden' },
              h('div', { height: 12, borderRadius: 999, width: `${total ? Math.max((n / total) * 100, n ? 2 : 0) : 0}%`, background: leading ? C.accent : C.accentMid }))));
      }));
  }

  return shell([
    h('div', { justifyContent: 'space-between', alignItems: 'center' }, brand(host), status),
    h('div', { flexDirection: 'column', marginTop: 30, marginBottom: 24 },
      h('div', { fontFamily: 'Fraunces', fontWeight: 500, fontSize: titleSize, lineHeight: 1.08, letterSpacing: -1.2, color: C.ink, display: 'block', lineClamp: 2 }, poll.title),
      h('div', { marginTop: 16, justifyContent: 'space-between', alignItems: 'baseline', fontSize: 24 },
        text({ color: C.ink2 }, byline),
        rest > 0 ? text({ color: C.muted }, `+ ${rest} more ${rest === 1 ? 'date' : 'dates'}`) : null)),
    h('div', { flexDirection: 'column', marginTop: 'auto' }, body),
  ]);
}

function homeTree(host) {
  const bar = (label, n, leading) => h('div', { flexDirection: 'column', gap: 8 },
    h('div', { justifyContent: 'space-between' },
      text({ fontSize: 21, fontWeight: 600 }, label),
      text({ fontSize: 19, color: C.muted }, `${n} of 7`)),
    h('div', { height: 11, borderRadius: 999, background: C.track, width: '100%' },
      h('div', { height: 11, borderRadius: 999, width: `${(n / 7) * 100}%`, background: leading ? C.accent : C.accentMid })));
  return shell([
    h('div', { justifyContent: 'space-between', alignItems: 'center' }, brand(), text({ fontSize: 22, color: C.muted }, host)),
    h('div', { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between' },
      h('div', { flexDirection: 'column', width: 590 },
        text({ fontSize: 18, fontWeight: 600, letterSpacing: 2.5, color: C.accentInk }, 'GROUP SCHEDULING, MINUS THE THREAD'),
        h('div', { flexDirection: 'column', marginTop: 18, fontFamily: 'Fraunces', fontWeight: 400, fontSize: 70, lineHeight: 1.04, letterSpacing: -1.5, color: C.ink },
          text({}, 'Find the date'),
          text({}, 'that works for'),
          text({ fontStyle: 'italic', color: C.accent }, 'everyone.')),
        text({ marginTop: 24, fontSize: 24, lineHeight: 1.45, color: C.ink2 }, 'Pick a few dates, share the link, and watch the answers come in live.')),
      h('div', { flexDirection: 'column', gap: 18, width: 420, padding: 30, borderRadius: 22, background: C.surface, border: `1.5px solid ${C.line}`, transform: 'rotate(-2deg)', boxShadow: '0 24px 48px -20px rgba(40,28,12,0.25)' },
        h('div', { justifyContent: 'space-between', alignItems: 'center' },
          text({ fontFamily: 'Fraunces', fontSize: 30, fontWeight: 600 }, 'Team dinner'),
          h('div', { alignItems: 'center', gap: 8, color: C.good, fontSize: 18, fontWeight: 600 }, h('div', { width: 9, height: 9, borderRadius: 999, background: C.good }), 'Live')),
        bar('Thursday · 7:00 PM', 4, false),
        bar('Friday · 7:30 PM', 6, true),
        bar('Saturday', 3, false))),
  ]);
}

// Emoji are not in the text fonts, so satori asks for them as images. They come
// from Twemoji (pinned) and are cached; on failure the emoji is simply omitted.
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@16.0.1/assets/svg';
const emojiCache = new Map();

function twemojiCode(segment) {
  const cps = [...segment].map((c) => c.codePointAt(0).toString(16));
  // Twemoji file names drop the VS16 selector unless the sequence has a ZWJ.
  return (cps.includes('200d') ? cps : cps.filter((c) => c !== 'fe0f')).join('-');
}

async function loadEmoji(segment) {
  const code = twemojiCode(segment);
  if (!emojiCache.has(code)) {
    emojiCache.set(code, (async () => {
      try {
        const res = await fetch(`${TWEMOJI}/${code}.svg`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) return '';
        return `data:image/svg+xml;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
      } catch {
        emojiCache.delete(code); // transient: retry on a later render
        return '';
      }
    })());
  }
  return emojiCache.get(code);
}

async function render(tree) {
  satoriPromise ??= import('satori').then((m) => m.default);
  const satori = await satoriPromise;
  const svg = await satori(tree, {
    width: W,
    height: H,
    fonts: loadFonts(),
    loadAdditionalAsset: async (kind, segment) => (kind === 'emoji' ? loadEmoji(segment) : []),
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
}

// Small in-memory cache keyed by slug + version; a new vote bumps the version
// and therefore the image URL, so stale entries simply age out.
const cache = new Map();
const CACHE_MAX = 200;

async function cached(key, build) {
  if (cache.has(key)) {
    const v = cache.get(key);
    cache.delete(key);
    cache.set(key, v);
    return v;
  }
  const png = await build();
  cache.set(key, png);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return png;
}

module.exports = {
  OG_WIDTH: W,
  OG_HEIGHT: H,
  pollImage: (poll, host) => cached(`poll:${poll.slug}:${poll.version}`, () => render(pollTree(poll, host))),
  homeImage: (host) => cached(`home:${host}`, () => render(homeTree(host))),
};
