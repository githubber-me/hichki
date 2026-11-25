// What's happening, and everything that has happened.
//
// The rule: the home page shows what needs you, plus the last 15 minutes. If nothing
// happened in the last 15 minutes, it shows the highlights so far instead. Everything
// else lives on Moments, sorted by type.

import { useEffect, useState } from 'react';
import type { Feed, Proof, Req, RoomApi } from './api.ts';
import { HichkiTimeline, ProofView, Stories, StoryWords, clock } from './parts.tsx';
import { ThanksView } from './thanks.tsx';
import { T } from './lang.tsx';

const RECENT_MS = 15 * 60 * 1000;
const HIGHLIGHTS = 6;

type Activity = {
  at: number;
  key: string;
  text: string;
  note?: string | null;
  image?: string;
  rank: number; // for highlights: lower comes first
};

function shortText(text: string | null, max = 48) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Everything that happened in the gathering, as one list, newest first.
export function buildActivity(feed: Feed, me?: string): Activity[] {
  const away = feed.gathering.awayName;
  const reqById = new Map(feed.requests.map((r) => [r.id, r]));
  const who = (memberId: string | null, name: string) => (memberId && memberId === me ? 'You' : name);
  const out: Activity[] = [];

  for (const p of feed.proofs) {
    const r = reqById.get(p.requestId);
    if (!r) continue;
    const what = r.kind === 'story' ? 'recorded a story' : p.media === 'photo' ? 'sent a photo' : p.media === 'video' ? 'sent a video' : 'sent a voice note';
    out.push({ at: p.createdAt, key: `p${p.id}`, text: `${who(p.memberId, p.memberName)} ${what} for “${shortText(r.text)}”`, rank: 9 });
    if (r.acceptedProofId === p.id && r.fulfilledAt) {
      out.push({
        at: r.fulfilledAt,
        key: `a${p.id}`,
        text:
          r.kind === 'letter'
            ? `${away}’s letter opened, thanks to ${who(p.memberId, p.memberName)}`
            : `${away} picked ${p.memberId === me ? 'yours' : `${p.memberName}’s`}: “${shortText(r.text)}”`,
        image: p.media === 'photo' ? p.url : undefined,
        rank: r.kind === 'letter' ? 2 : p.media === 'photo' ? 1 : 3,
      });
    }
    if (p.thanks) {
      out.push({ at: p.thanks.at, key: `t${p.id}`, text: `${away} said thank you to ${who(p.memberId, p.memberName)}`, note: p.thanks.text, rank: 4 });
    }
  }

  // Letters that opened by time, without anyone sending proof.
  for (const r of feed.requests) {
    if (r.kind === 'letter' && r.status === 'unlocked' && !r.acceptedProofId && r.fulfilledAt) {
      out.push({ at: r.fulfilledAt, key: `l${r.id}`, text: `${away}’s letter opened`, rank: 2 });
    }
  }

  for (const s of feed.stories) {
    if (s.requestId) continue; // already counted as a proof
    out.push({ at: s.createdAt, key: `s${s.id}`, text: `${s.teller} told a story`, note: s.translation ? shortText(s.translation, 90) : null, rank: 3 });
  }

  for (const [i, h] of (feed.hichkis ?? []).entries()) {
    out.push({ at: h.at, key: `h${h.at}-${i}`, text: `${who(h.memberId, h.from)} thought of ${away}`, note: h.note, rank: h.note ? 5 : 10 });
  }

  return out.sort((a, b) => b.at - a.at);
}

