// US Catholic liturgical calendar -> .ics (Google Calendar / Outlook / Apple)
// Usage:  node generate.mjs [fromYear] [toYear]      e.g. node generate.mjs 2026 2030
// Output: dist/us-catholic-calendar.ics             (everything: saints, Sundays, seasons)
//         dist/us-catholic-calendar-essentials.ics  (no memorials / optional memorials)
//
// Source: romcal 3.0.0-dev.140 + @romcal/calendar.united-states (same data as the Notion DB),
// plus the correction layer below, because romcal has known bugs.

import { Romcal } from 'romcal';
import { UnitedStates_En } from '@romcal/calendar.united-states';
import { mkdirSync, writeFileSync } from 'node:fs';

const FROM = Number(process.argv[2] ?? 2026);
const TO = Number(process.argv[3] ?? 2030);

const romcal = new Romcal({
  localizedCalendar: UnitedStates_En,
  scope: 'gregorian',
  epiphanyOnSunday: true,
  corpusChristiOnSunday: true,
  ascensionOnSunday: true,
});

// ---------- vocab ----------
const RANK = {
  SOLEMNITY: 'Solemnity', FEAST: 'Feast', MEMORIAL: 'Memorial',
  OPTIONAL_MEMORIAL: 'Optional Memorial', SUNDAY: 'Sunday', WEEKDAY: 'Weekday',
};
const COLOR = { WHITE: 'White', RED: 'Red', GREEN: 'Green', PURPLE: 'Purple', ROSE: 'Rose', BLACK: 'Black', GOLD: 'Gold' };
const DOT = { White: '⚪', Red: '🔴', Green: '🟢', Purple: '🟣', Rose: '🌸', Black: '⚫', Gold: '🟡' };
const CYCLE = { YEAR_A: 'Year A', YEAR_B: 'Year B', YEAR_C: 'Year C' };
const SEASON = {
  ADVENT: ['Advent', 'Purple'], CHRISTMAS_TIME: ['Christmas Season', 'White'],
  ORDINARY_TIME: ['Ordinary Time', 'Green'], LENT: ['Lent', 'Purple'],
  PASCHAL_TRIDUUM: ['Sacred Paschal Triduum', 'Red'], EASTER_TIME: ['Easter Season', 'White'],
};
const OBSERVANCES = new Set(['independence_day', 'thanksgiving_day', 'day_of_prayer_for_the_legal_protection_of_unborn_children']);

// Fixed-date solemnities that must appear unless a Sunday / Holy Week / Easter octave moves them.
const FIXED_SOLEMNITIES = {
  '01-01': 'mary_mother_of_god',
  '03-19': 'joseph_spouse_of_mary',
  '03-25': 'annunciation_of_the_lord',
  '06-24': 'nativity_of_john_the_baptist',
  '06-29': 'peter_and_paul_apostles',
  '08-15': 'assumption_of_the_blessed_virgin_mary',
  '11-01': 'all_saints',
  '12-08': 'immaculate_conception_of_the_blessed_virgin_mary',
  '12-25': 'nativity_of_the_lord',
};

// Reference name/color for each fixed solemnity, taken from a year where romcal gets it right.
const REFERENCE = {};
{
  const ref = await romcal.generateCalendar(2026);
  for (const d of Object.values(ref).flat())
    if (Object.values(FIXED_SOLEMNITIES).includes(d.id)) REFERENCE[d.id] = { name: String(d.name), color: COLOR[d.colors[0]] };
}

// ---------- helpers ----------
const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 = Sunday
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ymd = (iso) => iso.replaceAll('-', '');

function holyDayOfObligation(c) {
  // US norms (USCCB 1991 + Ascension transferred to Sunday in almost all provinces).
  const md = c.date.slice(5), w = dow(c.date);
  if (c.id === 'nativity_of_the_lord') return true;
  if (c.id === 'immaculate_conception_of_the_blessed_virgin_mary') return md === '12-08'; // obligation not transferred to Dec 9
  if (['mary_mother_of_god', 'assumption_of_the_blessed_virgin_mary', 'all_saints'].includes(c.id)) return w !== 1 && w !== 6; // abrogated on Sat/Mon
  return false;
}

