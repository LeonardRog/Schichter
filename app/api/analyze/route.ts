import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

const client = new Anthropic();
const MIDDLEWARE_URL = 'http://159.69.153.61:3001/process';

// iOS (HEIC/HEIF), Android, and some mobile browsers send non-standard or empty MIME types.
// We accept any image/* type plus common aliases; the middleware handles conversion.
const BLOCKED_TYPES = ['application/pdf', 'text/', 'video/', 'audio/'];

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get('image') as File | null;
    const lastName = (formData.get('lastName') as string | null)?.trim();

    console.log('[analyze] Request received — lastName:', lastName, '| image present:', !!image);

    if (!image || !lastName) {
      console.log('[analyze] Validation failed: missing image or lastName');
      return NextResponse.json({ error: 'Bild und Nachname sind erforderlich.' }, { status: 400 });
    }

    console.log('[analyze] Image — name:', image.name, '| type:', image.type, '| size:', (image.size / 1024).toFixed(1), 'KB');

    // Reject clearly non-image types; allow empty/unknown (common on iOS HEIC uploads)
    const mimeType = image.type.toLowerCase();
    if (mimeType && BLOCKED_TYPES.some((t) => mimeType.startsWith(t))) {
      console.log('[analyze] Validation failed: unsupported type', image.type);
      return NextResponse.json(
        { error: 'Bitte ein Foto im Format JPEG, PNG oder HEIC hochladen.' },
        { status: 400 }
      );
    }

    if (image.size > 20 * 1024 * 1024) {
      console.log('[analyze] Validation failed: image too large', (image.size / 1024 / 1024).toFixed(2), 'MB');
      return NextResponse.json(
        { error: 'Bild zu groß. Bitte maximal 20 MB.' },
        { status: 400 }
      );
    }

    console.log('[analyze] Sending image to middleware for processing...');
    const middlewareForm = new FormData();
    middlewareForm.append('image', image);

    const middlewareRes = await fetch(MIDDLEWARE_URL, {
      method: 'POST',
      body: middlewareForm,
      signal: AbortSignal.timeout(30_000),
    });

    if (!middlewareRes.ok) {
      const errText = await middlewareRes.text().catch(() => '');
      console.error('[analyze] Middleware error:', middlewareRes.status, errText);
      return NextResponse.json(
        { error: 'Fehler bei der Bildverarbeitung. Bitte erneut versuchen.' },
        { status: 502 }
      );
    }

    const middlewareData = await middlewareRes.json();
    const base64 = middlewareData.image as string | undefined;

    if (!base64) {
      console.error('[analyze] Middleware returned no base64 data:', JSON.stringify(middlewareData));
      return NextResponse.json(
        { error: 'Fehler bei der Bildverarbeitung. Bitte erneut versuchen.' },
        { status: 502 }
      );
    }

    console.log('[analyze] Middleware processed image — base64 length:', base64.length);

    const imageContent = {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/jpeg' as const,
        data: base64,
      },
    };

    const JSON_FORMAT = `Antworte AUSSCHLIESSLICH mit diesem JSON — kein Markdown, kein erklärender Text:
{"employee":"vollständiger Name","month":"YYYY-MM","shifts":{"1":"F","2":"/","3":"S","4":"U"}}

Alle Tage des Monats müssen in "shifts" vorkommen.
Falls der Mitarbeiter nicht gefunden wird: {"error":"Mitarbeiter nicht gefunden"}
Falls kein Dienstplan erkennbar: {"error":"Kein Dienstplan erkannt"}`;

    const prompt1 = `You are analyzing a German work schedule table (Dienstplan). Find the row for "${lastName}" and extract shift codes strictly from that row only.

TABELLENSTRUKTUR:
- Spalten = Tage des Monats (1 bis 28/30/31), von links nach rechts
- Zeilen = Mitarbeiter, Name ganz links
- Suche den Nachnamen "${lastName}" in der ganz linken Spalte (Groß-/Kleinschreibung ignorieren)

HANDSCHRIFTLICHE INITIALEN — IGNORIEREN:
2–3 handgeschriebene Buchstaben neben einem Schichtcode sind Initialen des Tauschpartners — ignorieren.

SCHICHTTAUSCH: Handschriftlicher Code direkt unterhalb der gedruckten Zeile überschreibt den gedruckten Wert.

ERLAUBTE SCHICHTCODES (nur diese ausgeben): F, S, N, S1, U, /
Wenn unklar: "/" ausgeben, nicht raten.

${JSON_FORMAT}`;

    const prompt2 = `You are a careful data extractor. In this German Dienstplan table, locate "${lastName}" in the leftmost column and read each cell in that row left to right. Valid codes are F, S, N, S1, U. Empty cells or slashes are days off (output as "/").

TABELLENSTRUKTUR:
- Spalten = Tage des Monats (1 bis 28/30/31), von links nach rechts
- Zeilen = Mitarbeiter, Name ganz links
- Nachnamen "${lastName}" in der linken Spalte finden (Groß-/Kleinschreibung ignorieren)

HANDSCHRIFTLICHE INITIALEN — IGNORIEREN:
2–3 handgeschriebene Buchstaben neben einem Schichtcode sind Initialen — keine Schichtcodes, vollständig ignorieren.

SCHICHTTAUSCH: Steht handschriftlich ein Schichtcode direkt unter der gedruckten Zeile, gilt dieser statt des gedruckten.

ERLAUBTE SCHICHTCODES (nur diese ausgeben): F, S, N, S1, U, /
Bei Unklarheit "/" ausgeben.

${JSON_FORMAT}`;

    console.log('[analyze] Calling Anthropic API (two parallel passes)...');
    const [res1, res2] = await Promise.all([
      client.messages.create(
        { model: 'claude-sonnet-4-6', max_tokens: 2048, messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt1 }] }] },
        { signal: AbortSignal.timeout(55_000) }
      ),
      client.messages.create(
        { model: 'claude-sonnet-4-6', max_tokens: 2048, messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt2 }] }] },
        { signal: AbortSignal.timeout(55_000) }
      ),
    ]);

    console.log('[analyze] Pass 1 — stop_reason:', res1.stop_reason, '| usage:', JSON.stringify(res1.usage));
    console.log('[analyze] Pass 2 — stop_reason:', res2.stop_reason, '| usage:', JSON.stringify(res2.usage));

    const parsePass = (res: typeof res1, passLabel: string) => {
      const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : '';
      console.log(`[analyze] ${passLabel} raw:`, raw);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { return JSON.parse(match[0]); } catch { return null; }
    };

    const data1 = parsePass(res1, 'Pass 1');
    const data2 = parsePass(res2, 'Pass 2');

    // If either pass returned a hard error, propagate it
    const hardError = [data1, data2].find((d) => d?.error);
    if (hardError) {
      console.log('[analyze] Hard error from a pass:', hardError.error);
      return NextResponse.json(hardError);
    }

    if (!data1 && !data2) {
      console.log('[analyze] Both passes failed to return parseable JSON');
      return NextResponse.json(
        { error: 'Konnte keine Schichtdaten lesen. Bitte Foto-Qualität prüfen.' },
        { status: 500 }
      );
    }

    // Fall back to whichever pass succeeded if one failed
    const base = data1 ?? data2;
    const other = data1 && data2 ? data2 : null;

    if (!other) {
      console.log('[analyze] Only one pass succeeded, returning without uncertainty data');
      return NextResponse.json(base);
    }

    // Compare day by day
    const normalize = (v: string | undefined): string => {
      if (!v) return '/';
      const u = v.trim().toUpperCase();
      if (u === '' || u === '//' || u === '-') return '/';
      return u;
    };

    const allDays = Object.keys(base.shifts ?? {});
    const uncertain: string[] = [];
    const mergedShifts: Record<string, string> = {};

    for (const day of allDays) {
      const c1 = normalize(base.shifts[day]);
      const c2 = normalize((other.shifts ?? {})[day]);
      if (c1 === c2) {
        mergedShifts[day] = c1;
      } else {
        uncertain.push(day);
        mergedShifts[day] = c1; // pass 1 takes precedence; user will review
      }
    }

    console.log('[analyze] Uncertain days:', uncertain);

    const merged = { employee: base.employee, month: base.month, shifts: mergedShifts, uncertain };
    console.log('[analyze] Merged result:', JSON.stringify(merged));
    return NextResponse.json(merged);
  } catch (err) {
    console.error('[analyze] Error:', err);
    const isTimeout =
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message.includes('timed out'));
    return NextResponse.json(
      {
        error: isTimeout
          ? 'Die Analyse hat zu lange gedauert. Bitte ein kleineres oder klareres Foto verwenden.'
          : 'Fehler bei der Analyse. Bitte erneut versuchen.',
      },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
