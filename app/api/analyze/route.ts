import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import sharp from 'sharp';

export const maxDuration = 60;

const client = new Anthropic();

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedType = (typeof ALLOWED_TYPES)[number];

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get('image') as File | null;
    const lastName = (formData.get('lastName') as string | null)?.trim();

    if (!image || !lastName) {
      return NextResponse.json({ error: 'Bild und Nachname sind erforderlich.' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(image.type as AllowedType)) {
      return NextResponse.json(
        { error: 'Nur JPEG, PNG, GIF oder WebP erlaubt.' },
        { status: 400 }
      );
    }

    if (image.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'Bild zu groß. Bitte maximal 5 MB.' },
        { status: 400 }
      );
    }

    const rawBuffer = Buffer.from(await image.arrayBuffer());
    const compressed = await sharp(rawBuffer)
      .resize({ width: 1500, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const base64 = compressed.toString('base64');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

Das Bild zeigt eine Tabelle:
- Linke Spalte: Mitarbeiternamen (Vor- und/oder Nachname)
- Obere Zeile: Tage des Monats (1, 2, 3, ... bis 28/30/31)
- Zellen: Schichtcodes

Aufgabe:
1. Finde die Zeile des Mitarbeiters mit dem Nachnamen: "${lastName}"
2. Bestimme Monat und Jahr des Dienstplans
3. Lies jeden Schichtcode für alle Tage dieser Zeile

Schichtcodes:
- F = Frühdienst
- S = Spätdienst
- N = Nachtdienst
- S1 = früherer Spätdienst
- / oder // = frei/Urlaub/Wochenende (leer lassen oder als "/" eintragen)

Antworte AUSSCHLIESSLICH mit diesem JSON — kein Markdown, kein erklärender Text:
{"employee":"vollständiger Name","month":"YYYY-MM","shifts":{"1":"F","2":"/","3":"S"}}

Alle Tage des Monats müssen in "shifts" vorkommen.
Falls der Mitarbeiter nicht gefunden wird: {"error":"Mitarbeiter nicht gefunden"}
Falls kein Dienstplan erkennbar: {"error":"Kein Dienstplan erkannt"}`,
            },
          ],
        },
      ],
    });

    const raw = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Strip accidental markdown fences
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Konnte keine Schichtdaten lesen. Bitte Foto-Qualität prüfen.' },
        { status: 500 }
      );
    }

    const data = JSON.parse(jsonMatch[0]);
    return NextResponse.json(data);
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json(
      { error: 'Serverfehler bei der Analyse. Bitte erneut versuchen.' },
      { status: 500 }
    );
  }
}