const keep = (d) => {
  if (OBSERVANCES.has(d.id)) return true;
  if (d.rank !== 'WEEKDAY') return true;
  if (d.id === 'ash_wednesday') return true;
  if (/^holy_week_|^holy_(monday|tuesday|wednesday)$/.test(d.id)) return true;
  if (d.id === 'holy_thursday') return false; // the "Lord's Supper" entry covers the evening
  return d.seasons.includes('PASCHAL_TRIDUUM');
};

function rankLabel(d) {
  if (OBSERVANCES.has(d.id)) return 'Observance';
  if (d.seasons.includes('PASCHAL_TRIDUUM') && !d.seasons.includes('EASTER_TIME')) return 'Triduum';
  if (d.id === 'ash_wednesday') return 'Ash Wednesday';
  if (d.rank === 'WEEKDAY') return 'Holy Week';
  return RANK[d.rank] ?? d.rank;
}

// ---------- build ----------
const corrections = [];
const warnings = [];
const events = [];
const seasonByDate = {};

for (let y = FROM - 1; y <= TO + 1; y++) {
  const cal = await romcal.generateCalendar(y);
  for (const [date, days] of Object.entries(cal)) {
    const s = days[0].seasons.includes('EASTER_TIME') ? 'EASTER_TIME' : days[0].seasons[0];
    seasonByDate[date] = s;
    if (y < FROM || y > TO) continue;

    let rows = days.filter(keep).map((d) => ({
      id: d.id,
      date,
      name: String(d.name), // name is a getter
      rank: rankLabel(d),
      romcalRank: d.rank,
      color: COLOR[d.colors?.[0]] ?? 'White',
      altColor: COLOR[d.colors?.[1]],
      cycle: CYCLE[d.cycles?.sundayCycle],
    }));

    // Correction 1: a fixed solemnity may never be dropped in favour of a memorial (romcal bug, e.g. 2028-06-24).
    const md = date.slice(5);
    const fixedId = FIXED_SOLEMNITIES[md];
    if (fixedId && !rows.some((r) => r.romcalRank === 'SOLEMNITY')) {
      const blockers = rows.filter((r) => ['SUNDAY', 'WEEKDAY'].includes(r.romcalRank));
      const otherDayHasIt = Object.values(cal).flat().some((d) => d.id === fixedId);
      if (!blockers.length && !otherDayHasIt) {
        const ref = REFERENCE[fixedId];
        if (!ref) { warnings.push(`${date}: ${fixedId} missing, no automatic fix`); }
        else {
          const fixName = ref.name;
          const dropped = rows.filter((r) => ['MEMORIAL', 'OPTIONAL_MEMORIAL'].includes(r.romcalRank)).map((r) => r.name);
          rows = rows.filter((r) => !['MEMORIAL', 'OPTIONAL_MEMORIAL'].includes(r.romcalRank));
          rows.push({ id: fixedId, date, name: fixName, rank: 'Solemnity', romcalRank: 'SOLEMNITY', color: ref.color, cycle: rows[0]?.cycle ?? CYCLE[days[0].cycles.sundayCycle] });
          corrections.push(`${date}: restored "${fixName}" (Solemnity); removed impeded ${dropped.join(', ') || 'nothing'}`);
        }
      }
    }
    // Correction 2: memorials are impeded by a solemnity on the same day.
    if (rows.some((r) => r.romcalRank === 'SOLEMNITY')) {
      const impeded = rows.filter((r) => ['MEMORIAL', 'OPTIONAL_MEMORIAL'].includes(r.romcalRank) && !OBSERVANCES.has(r.id));
      if (impeded.length) {
        rows = rows.filter((r) => !impeded.includes(r));
        corrections.push(`${date}: removed ${impeded.map((r) => r.name).join(', ')} (impeded by a solemnity)`);
      }
    }

    for (const r of rows) events.push(r);
  }
}

// Season bands (computed over FROM-1..TO+1 so ranges crossing Jan 1 are not clipped).
const seasonBands = [];
const dates = Object.keys(seasonByDate).sort();
let cur = null;
for (const d of dates) {
  const s = seasonByDate[d];
  if (cur && cur.season === s && addDays(cur.end, 1) === d) cur.end = d;
  else { if (cur) seasonBands.push(cur); cur = { season: s, start: d, end: d }; }
}
if (cur) seasonBands.push(cur);
const bandsInRange = seasonBands.filter((b) => b.start >= `${FROM}-01-01` && b.start <= `${TO}-12-31`
  || (b.start < `${FROM}-01-01` && b.end >= `${FROM}-01-01`));

