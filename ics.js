'use strict';

// iCalendar (RFC 5545) and Google Calendar links for a poll's final date.
//
// Options store wall-clock times in the poll's time zone. Timed events are
// converted to UTC here, so the file needs no VTIMEZONE block (which Outlook
// insists on for any TZID) and every client places the event correctly.

const DAY_MS = 86_400_000;

// Milliseconds the zone is ahead of UTC at the given instant.
function tzOffset(ms, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
}

// "2026-11-06" + "19:30" in Europe/Amsterdam -> the UTC instant, in ms. The
// second pass settles times near a DST switch.
function zonedToUtc(day, time, tz) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const first = wall - tzOffset(wall, tz);
  return wall - tzOffset(first, tz);
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const compactDay = (day) => day.replace(/-/g, '');
const compactUtc = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

// Start and end of the event. Without an end time it lasts an hour, and an end
// before the start means it runs past midnight.
function span(o, tz) {
  if (!o.start) return { allDay: true, start: o.day, end: addDays(o.day, 1) };
  const start = zonedToUtc(o.day, o.start, tz);
  const end = o.end ? zonedToUtc(o.end < o.start ? addDays(o.day, 1) : o.day, o.end, tz) : start + 3_600_000;
  return { allDay: false, start, end };
}

function escText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Lines longer than 75 octets are folded with CRLF + space, without splitting
// a UTF-8 sequence.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function eventDescription(poll, url) {
  return [poll.description, url].filter(Boolean).join('\n\n');
}

// One VEVENT per poll: the UID stays the same when the owner changes the final
// date, and the higher SEQUENCE tells calendars to move the existing event.
function calendarEvent({ poll, option, sequence, url, host }) {
  const s = span(option, poll.tz);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//When//Datepicker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:poll-${poll.id}@${host}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${compactUtc(Date.now())}`,
    ...(s.allDay
      ? [`DTSTART;VALUE=DATE:${compactDay(s.start)}`, `DTEND;VALUE=DATE:${compactDay(s.end)}`]
      : [`DTSTART:${compactUtc(s.start)}`, `DTEND:${compactUtc(s.end)}`]),
    `SUMMARY:${escText(poll.title)}`,
    `DESCRIPTION:${escText(eventDescription(poll, url))}`,
    `URL:${url}`,
    'STATUS:CONFIRMED',
    `TRANSP:${s.allDay ? 'TRANSPARENT' : 'OPAQUE'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// Google Calendar's "create event" page, prefilled.
function googleCalendarUrl({ poll, option, url }) {
  const s = span(option, poll.tz);
  const dates = s.allDay
    ? `${compactDay(s.start)}/${compactDay(s.end)}`
    : `${compactUtc(s.start)}/${compactUtc(s.end)}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: poll.title, dates, details: eventDescription(poll, url) });
  if (!s.allDay) params.set('ctz', poll.tz);
  return `https://calendar.google.com/calendar/render?${params}`;
}

module.exports = { calendarEvent, googleCalendarUrl, zonedToUtc };
