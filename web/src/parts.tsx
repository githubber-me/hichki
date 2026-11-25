// Small pieces shared by the guest, host and away screens.
// Class names here are styled by theme.css.

import { Camera } from './camera.tsx';
import { useState, type ReactNode } from 'react';
import type { HichkiEntry, Presence, Proof, RoomApi, Story } from './api.ts';
import { recordingName, shrinkPhoto, useRecorder } from './recorder.ts';

// "4:12 pm" for today, "Fri 4:12 pm" for another day.
export function clock(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export function ago(ts: number, now: number): string {
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.round(min / 60)} h ago`;
  return clock(ts);
}

export function MicIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

// Tap to start, tap again to stop. Stops by itself at 30 seconds.
export function RecordButton({
  onDone,
  idle,
  className = 'btn',
  disabled,
  maxSeconds = 30,
}: {
  onDone: (blob: Blob) => void;
  idle: ReactNode;
  className?: string;
  disabled?: boolean;
  maxSeconds?: number; // Infinity for no limit (only Sarvam needs the 30 second cap)
}) {
  const r = useRecorder(onDone, maxSeconds);
  const unlimited = !Number.isFinite(maxSeconds);
  return (
    <div className="recorder">
      <button
        type="button"
        className={`${className} ${r.recording ? 'is-recording' : ''}`}
        onClick={r.recording ? r.stop : r.start}
        disabled={disabled}
        aria-pressed={r.recording}
      >
        {r.recording ? (
          <span className="recording-count">
            <b>{unlimited ? `${Math.floor(r.seconds / 60)}:${String(r.seconds % 60).padStart(2, '0')}` : r.left}</b>
            <small>tap to stop</small>
          </span>
        ) : (
          idle
        )}
      </button>
      {r.error && <p className="error">{r.error}</p>}
    </div>
  );
}

// Opens the camera or the photo library, whichever the person chooses.
// Opens the in-app camera (with the gallery one tap away inside it).
export function PhotoButton({
  onPick,
  children,
  className = 'btn btn-primary',
  disabled,
  facing = 'environment',
}: {
  onPick: (file: File) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  facing?: 'environment' | 'user';
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${className} file-btn`} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <Camera facing={facing} onPhoto={onPick} onClose={() => setOpen(false)} />}
    </>
  );
}

// Upload helpers used by every screen that sends a photo or a recording.
export async function uploadPhoto(api: RoomApi, file: File) {
  const { blob, name } = await shrinkPhoto(file);
  return api.upload(blob, name);
}

export function uploadRecording(api: RoomApi, blob: Blob) {
  return api.upload(blob, recordingName(blob));
}

// One tap tells the person who couldn't come that someone just thought of them.
export function HichkiButton({ api, awayName }: { api: RoomApi; awayName: string }) {
  const [taps, setTaps] = useState(0);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');

  async function tap() {
    setTaps((n) => n + 1);
    navigator.vibrate?.(30);
    try {
      await api.hichki(note.trim() || undefined);
      setMessage(`Sent. ${awayName}\u2019s phone just buzzed.`);
      setNote('');
    } catch (e) {
      setMessage((e as Error).message);
    }
    window.setTimeout(() => setMessage(''), 2600);
  }

  return (
    <div className="hichki">
      {/* The key restarts the animation on every tap. */}
      <button type="button" key={taps} className={`hichki-btn ${taps ? 'is-sent' : ''}`} onClick={tap} aria-label={`Send ${awayName} a hichki`}>
        <span className="hichki-art" aria-hidden="true" />
        <span className="hichki-label" lang="hi">
          हिचकी
        </span>
      </button>
      <p className="hichki-hint" aria-live="polite">
        {message || `Tap when you think of ${awayName}. They\u2019ll know they were remembered.`}
      </p>
      <label className="hichki-note">
        <span>Add when (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && tap()}
          maxLength={120}
          placeholder="when Dadi started singing"
        />
      </label>
    </div>
  );
}

