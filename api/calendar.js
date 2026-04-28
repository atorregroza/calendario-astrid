export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://brlgvyweuoyjdgjovkqf.supabase.co';

export default async function handler(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('t');
  if (!token) return new Response('Missing token', { status: 400 });

  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!KEY) return new Response('Server misconfigured', { status: 500 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/calendar_data?ics_token=eq.${encodeURIComponent(token)}&select=data,birthdays,fuera_ciudad`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );

  if (!res.ok) return new Response('Upstream error', { status: 502 });
  const rows = await res.json();
  if (!rows.length) return new Response('Invalid token', { status: 404 });

  const ics = buildIcs(rows[0]);
  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': 'inline; filename="calendar.ics"',
    },
  });
}

const STATUS_PREFIX = { done: '[OK] ', cancelled: '[X] ', postponed: '[~] ' };

function buildIcs(row) {
  const data = row.data || {};
  const birthdays = row.birthdays || [];
  const fueraCiudad = row.fuera_ciudad || [];
  const dtstamp = utcStamp(new Date());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//calendario-astrid-marcela//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const dayKey in data) {
    const day = data[dayKey];
    if (!day || !Array.isArray(day.activities)) continue;
    const prefix = STATUS_PREFIX[day.status] || '';
    for (let i = 0; i < day.activities.length; i++) {
      const act = day.activities[i];
      if (!act || !act.text || !String(act.text).trim()) continue;
      const summary = prefix + String(act.text).trim();
      const uid = `act-${dayKey}-${i}@calendario`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      if (act.time && /^\d{1,2}:\d{2}$/.test(act.time)) {
        const [hStr, mStr] = act.time.split(':');
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        const startLocal = `${dayKey.replace(/-/g, '')}T${pad(h)}${pad(m)}00`;
        const endDate = addMinutes(dayKey, h, m, 60);
        lines.push(`DTSTART:${startLocal}`);
        lines.push(`DTEND:${endDate}`);
      } else {
        const ymd = dayKey.replace(/-/g, '');
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
        lines.push(`DTEND;VALUE=DATE:${nextDay(dayKey)}`);
      }
      lines.push(`SUMMARY:${escapeIcs(summary)}`);
      if (day.generalNote && String(day.generalNote).trim()) {
        lines.push(`DESCRIPTION:${escapeIcs(day.generalNote)}`);
      }
      lines.push('END:VEVENT');
    }
  }

  for (let i = 0; i < birthdays.length; i++) {
    const b = birthdays[i];
    if (!b || !b.name || !b.day || !b.month) continue;
    const mm = pad(b.month);
    const dd = pad(b.day);
    const baseYear = '2000';
    const start = `${baseYear}${mm}${dd}`;
    const end = nextDay(`${baseYear}-${mm}-${dd}`);
    const safeName = String(b.name).replace(/[^a-z0-9]/gi, '').toLowerCase() || 'x';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:bday-${i}-${safeName}@calendario`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`SUMMARY:${escapeIcs('Cumpleanos: ' + b.name)}`);
    lines.push('RRULE:FREQ=YEARLY');
    lines.push('END:VEVENT');
  }

  for (let i = 0; i < fueraCiudad.length; i++) {
    const f = fueraCiudad[i];
    if (!f || !f.lugar || !f.desde || !f.hasta) continue;
    const start = f.desde.replace(/-/g, '');
    const end = nextDay(f.hasta);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:fuera-${i}-${start}@calendario`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(`SUMMARY:${escapeIcs('Fuera de ciudad: ' + f.lugar)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function pad(n) { return String(n).padStart(2, '0'); }

function escapeIcs(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function utcStamp(d) {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) + 'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) + 'Z'
  );
}

function nextDay(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 1);
  return (
    date.getUTCFullYear() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate())
  );
}

function addMinutes(dateStr, h, m, addMin) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const date = new Date(y, mo - 1, d, h, m + addMin, 0);
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) + 'T' +
    pad(date.getHours()) +
    pad(date.getMinutes()) + '00'
  );
}