// Home: the last 15 minutes, or the highlights when it has been quiet.
export function ActivityStrip({ feed, me }: { feed: Feed; me?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const all = buildActivity(feed, me);
  if (all.length === 0) return null;
  const now = Date.now();
  const recent = all.filter((a) => now - a.at < RECENT_MS).slice(0, 6);

  if (recent.length > 0) {
    return (
      <section className="activity">
        <h2>
          Just now <small>last 15 minutes</small>
        </h2>
        <ol>
          {recent.map((a) => (
            <li key={a.key}>
              <p>
                {a.text}
                {a.note && <em> {a.note}</em>}
              </p>
              <time>{ago(a.at, now)}</time>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const highlights = all
    .filter((a) => a.rank < 9)
    .sort((a, b) => a.rank - b.rank || b.at - a.at)
    .slice(0, HIGHLIGHTS);
  if (highlights.length === 0) return null;
  return (
    <section className="activity is-highlights">
      <h2>
        Highlights so far <small>it&rsquo;s been quiet for a bit</small>
      </h2>
      <ol>
        {highlights.map((a) => (
          <li key={a.key}>
            {a.image && <img src={a.image} alt="" loading="lazy" />}
            <p>
              {a.text}
              {a.note && <em> {a.note}</em>}
            </p>
            <time>{clock(a.at)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ago(at: number, now: number) {
  const m = Math.round((now - at) / 60000);
  return m < 1 ? 'now' : `${m} min`;
}

// ---------------------------------------------------------------------------
// Moments: everything so far, by type.
// ---------------------------------------------------------------------------

type Kind = 'answered' | 'photos' | 'voices' | 'letters' | 'stories' | 'hichkis';

export function Moments({ feed, api, me, canRecord }: { feed: Feed; api: RoomApi; me?: string; canRecord: boolean }) {
  const away = feed.gathering.awayName;
  const reqById = new Map(feed.requests.map((r) => [r.id, r]));
  const answered = feed.requests.filter((r) => r.kind !== 'letter' && r.status === 'done').sort((a, b) => (b.fulfilledAt ?? 0) - (a.fulfilledAt ?? 0));
  const photos = feed.proofs.filter((p) => p.media === 'photo' || p.media === 'video').sort((a, b) => b.createdAt - a.createdAt);
  const voices = feed.proofs.filter((p) => p.media === 'audio' && reqById.get(p.requestId)?.kind !== 'story').sort((a, b) => b.createdAt - a.createdAt);
  const letters = feed.requests.filter((r) => r.kind === 'letter' && r.status === 'unlocked');
  const counts: Record<Kind, number> = {
    answered: answered.length,
    photos: photos.length,
    voices: voices.length,
    letters: letters.length,
    stories: feed.stories.length,
    hichkis: (feed.hichkis ?? []).length,
  };
  const [kind, setKind] = useState<Kind>(() => (answered.length ? 'answered' : photos.length ? 'photos' : 'hichkis'));
  const labels: [Kind, string][] = [
    ['answered', 'Answered'],
    ['photos', 'Photos'],
    ['voices', 'Voices'],
    ['letters', 'Letters'],
    ['stories', 'Stories'],
    ['hichkis', 'Hichkis'],
  ];

  const picked = (p: Proof) => reqById.get(p.requestId)?.acceptedProofId === p.id;
  const storyFor = (r: Req, p: Proof) => feed.stories.find((s) => s.requestId === r.id && s.audioUrl === p.url);

  return (
    <section className="moments">
      <div className="chips" role="tablist">
        {labels.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>
            {label}
            {counts[k] > 0 && <small>{counts[k]}</small>}
          </button>
        ))}
      </div>

      {kind === 'answered' &&
        (answered.length === 0 ? (
          <p className="muted empty">Nothing answered yet. When {away} picks a photo or a story, it lands here.</p>
        ) : (
          answered.map((r) => {
            const won = feed.proofs.find((p) => p.id === r.acceptedProofId);
            const story = won ? storyFor(r, won) : undefined;
            return (
              <article key={r.id} className="card done-card">
                <p className="request-text">
                  <T text={r.text} />
                </p>
                {won && <ProofView proof={won} />}
                {story && <StoryWords story={story} />}
                {won && (
                  <p className="muted">
                    {away} picked {won.memberId === me ? 'yours' : `${won.memberName}’s`}.
                  </p>
                )}
                {won?.thanks && <ThanksView thanks={won.thanks} from={away} />}
              </article>
            );
          })
        ))}

      {kind === 'photos' &&
        (photos.length === 0 ? (
          <p className="muted empty">No photos yet.</p>
        ) : (
          <ul className="photo-grid">
            {photos.map((p) => (
              <li key={p.id} className={picked(p) ? 'is-picked' : ''}>
                <ProofView proof={p} />
                <p className="small">
                  {p.memberId === me ? 'You' : p.memberName}
                  {picked(p) ? ` · ${away} picked it` : ''}
                </p>
              </li>
            ))}
          </ul>
        ))}

      {kind === 'voices' &&
        (voices.length === 0 ? (
          <p className="muted empty">No voice notes yet.</p>
        ) : (
          voices.map((p) => (
            <article key={p.id} className="card voice-card">
              <p className="small muted">
                {p.memberId === me ? 'You' : p.memberName}, for &ldquo;{shortText(reqById.get(p.requestId)?.text ?? '')}&rdquo; &middot; {clock(p.createdAt)}
              </p>
              <ProofView proof={p} />
            </article>
          ))
        ))}

      {kind === 'letters' &&
        (letters.length === 0 ? (
          <p className="muted empty">No letters have opened yet.</p>
        ) : (
          letters.map((r) => (
            <article key={r.id} className="card letter-card is-open">
              <p className="eyebrow">A letter from {away}{r.openWhen ? ` · for when ${r.openWhen}` : ''}</p>
              {r.audioUrl && <audio src={r.audioUrl} controls preload="none" />}
              {(r.transcript || r.text) && (
                <p className="request-text">
                  <T text={r.transcript || r.text} />
                </p>
              )}
            </article>
          ))
        ))}

      {kind === 'stories' && <Stories api={api} stories={feed.stories} canRecord={canRecord} />}

      {kind === 'hichkis' &&
        ((feed.hichkis ?? []).length === 0 ? (
          <p className="muted empty">No hichkis yet.</p>
        ) : (
          <HichkiTimeline entries={feed.hichkis} awayName={me ? away : 'you'} me={me} limit={50} />
        ))}
    </section>
  );
}