// The hichki timeline: every time someone remembered the away person, newest first.
export function HichkiTimeline({ entries, awayName, me, limit = 5 }: { entries: HichkiEntry[]; awayName: string; me?: string; limit?: number }) {
  const [all, setAll] = useState(false);
  if (entries.length === 0) return null;
  const shown = all ? entries : entries.slice(0, limit);
  return (
    <section className="hichki-timeline">
      <h2>
        Remembered {entries.length} {entries.length === 1 ? 'time' : 'times'}
      </h2>
      <ol>
        {shown.map((h, i) => (
          <li key={`${h.at}-${i}`}>
            <span className="tl-dot" aria-hidden="true" />
            <p>
              <b>{h.memberId && h.memberId === me ? 'You' : h.from}</b> thought of {awayName}
              {h.note ? <> {h.note.startsWith('when') || h.note.startsWith('while') ? '' : '\u00b7 '}<em>{h.note}</em></> : null}
            </p>
            <time dateTime={new Date(h.at).toISOString()}>{clock(h.at)}</time>
          </li>
        ))}
      </ol>
      {entries.length > limit && (
        <button type="button" className="btn btn-quiet btn-small" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}

// Points come from proofs the away person accepted: 10 each, drawn as one mark each.
export function Leaderboard({ presence, me, limit }: { presence: Presence; me?: string; limit?: number }) {
  const ranked = presence.members.filter((m) => m.points > 0).slice(0, limit);
  if (ranked.length === 0) return null;
  return (
    <ol className="leaderboard">
      {ranked.map((m, i) => (
        <li key={m.id} className={m.id === me ? 'is-me' : ''}>
          <span className="rank">{i + 1}</span>
          <b>{m.name}</b>
          <span className="marks" aria-hidden="true">
            {Array.from({ length: Math.min(8, Math.round(m.points / 10)) }, (_, k) => (
              <i key={k} />
            ))}
          </span>
          <span className="points">{m.points}</span>
        </li>
      ))}
    </ol>
  );
}

// A photo, a voice note or a video someone sent as proof.
export function ProofView({ proof }: { proof: Proof }) {
  if (proof.media === 'photo') return <img className="proof-media" src={proof.url} alt={proof.caption ?? `Photo from ${proof.memberName}`} loading="lazy" />;
  if (proof.media === 'video') return <video className="proof-media" src={proof.url} controls playsInline preload="metadata" />;
  return <audio className="proof-audio" src={proof.url} controls preload="none" />;
}

const LANGUAGES: [string, string][] = [
  ['', 'Detect the language'],
  ['hi-IN', 'Hindi'],
  ['pa-IN', 'Punjabi'],
  ['kn-IN', 'Kannada'],
  ['bn-IN', 'Bengali'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
  ['ml-IN', 'Malayalam'],
  ['mr-IN', 'Marathi'],
  ['gu-IN', 'Gujarati'],
  ['en-IN', 'English'],
];

// Dadi ki kahani: record an elder's story, then hear it and read it in another language.
export function Stories({ api, stories, canRecord = true }: { api: RoomApi; stories: Story[]; canRecord?: boolean }) {
  const [teller, setTeller] = useState('');
  const [language, setLanguage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(blob: Blob) {
    setBusy(true);
    setError('');
    try {
      const up = await uploadRecording(api, blob);
      await api.addStory(up.file, teller.trim() || 'Someone', language || undefined);
      setTeller('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="stories">
      <header className="section-head">
        <h2>
          Dadi ki kahani <small>grandma&rsquo;s story</small>
        </h2>
        <p className="muted">Record an elder telling a story in their own language. Everyone can hear it and read it in theirs.</p>
      </header>

      {canRecord && (
        <div className="card story-recorder">
          <label className="field">
            <span>Who is telling it?</span>
            <input value={teller} onChange={(e) => setTeller(e.target.value)} placeholder="Dadi" maxLength={40} />
          </label>
          <label className="field">
            <span>Language they speak</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <RecordButton
            onDone={send}
            disabled={busy}
            className="btn btn-primary"
            idle={
              <>
                <MicIcon /> {busy ? 'Sending…' : 'Record a story (30 seconds)'}
              </>
            }
          />
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {stories.length === 0 && <p className="muted empty">No stories yet. The first one is always the hardest to ask for.</p>}

      {stories.map((s) => (
        <article key={s.id} className="card story">
          <h3>{s.teller}</h3>
          <audio src={s.audioUrl} controls preload="none" />
          {s.status === 'processing' && <p className="muted">Writing it down and translating&hellip;</p>}
          {s.status === 'failed' && <p className="error">{s.error ?? 'We kept the voice, but couldn’t write it down.'}</p>}
          {s.transcript && (
            <p className="story-original" lang={s.language ?? undefined}>
              {s.transcript}
            </p>
          )}
          {s.translation && <p className="story-translation">{s.translation}</p>}
        </article>
      ))}
    </section>
  );
}

// A told story's words: the original and the translation, for cards that answer a story request.
export function StoryWords({ story }: { story: Story }) {
  if (story.status === 'processing') return <p className="muted small">Writing it down and translating&hellip;</p>;
  if (story.status === 'failed') return <p className="error">{story.error ?? 'We kept the voice, but couldn\u2019t write it down.'}</p>;
  return (
    <>
      {story.transcript && (
        <p className="story-original" lang={story.language ?? undefined}>
          {story.transcript}
        </p>
      )}
      {story.translation && story.translation !== story.transcript && <p className="story-translation">{story.translation}</p>}
    </>
  );
}

// Bottom tabs. Each screen decides which ones it has.
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <nav className="tabs">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" className={id === value ? 'is-active' : ''} onClick={() => onChange(id)} aria-current={id === value}>
          {label}
        </button>
      ))}
    </nav>
  );
}
