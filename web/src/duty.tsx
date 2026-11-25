// Duty pe, and the away person's clock: for someone who can't watch live because
// they're working, or are hours away. The room sees their time and whether they're on
// duty; they see what happened while they were gone.

import { useEffect, useState } from 'react';
import type { CatchUp, Feed, PublicGathering, RoomApi } from './api.ts';
import { T } from './lang.tsx';
import { w } from './words.ts';

// "Toronto" from "America/Toronto".
function placeOf(tz: string) {
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

function timeIn(tz: string | null, at: number) {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz ?? undefined }).format(at);
}

// Re-render every minute, so clocks and "until" times stay right.
function useMinute() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
}

// For the room: "It's 4:12 am for Meera in Toronto", shown only when their clock differs.
export function AwayClock({ gathering }: { gathering: PublicGathering }) {
  useMinute();
  const tz = gathering.awayTz;
  if (!tz) return null;
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz === here) return null;
  return (
    <p className="away-clock">
      It&rsquo;s {timeIn(tz, Date.now())} for {gathering.awayName} in {placeOf(tz)}
    </p>
  );
}

// For the room: the away person is on duty, so nothing will buzz them until it ends.
export function DutyBanner({ gathering }: { gathering: PublicGathering }) {
  useMinute();
  const duty = gathering.duty;
  if (!duty || duty.until <= Date.now()) return null;
  return (
    <p className="banner duty-banner" role="status">
      {gathering.awayName} is on duty{duty.note ? `: ${duty.note}` : ''}, until {timeIn(gathering.awayTz, duty.until)}
      {gathering.awayTz ? ' their time' : ''}. Send everything anyway. It&rsquo;ll be waiting.
    </p>
  );
}

// For the away person: go on duty until a time, or come off duty.
export function DutyControl({ api, gathering, onChange }: { api: RoomApi; gathering: PublicGathering; onChange: () => void }) {
  useMinute();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(8);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const duty = gathering.duty && gathering.duty.until > Date.now() ? gathering.duty : null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
      setOpen(false);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (duty) {
    return (
      <section className="card duty-card is-on">
        <p className="eyebrow">{w().duty}</p>
        <h2>On duty until {timeIn(null, duty.until)}</h2>
        <p className="muted">
          Hichkis are kept for you until then, so nothing buzzes at work. Everyone can see you&rsquo;re on duty.
        </p>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => run(() => api.setDuty(null))}>
          I&rsquo;m off duty
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet duty-open" onClick={() => setOpen(true)}>
        Working through it? Go on duty
      </button>
    );
  }

  return (
    <section className="card duty-card">
      <p className="eyebrow">{w().duty}</p>
      <h2>I&rsquo;m on duty</h2>
      <p className="muted">
        A shift, a posting, a delivery run. The room sees you&rsquo;re working, and hichkis wait for you instead of buzzing.
      </p>
      <label className="field">
        <span>For how long?</span>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {[2, 4, 6, 8, 10, 12, 24].map((h) => (
            <option key={h} value={h}>
              {h} hours, until {timeIn(null, Date.now() + h * 3600_000)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>What are you doing? (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Night shift at the hospital" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.setDuty(Date.now() + hours * 3600_000, note.trim() || undefined))}>
          Go on duty
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// For the away person: what happened while they were gone, before anything else.
export function CatchUpCard({ api, feed, catchUp, onDone }: { api: RoomApi; feed: Feed; catchUp: CatchUp; onDone: () => void }) {
  const people = [...new Set(catchUp.hichkis.map((h) => h.from))];
  const answered = feed.requests.filter((r) => catchUp.answered.includes(r.id));
  const photoFor = (proofId: string | null) => feed.proofs.find((p) => p.id === proofId);
  const stories = feed.stories.filter((s) => catchUp.stories.includes(s.id));
  const n = catchUp.hichkis.length;

  async function done() {
    await api.seen().catch(() => {});
    onDone();
  }

  return (
    <section className="card catch-up" aria-live="polite">
      <p className="eyebrow">{catchUp.wasOnDuty ? `While you were on duty${catchUp.dutyNote ? `: ${catchUp.dutyNote}` : ''}` : 'While you were away'}</p>

      {n > 0 && (
        <div className="catch-up-hichki">
          <span className="hichki-art" aria-hidden="true" />
          <div>
            <p className="hichki-line" lang="hi">
              किसी ने याद किया
            </p>
            <p>
              {people.length === 1 ? people[0] : `${people.length} people`} thought of you{n > 1 ? `, ${n} times` : ''}.
            </p>
            {people.length > 1 && <p className="muted">{people.join(', ')}</p>}
            {catchUp.hichkis
              .filter((h) => h.note)
              .slice(0, 3)
              .map((h) => (
                <p key={h.at} className="muted small">
                  {h.from}: <em><T text={h.note} /></em>
                </p>
              ))}
          </div>
        </div>
      )}

      {answered.length > 0 && (
        <ul className="catch-up-list">
          {answered.map((r) => {
            const proof = photoFor(r.acceptedProofId);
            return (
              <li key={r.id}>
                {proof?.media === 'photo' && <img src={proof.url} alt="" />}
                <span>
                  <strong>{r.kind === 'letter' ? 'Your letter opened' : r.text}</strong>
                  {proof && <small> from {proof.memberName}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {stories.length > 0 && (
        <p className="muted">
          {stories.length === 1 ? `${stories[0].teller} told a story.` : `${stories.length} new stories.`} It&rsquo;s in Stories.
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={done}>
        Got it
      </button>
    </section>
  );
}
