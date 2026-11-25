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
  // Sarvam lists WebM by its usual .webm name, so audio saved as .weba is sent under that name.
  form.append('file', new Blob([bytes], { type: mimeOf(file) }), file.split('/').pop()!.replace(/\.weba$/, '.webm'));
  form.append('model', sttModel);
  form.append('mode', opts.mode ?? 'transcribe');
  form.append('language_code', opts.language || 'unknown');

  const body = await call('/speech-to-text', { method: 'POST', body: form });
  return { transcript: String(body.transcript ?? '').trim(), language: body.language_code ?? null };
}

// ---------------------------------------------------------------------------
// Request to card
// ---------------------------------------------------------------------------

export type Card = { kind: 'see' | 'do' | 'story'; text: string; textOriginal: string };

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
        enum: ['see', 'do', 'story'],
        description:
          'see: they want to be shown something. do: they want someone to do something for them. story: they want someone (often an elder) to tell them a story or a memory.',
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

// Short examples teach the model the exact shape we want, in Hindi, Hinglish and English.
const CARD_EXAMPLES: [string, Card][] = [
  ['दादी जब दुल्हन को देखें तो उनकी फोटो भेजना', { kind: 'see', text: 'Send me a photo of Dadi when she sees the bride', textOriginal: 'दादी जब दुल्हन को देखें तो उनकी फोटो भेजना' }],
  ['mummy ko meri taraf se ek hug de dena', { kind: 'do', text: 'Give Mummy a hug from me', textOriginal: 'mummy ko meri taraf se ek hug de dena' }],
  ['मेरी तरफ से मंदिर में दिया जला देना और फोटो भेजना', { kind: 'do', text: 'Light a diya at the temple for me, and send a photo', textOriginal: 'मेरी तरफ से मंदिर में दिया जला देना और फोटो भेजना' }],
  ['show me papa dancing at the sangeet', { kind: 'see', text: 'Show me Papa dancing at the sangeet', textOriginal: 'show me papa dancing at the sangeet' }],
  ['दादी से कहना अपनी शादी की कहानी सुनाएं', { kind: 'story', text: 'Ask Dadi to tell the story of her own wedding day', textOriginal: 'दादी से कहना अपनी शादी की कहानी सुनाएं' }],
];

const CARD_INSTRUCTIONS =
  'You turn a spoken request into one short card for a family celebration. The speaker could not attend ' +
  'and is asking the people there. Reply with JSON only: ' +
  '"kind" is "see" when they mainly want to be shown something (a person, a moment, a photo of it), ' +
  'and "do" when they want someone to do something for them (light a diya, give a hug, touch feet, play a message), even if they also ask for a photo. ' +
  '"story" when they want someone, often an elder, to tell them a story or a memory (kahani, kissa, "tell me about"). ' +
  '"text" is the request in simple English, in their own voice, at most 12 words. ' +
  '"text_original" is the request in the language and script they spoke, as one sentence. ' +
  'Only use names and relations that the speaker said. Never add anything else.';

const hasIndicScript = (text: string) => /[\u0900-\u0DFF]/.test(text);

export async function toCard(transcript: string, language: string | null = null): Promise<Card> {
  const examples = CARD_EXAMPLES.flatMap(([said, card]) => [
    { role: 'user', content: said },
    { role: 'assistant', content: JSON.stringify({ kind: card.kind, text: card.text, text_original: card.textOriginal }) },
  ]);

  const body = await call('/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: chatModel,
      temperature: 0,
      max_tokens: 300,
      reasoning_effort: null,
      response_format: { type: 'json_schema', json_schema: CARD_SCHEMA },
      messages: [{ role: 'system', content: CARD_INSTRUCTIONS }, ...examples, { role: 'user', content: transcript }],
    }),
  });

  let card: Card | null = null;
  try {
    const parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? '');
    if ((parsed.kind === 'see' || parsed.kind === 'do' || parsed.kind === 'story') && typeof parsed.text === 'string' && parsed.text.trim()) {
      card = {
        kind: parsed.kind,
        text: parsed.text.trim(),
        textOriginal: String(parsed.text_original ?? '').trim() || transcript,
      };
    }
  } catch {
    // handled below
  }

  if (!card) {
    log.warn({ event: 'sarvam_card_unparsed' }, 'card could not be parsed, using transcript');
    card = { kind: guessKind(transcript), text: transcript, textOriginal: transcript };
  }

  // Asking for a story is easy to spot by its words, whatever the model decided.
  if (card.kind !== 'story' && isStoryAsk(`${transcript} ${card.text}`)) card.kind = 'story';

  // The card must be readable by everyone in the room. If it didn't come back in
  // English, or came back far too long, translate the transcript instead.
  if ((hasIndicScript(card.text) || card.text.split(/\s+/).length > 20) && language && language !== 'en-IN') {
    try {
      card.text = await translate(transcript, language, 'en-IN');
    } catch {
      // keep what we have
    }
  }

  // The original should be what they said, not something the model wrote around it.
  if (card.textOriginal.length > transcript.length * 1.5) card.textOriginal = transcript;

  return { ...card, text: card.text.slice(0, 140), textOriginal: card.textOriginal.slice(0, 200) };
}

// "Tell me a story": kahani, kissa, sunao, or the English words.
export function isStoryAsk(text: string): boolean {
  return /(कहानी|किस्सा|क़िस्सा|सुनाओ|सुनाएं|सुनाना|kahani|kahaani|kissa|sunao|\bstory\b|\bstories\b|tell (me|us) about)/i.test(text);
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
