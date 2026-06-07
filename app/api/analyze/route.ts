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

    console.log('[analyze] Calling Anthropic API...');
    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64,
                },
              },
              {
                type: 'text',
                text: `Du analysierst einen deutschen Dienstplan (Schichtplan).

TABELLENSTRUKTUR:
- Spalten = Tage des Monats (1, 2, 3, ... bis 28/30/31), von links nach rechts
- Zeilen = Mitarbeiter, jeweils mit Name in der ganz linken Spalte
- Zellen enthalten gedruckte Schichtcodes, manchmal mit handschriftlichen Ergänzungen

AUFGABE:
1. Suche in der ganz linken Spalte nach dem Nachnamen: "${lastName}"
   - Vergleiche nur den Nachnamen, ignoriere Vornamen
   - Groß-/Kleinschreibung ignorieren
2. Bestimme Monat und Jahr des Dienstplans
3. Lies jeden Schichtcode für alle Tage dieser Zeile

HANDSCHRIFTLICHE INITIALEN — IGNORIEREN:
In manchen Zellen stehen 2–3 handgeschriebene Buchstaben neben dem Schichtcode (Initialen des Tauschpartners).
Diese Initialen sind KEINE Schichtcodes — sie müssen vollständig ignoriert werden.

SCHICHTTAUSCH (handschriftliche Schichtcodes):
Wenn unterhalb der gedruckten Zeile eines Mitarbeiters handschriftliche Korrekturen erscheinen:
  - Direkt darunter (Zeile 2): neuer Schichtcode nach dem Tausch — DIESER ÜBERSCHREIBT den gedruckten Wert.
  - Noch weiter darunter (Zeile 3): Initialen des Tauschpartners — ignorieren.

ERLAUBTE SCHICHTCODES — NUR diese dürfen in der Ausgabe erscheinen:
- F  = Frühdienst
- S  = Spätdienst
- N  = Nachtdienst
- S1 = früherer Spätdienst
- U  = Urlaub (als "U" ausgeben, NICHT als "/")
- /  = frei / Wochenende (kein Urlaub)

Wenn ein Wert unklar oder nicht eindeutig lesbar ist: gib "/" aus — NICHT raten.
Gib NIEMALS andere Buchstaben oder Zeichen aus.

Antworte AUSSCHLIESSLICH mit diesem JSON — kein Markdown, kein erklärender Text:
{"employee":"vollständiger Name","month":"YYYY-MM","shifts":{"1":"F","2":"/","3":"S","4":"U"}}

Alle Tage des Monats müssen in "shifts" vorkommen.
Falls der Mitarbeiter nicht gefunden wird: {"error":"Mitarbeiter nicht gefunden"}
Falls kein Dienstplan erkennbar: {"error":"Kein Dienstplan erkannt"}`,
              },
            ],
          },
        ],
      },
      { signal: AbortSignal.timeout(55_000) }
    );

    console.log('[analyze] Anthropic response received — stop_reason:', response.stop_reason, '| usage:', JSON.stringify(response.usage));

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    console.log('[analyze] Raw response text:', raw);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[analyze] Failed to extract JSON from response');
      return NextResponse.json(
        { error: 'Konnte keine Schichtdaten lesen. Bitte Foto-Qualität prüfen.' },
        { status: 500 }
      );
    }

    const data = JSON.parse(jsonMatch[0]);
    console.log('[analyze] Parsed result:', JSON.stringify(data));
    return NextResponse.json(data);
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
