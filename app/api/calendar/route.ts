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

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('gtoken')?.value;

  if (!accessToken) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }

  const { shiftData } = (await req.json()) as { shiftData: ShiftData };

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({ access_token: accessToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const [year, month] = shiftData.month.split('-').map(Number);
  let addedCount = 0;
  const errors: string[] = [];

  for (const [dayStr, rawCode] of Object.entries(shiftData.shifts)) {
    if (isOff(rawCode)) continue;

    const code = rawCode.toUpperCase();
    const shift = SHIFTS[code];
    if (!shift) continue;

    const dayNum = parseInt(dayStr, 10);
    const startDate = new Date(year, month - 1, dayNum);
    const endDate = new Date(year, month - 1, dayNum + (shift.nextDay ? 1 : 0));

    const reminders =
      shift.reminder
        ? [
            { method: 'popup' as const, minutes: 90 },
            { method: 'popup' as const, minutes: 30 },
          ]
        : [{ method: 'popup' as const, minutes: 60 }];

    const event = {
      summary: shift.title,
      description: `Schichtplan-Eintrag: ${code}`,
      start: {
        dateTime: formatLocalDateTime(startDate, shift.startTime),
        timeZone: 'Europe/Berlin',
      },
      end: {
        dateTime: formatLocalDateTime(endDate, shift.endTime),
        timeZone: 'Europe/Berlin',
      },
      reminders: {
        useDefault: false,
        overrides: reminders,
      },
    };

    try {
      await calendar.events.insert({ calendarId: 'primary', requestBody: event });
      addedCount++;
    } catch (err) {
      console.error(`Day ${dayStr} error:`, err);
      errors.push(dayStr);
    }
  }

  return NextResponse.json({ addedCount, errors });
}