// ---------- sanity checks ----------
for (let y = FROM; y <= TO; y++) {
  for (const [md, id] of Object.entries(FIXED_SOLEMNITIES)) {
    if (!events.some((e) => e.id === id && e.date.startsWith(String(y))))
      warnings.push(`${y}: ${id} not found anywhere in the year`);
  }
  const sundays = events.filter((e) => e.date.startsWith(String(y)) && dow(e.date) === 0
    && ['Sunday', 'Solemnity', 'Feast'].includes(e.rank)).map((e) => e.date);
  const allSundays = []; for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = addDays(d, 1)) if (dow(d) === 0) allSundays.push(d);
  const missing = allSundays.filter((d) => !sundays.includes(d));
  if (missing.length) warnings.push(`${y}: Sundays with no celebration: ${missing.join(', ')}`);
}

// ---------- ICS ----------
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function fold(line) {
  const out = []; let buf = ''; let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(buf); buf = ''; bytes = 0; }
    buf += ch; bytes += b;
  }
  out.push(buf);
  return out.join('\r\n ');
}
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function vevent({ uid, start, endExclusive, summary, description, categories }) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${STAMP}`,
    `DTSTART;VALUE=DATE:${ymd(start)}`,
    `DTEND;VALUE=DATE:${ymd(endExclusive)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `CATEGORIES:${esc(categories)}`,
    'TRANSP:TRANSPARENT', // never blocks free/busy in Outlook
    'CLASS:PUBLIC',
    'END:VEVENT',
  ].map(fold).join('\r\n');
}

function buildIcs(name, filter) {
  const body = [];
  for (const e of events.filter(filter)) {
    const hdo = e.rank === 'Solemnity' && holyDayOfObligation(e);
    const desc = [
      `Rank: ${e.rank}`,
      `Liturgical color: ${e.color}${e.altColor ? ` (or ${e.altColor})` : ''}`,
      e.cycle ? `Sunday cycle: ${e.cycle}` : null,
      hdo ? 'Holy Day of Obligation (US)' : null,
    ].filter(Boolean).join('\n');
    body.push(vevent({
      uid: `${e.date}-${e.id}@us-catholic-calendar`,
      start: e.date,
      endExclusive: addDays(e.date, 1),
      summary: `${DOT[e.color] ?? ''} ${e.name}${hdo ? ' ⛪' : ''}`.trim(),
      description: desc,
      categories: e.rank,
    }));
  }
  for (const b of bandsInRange) {
    const [label, color] = SEASON[b.season];
    body.push(vevent({
      uid: `${b.start}-season-${b.season.toLowerCase()}@us-catholic-calendar`,
      start: b.start,
      endExclusive: addDays(b.end, 1),
      summary: `${DOT[color]} ${label}`,
      description: `Liturgical season: ${label}\n${b.start} to ${b.end}`,
      categories: 'Season',
    }));
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//us-catholic-calendar//romcal 3.0.0-dev.140//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${name}`,
    'X-WR-CALDESC:Roman Rite (Ordinary Form)\\, USCCB proper calendar. Generated from romcal.',
    'X-PUBLISHED-TTL:P7D',
    'REFRESH-INTERVAL;VALUE=DURATION:P7D',
    ...body,
    'END:VCALENDAR',
    '',
  ].flatMap((s) => s.split('\r\n')).map(fold).join('\r\n');
}

mkdirSync('dist', { recursive: true });
const full = buildIcs('Catholic Calendar (US)', () => true);
const essentials = buildIcs('Catholic Calendar (US) – Essentials',
  (e) => !['Memorial', 'Optional Memorial'].includes(e.rank));
writeFileSync('dist/us-catholic-calendar.ics', full);
writeFileSync('dist/us-catholic-calendar-essentials.ics', essentials);
writeFileSync('dist/events.json', JSON.stringify(events, null, 1));

const count = (s) => (s.match(/BEGIN:VEVENT/g) || []).length;
console.log(`Years ${FROM}-${TO}`);
console.log(`Full: ${count(full)} events | Essentials: ${count(essentials)} events | Season bands: ${bandsInRange.length}`);
for (let y = FROM; y <= TO; y++) console.log(`  ${y}: ${events.filter((e) => e.date.startsWith(String(y))).length} day events`);
console.log(`\nCorrections (${corrections.length}):\n  ` + corrections.join('\n  '));
console.log(`\nWarnings (${warnings.length}):\n  ` + (warnings.join('\n  ') || 'none'));
