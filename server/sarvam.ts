// Sarvam AI: speech to text, turning a spoken request into a card, and translation.
// Called only from the server, so the API key never reaches a browser.
// Docs: https://docs.sarvam.ai

import { readFile } from 'node:fs/promises';
import { config } from './config.ts';
import { log } from './app.ts';
import { filePath, mimeOf } from './files.ts';

const { apiKey, baseUrl, sttModel, chatModel, translateModel } = config.sarvam;

export const sarvamEnabled = apiKey.length > 0;

export class SarvamError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// One call to Sarvam, with a timeout and one retry when Sarvam is busy (429 or 503).
async function call(path: string, init: RequestInit, timeoutMs = 25_000): Promise<any> {
  if (!sarvamEnabled) throw new SarvamError('Sarvam is not configured (SARVAM_API_KEY is empty).', 503);

  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { 'api-subscription-key': apiKey, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      log.error({ event: 'sarvam_unreachable', path, err: (err as Error).message }, 'sarvam unreachable');
      throw new SarvamError('Sarvam could not be reached.', 504);
    }

    const ms = Date.now() - started;
    const body = await res.json().catch(() => ({}));

    if (res.ok) {
      log.info({ event: 'sarvam_call', path, status: res.status, ms }, 'sarvam call');
      return body;
    }

    log.warn({ event: 'sarvam_error', path, status: res.status, ms, attempt, error: body?.error }, 'sarvam error');
    if ((res.status === 429 || res.status === 503) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    const message =
      res.status === 402
        ? 'Sarvam credit has run out.'
        : res.status === 403
          ? 'The Sarvam API key was rejected.'
          : (body?.error?.message ?? `Sarvam returned ${res.status}.`);
    throw new SarvamError(message, res.status);
  }
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export type Transcript = { transcript: string; language: string | null };

// mode "transcribe" keeps the spoken language; "translate" returns English.
// The synchronous API takes clips of up to 30 seconds.
export async function transcribe(
  file: string,
  opts: { language?: string; mode?: 'transcribe' | 'translate' | 'codemix' } = {},
): Promise<Transcript> {
  const bytes = await readFile(filePath(file));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeOf(file) }), file.split('/').pop());
  form.append('model', sttModel);
  form.append('mode', opts.mode ?? 'transcribe');
  form.append('language_code', opts.language || 'unknown');

  const body = await call('/speech-to-text', { method: 'POST', body: form });
  return { transcript: String(body.transcript ?? '').trim(), language: body.language_code ?? null };
}

// ---------------------------------------------------------------------------
// Request to card
// ---------------------------------------------------------------------------

export type Card = { kind: 'see' | 'do'; text: string; textOriginal: string };

const CARD_SCHEMA = {
  name: 'request_card',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'text', 'text_original'],
    properties: {
      kind: {
        type: 'string',
        enum: ['see', 'do'],
        description: 'see: they want to be shown something. do: they want someone to do something for them.',
      },
      text: {
        type: 'string',
        description: 'The request as a short card in English, in their own voice, at most 12 words.',
      },
      text_original: {
        type: 'string',
        description: 'The same short card in the language and script they spoke.',
      },
    },
  },
};

export async function toCard(transcript: string, awayName: string, occasion: string): Promise<Card> {
  const body = await call('/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0.2,
      max_tokens: 400,
      reasoning_effort: null,
      response_format: { type: 'json_schema', json_schema: CARD_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            `${awayName} could not come to a ${occasion} and is taking part from far away. ` +
            'They spoke a request to the people at the gathering. Turn it into one short card the room can act on. ' +
            'Keep their meaning and warmth; keep names and relations as they said them (Dadi, Nani, Papa). ' +
            'Do not add anything they did not ask for. Reply with JSON only.',
        },
        { role: 'user', content: transcript },
      ],
    }),
  });

  const content = body?.choices?.[0]?.message?.content ?? '';
  try {
    const parsed = JSON.parse(content);
    if ((parsed.kind === 'see' || parsed.kind === 'do') && typeof parsed.text === 'string' && parsed.text.trim()) {
      return {
        kind: parsed.kind,
        text: parsed.text.trim().slice(0, 140),
        textOriginal: String(parsed.text_original ?? '').trim().slice(0, 200) || transcript,
      };
    }
  } catch {
    // fall through to the plain fallback below
  }
  log.warn({ event: 'sarvam_card_unparsed' }, 'card could not be parsed, using transcript');
  return { kind: guessKind(transcript), text: transcript.slice(0, 140), textOriginal: transcript };
}

// Used when the model's answer can't be read: "show me", "dikhao", "dekhna" mean see.
export function guessKind(text: string): 'see' | 'do' {
  return /\b(show|see|send( me)? a (photo|picture|pic)|dikha|dikhao|dekh|photo|tasveer)/i.test(text) ? 'see' : 'do';
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

// sarvam-translate:v1 takes up to 2,000 characters per call, so long text is split.
export async function translate(text: string, source: string, target: string): Promise<string> {
  if (!text.trim() || source === target) return text;
  const parts = splitText(text, 1800);
  const out: string[] = [];
  for (const part of parts) {
    const body = await call('/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: part,
        source_language_code: source,
        target_language_code: target,
        model: translateModel,
      }),
    });
    out.push(String(body.translated_text ?? body.translatedText ?? ''));
  }
  return out.join(' ').trim();
}

function splitText(text: string, max: number): string[] {
  const sentences = text.match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const parts: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > max && current) {
      parts.push(current);
      current = '';
    }
    current += s;
  }
  if (current) parts.push(current);
  return parts;
}
