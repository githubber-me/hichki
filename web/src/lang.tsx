// Read in your own language. Each person chooses, on joining or later: the language
// things were said in (the default), or one of theirs. Texts are translated by
// Sarvam through the server, once per language, and the original is always one tap away.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoomApi } from './api.ts';

export const READ_LANGUAGES: [string, string][] = [
  ['', 'The language it was said in'],
  ['en-IN', 'English'],
  ['hi-IN', 'Hindi'],
  ['bn-IN', 'Bengali'],
  ['gu-IN', 'Gujarati'],
  ['kn-IN', 'Kannada'],
  ['ml-IN', 'Malayalam'],
  ['mr-IN', 'Marathi'],
  ['od-IN', 'Odia'],
  ['pa-IN', 'Punjabi'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
];

const key = (gatheringId: string) => `hichki:lang:${gatheringId}`;
export const savedLang = (gatheringId: string) => localStorage.getItem(key(gatheringId)) ?? '';
export const saveLang = (gatheringId: string, lang: string) => localStorage.setItem(key(gatheringId), lang);

type Ctx = { lang: string; setLang: (l: string) => void; get: (text: string) => string | undefined; want: (text: string) => void };
const LangContext = createContext<Ctx>({ lang: '', setLang: () => {}, get: () => undefined, want: () => {} });

export function LangProvider({ gatheringId, api, children }: { gatheringId: string; api: RoomApi; children: ReactNode }) {
  const [lang, setLangState] = useState(() => savedLang(gatheringId));
  const [, setVersion] = useState(0);
  const cache = useRef(new Map<string, string>());
  const pending = useRef(new Set<string>());
  const timer = useRef(0);

  const setLang = useCallback(
    (l: string) => {
      saveLang(gatheringId, l);
      setLangState(l);
    },
    [gatheringId],
  );

  // Collect the texts a screen needs, then ask for them in one call.
  const flush = useCallback(async () => {
    const target = lang;
    const texts = [...pending.current].slice(0, 30);
    texts.forEach((t) => pending.current.delete(t));
    if (!target || texts.length === 0) return;
    try {
      const { translations } = await api.translate(texts, target);
      for (const t of texts) cache.current.set(`${target}\u0000${t}`, translations[t] ?? t);
      setVersion((v) => v + 1);
    } catch {
      // keep showing the original
    }
    if (pending.current.size) timer.current = window.setTimeout(flush, 30);
  }, [api, lang]);

  const want = useCallback(
    (text: string) => {
      if (!lang || cache.current.has(`${lang}\u0000${text}`) || pending.current.has(text)) return;
      pending.current.add(text);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 30);
    },
    [lang, flush],
  );

  const get = useCallback((text: string) => (lang ? cache.current.get(`${lang}\u0000${text}`) : undefined), [lang]);
  const value = useMemo(() => ({ lang, setLang, get, want }), [lang, setLang, get, want]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

// A piece of text, in the reader's language when they chose one, with the original one tap away.
export function T({ text, toggle = true }: { text: string | null | undefined; toggle?: boolean }) {
  const { lang, get, want } = useLang();
  const [original, setOriginal] = useState(false);
  useEffect(() => {
    if (text && lang) want(text);
  }, [text, lang, want]);
  if (!text) return null;
  const translated = lang ? get(text) : undefined;
  const differs = !!translated && translated.trim() !== text.trim();
  if (!differs) return <>{text}</>;
  return (
    <>
      {original ? text : translated}
      {toggle && (
        <button type="button" className="original-toggle" onClick={() => setOriginal((o) => !o)}>
          {original ? 'Translate' : 'See original'}
        </button>
      )}
    </>
  );
}

// "Read things in": the choice, on joining and later.
export function LangPicker({ value, onChange, label = 'Read things in' }: { value: string; onChange: (l: string) => void; label?: string }) {
  return (
    <label className="field lang-picker">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {READ_LANGUAGES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
