import { google } from 'googleapis';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SHIFTS, isOff } from '@/lib/shifts';

interface ShiftData {
  employee: string;
  month: string;
  shifts: Record<string, string>;
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

function formatLocalDateTime(date: Date, time: string) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}:00`;
}

function getOAuthClient(accessToken: string) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({ access_token: accessToken });
  return client;
}

function buildEvent(code: string, dayNum: number, year: number, month: number) {
  const shift = SHIFTS[code];
  if (!shift) return null;

  if (shift.allDay) {
    const dateStr = `${year}-${pad(month)}-${pad(dayNum)}`;
    return {
      summary: shift.title,
      description: `Schichtplan-Eintrag: ${code}`,
      start: { date: dateStr },
      end: { date: dateStr },
      reminders: { useDefault: false, overrides: [] as [] },
    };
  }

  const startDate = new Date(year, month - 1, dayNum);
  const endDate = new Date(year, month - 1, dayNum + (shift.nextDay ? 1 : 0));
  const reminders = shift.reminder
    ? [{ method: 'popup' as const, minutes: 90 }, { method: 'popup' as const, minutes: 30 }]
    : [{ method: 'popup' as const, minutes: 60 }];

  return {
    summary: shift.title,
    description: `Schichtplan-Eintrag: ${code}`,
    start: { dateTime: formatLocalDateTime(startDate, shift.startTime), timeZone: 'Europe/Berlin' },
    end: { dateTime: formatLocalDateTime(endDate, shift.endTime), timeZone: 'Europe/Berlin' },
    reminders: { useDefault: false, overrides: reminders },
  };
}

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('gtoken')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }

  const { shiftData } = (await req.json()) as { shiftData: ShiftData };

  const calendar = google.calendar({ version: 'v3', auth: getOAuthClient(accessToken) });

  const [year, month] = shiftData.month.split('-').map(Number);
  let addedCount = 0;
  const errors: string[] = [];
  const events: Array<{ day: string; eventId: string; code: string }> = [];

  for (const [dayStr, rawCode] of Object.entries(shiftData.shifts)) {
    if (isOff(rawCode)) continue;

    const code = rawCode.toUpperCase();
    if (!SHIFTS[code]) continue;

    const dayNum = parseInt(dayStr, 10);
    const eventBody = buildEvent(code, dayNum, year, month);
    if (!eventBody) continue;

    try {
      const result = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
      addedCount++;
      if (result.data.id) {
        events.push({ day: dayStr, eventId: result.data.id, code });
      }
    } catch (err) {
      console.error(`Day ${dayStr} error:`, err);
      errors.push(dayStr);
    }
  }

  return NextResponse.json({ addedCount, errors, events });
}

export async function PATCH(req: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('gtoken')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }

  const { eventId, newCode, day, month } = (await req.json()) as {
    eventId: string;
    newCode: string;
    day: string;
    month: string;
  };

  const code = newCode.toUpperCase();
  if (!SHIFTS[code]) {
    return NextResponse.json({ error: 'Unbekannter Schichtcode' }, { status: 400 });
  }

  const [year, monthNum] = month.split('-').map(Number);
  const dayNum = parseInt(day, 10);
  const eventBody = buildEvent(code, dayNum, year, monthNum);
  if (!eventBody) {
    return NextResponse.json({ error: 'Fehler beim Erstellen des Events' }, { status: 500 });
  }

  const calendar = google.calendar({ version: 'v3', auth: getOAuthClient(accessToken) });

  try {
    await calendar.events.update({ calendarId: 'primary', eventId, requestBody: eventBody });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Update error:', err);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren' }, { status: 500 });
  }
}
