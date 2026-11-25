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
    if (p.lovedAt) {
      out.push({ at: p.lovedAt, key: `v${p.id}`, text: `${away} loved ${p.memberId === me ? 'your' : `${p.memberName}’s`} answer to “${shortText(r.text)}”`, image: p.media === 'photo' ? p.url : undefined, rank: 1.5 });
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

// Home: only the latest moment (or, after a quiet spell, the best one so far), and
// a way through to the whole timeline in Moments, so the home page stays clear.
export function ActivityStrip({ feed, me, onMore }: { feed: Feed; me?: string; onMore?: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const all = buildActivity(feed, me);
  if (all.length === 0) return null;
  const now = Date.now();
  const recent = all.find((a) => now - a.at < RECENT_MS);
  const best = all.filter((a) => a.rank < 9).sort((a, b) => a.rank - b.rank || b.at - a.at)[0];
  const shown = recent ?? best ?? all[0];

  return (
    <section className={`activity ${recent ? '' : 'is-highlights'}`}>
      <h2>
        {recent ? 'Just now' : 'Highlight so far'} {!recent && <small>it&rsquo;s been quiet for a bit</small>}
      </h2>
      <ol>
        <ActivityItem a={shown} now={now} />
      </ol>
      {onMore && all.length > 1 && (
        <button type="button" className="btn btn-quiet see-moments" onClick={onMore}>
          See the whole timeline ({all.length})
        </button>
      )}
    </section>
  );
}

function ActivityItem({ a, now }: { a: Activity; now: number }) {
  return (
    <li>
      {a.image && <img src={a.image} alt="" loading="lazy" />}
      <p>
        {a.text}
        {a.note && (
          <em>
            {' '}
            <T text={a.note} toggle={false} />
          </em>
        )}
      </p>
      <time>{now - a.at < RECENT_MS ? ago(a.at, now) : clock(a.at)}</time>
    </li>
  );
}

// Moments > Timeline: everything that happened, newest first.
function Timeline({ feed, me }: { feed: Feed; me?: string }) {
  const all = buildActivity(feed, me);
  const now = Date.now();
  if (all.length === 0) return <p className="muted empty">Nothing has happened yet. It all lands here, newest first.</p>;
  return (
    <section className="activity">
      <ol>
        {all.map((a) => (
          <ActivityItem key={a.key} a={a} now={now} />
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

type Kind = 'timeline' | 'answered' | 'photos' | 'voices' | 'letters' | 'stories' | 'hichkis';

export function Moments({ feed, api, me, canRecord }: { feed: Feed; api: RoomApi; me?: string; canRecord: boolean }) {
  const away = feed.gathering.awayName;
  const reqById = new Map(feed.requests.map((r) => [r.id, r]));
  const answered = feed.requests.filter((r) => r.kind !== 'letter' && r.status === 'done').sort((a, b) => (b.fulfilledAt ?? 0) - (a.fulfilledAt ?? 0));
  const photos = feed.proofs.filter((p) => p.media === 'photo' || p.media === 'video').sort((a, b) => b.createdAt - a.createdAt);
  const voices = feed.proofs.filter((p) => p.media === 'audio' && reqById.get(p.requestId)?.kind !== 'story').sort((a, b) => b.createdAt - a.createdAt);
  const letters = feed.requests.filter((r) => r.kind === 'letter' && r.status === 'unlocked');
  const counts: Record<Kind, number> = {
    timeline: 0,
    answered: answered.length,
    photos: photos.length,
    voices: voices.length,
    letters: letters.length,
    stories: feed.stories.length,
    hichkis: (feed.hichkis ?? []).length,
  };
  const [kind, setKind] = useState<Kind>('timeline');
  const labels: [Kind, string][] = [
    ['timeline', 'Timeline'],
    ['answered', 'Answered'],
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

      {kind === 'timeline' && <Timeline feed={feed} me={me} />}

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
              <li key={p.id} className={picked(p) ? 'is-picked' : p.loved ? 'is-loved' : ''}>
                <ProofView proof={p} />
                <p className="small">
                  {p.memberId === me ? 'You' : p.memberName}
                  {picked(p) ? ` · ${away} picked it` : p.loved ? ` · ♥ ${away} loved it` : ''}
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
