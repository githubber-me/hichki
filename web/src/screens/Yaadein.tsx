import { useEffect, useMemo, useRef, useState } from 'react';
import { getKeepsake, publicBaseUrl, saved, type Keepsake, type KeepsakeWho, type Proof, type Req, type Story, type Tap } from '../api.ts';
import { ProofView } from '../parts.tsx';
import { setRoomLang, w } from '../words.ts';

// Yaadein (memories): what a celebration leaves behind. One page with every
// answered request, opened letter, story and hichki, in the order they happened.
// It fills in while the celebration is going, and when the host wraps up it is
// what the away person's link opens on.

// The page at /g/CODE/yaadein. Works out who is looking, then draws the page.
export function YaadeinPage({ id }: { id: string }) {
  const [who] = useState(() => whoIsLooking(id));
  if (!who) {
    return (
      <main className="screen">
        <p className="error">This link is incomplete. Ask whoever sent it to send it again.</p>
      </main>
    );
  }
  return <Yaadein id={id} who={who} ownsAddress />;
}

// A token in the address wins. After that, whoever this tab was last time, then
// whoever this phone is in the gathering, then the read-only key from a shared link.
function whoIsLooking(id: string): KeepsakeWho | null {
  const query = new URLSearchParams(location.search);
  const token = query.get('t');
  // The server tells host from away by the token itself, so the role here is only a label.
  if (token) return { role: 'away', token };

  try {
    const before = JSON.parse(sessionStorage.getItem(`hichki:yaadein:${id}`) ?? 'null') as KeepsakeWho | null;
    if (before) return before;
  } catch {
    // Fall through to what the phone remembers.
  }

  // The phone that created the gathering holds both tokens, so the host comes first.
  const host = saved.hostToken(id);
  if (host) return { role: 'host', token: host };
  const member = saved.member(id);
  if (member) return { role: 'guest', memberId: member.id };
  const away = saved.awayToken(id);
  if (away) return { role: 'away', token: away };

  const key = query.get('k');
  return key ? { role: 'visitor', key } : null;
}

type Moment =
  | { type: 'ask'; id: string; at: number; request: Req; picked: Proof | null; others: Proof[] }
  | { type: 'letter'; id: string; at: number; request: Req; proof: Proof | null }
  | { type: 'story'; id: string; at: number; story: Story }
  | { type: 'hichkis'; id: string; at: number; taps: Tap[] };

const dayOf = (ts: number) => new Date(ts).toDateString();
const timeOf = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dateOf = (ts: number) => new Date(ts).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

// Everything that happened, oldest first. A request nobody answered is left out:
// this page is for what happened, not for what didn't.
function momentsOf(k: Keepsake): Moment[] {
  const happened: Moment[] = [];

  for (const r of k.requests) {
    const proofs = k.proofs.filter((p) => p.requestId === r.id).sort((a, b) => a.createdAt - b.createdAt);
    const picked = proofs.find((p) => p.id === r.acceptedProofId) ?? null;
    if (r.kind === 'letter') {
      if (r.status === 'unlocked') {
        happened.push({ type: 'letter', id: r.id, at: r.fulfilledAt ?? r.unlockAt ?? r.liveAt, request: r, proof: picked });
      }
    } else if (proofs.length > 0 && r.status !== 'scheduled') {
      happened.push({
        type: 'ask',
        id: r.id,
        at: r.fulfilledAt ?? proofs[proofs.length - 1].createdAt,
        request: r,
        picked,
        others: proofs.filter((p) => p !== picked),
      });
    }
  }
  for (const s of k.stories) happened.push({ type: 'story', id: s.id, at: s.createdAt, story: s });
  happened.sort((a, b) => a.at - b.at);

  // Hichkis that came between two moments (on the same day) are shown together.
  const all: Moment[] = [];
  const taps = [...k.hichkis].sort((a, b) => a.at - b.at);
  let next = 0;
  const hichkisUntil = (before: number) => {
    while (next < taps.length && taps[next].at <= before) {
      const run = [taps[next++]];
      while (next < taps.length && taps[next].at <= before && dayOf(taps[next].at) === dayOf(run[0].at)) run.push(taps[next++]);
      all.push({ type: 'hichkis', id: `hichki-${run[0].at}`, at: run[0].at, taps: run });
    }
  };
  for (const m of happened) {
    hichkisUntil(m.at);
    all.push(m);
  }
  hichkisUntil(Infinity);
  return all;
}

// The voice to play for a moment when the page is replayed, if it has one.
function voiceOf(m: Moment): string | null {
  if (m.type === 'letter') return m.request.audioUrl;
  if (m.type === 'story') return m.story.audioUrl;
  if (m.type === 'ask') return [m.picked, ...m.others].find((p) => p?.media === 'audio')?.url ?? null;
  return null;
}

// "Arjun", "Arjun and Asha", "Arjun, Asha and 3 others".
function namesOf(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 2) return unique.join(' and ');
  if (unique.length === 3) return `${unique[0]}, ${unique[1]} and ${unique[2]}`;
  return `${unique[0]}, ${unique[1]} and ${unique.length - 2} others`;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const LOOK_MS = 4200; // how long a moment without a voice stays lit during a replay
// A recording with nothing in it. Playing it inside the tap lets phones play the real voices after.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

// Walks through the page from the first moment to the last: scrolls each one
// into view, lights it, and plays its voice if it has one.
function useReplay(moments: Moment[]) {
  const [at, setAt] = useState<number | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const list = useRef(moments);
  list.current = moments;

  useEffect(() => {
    if (at === null) return;
    const moment = list.current[at];
    if (!moment) {
      setAt(null);
      return;
    }

    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelector(`[data-moment="${moment.id}"]`)?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });

    const audio = player.current;
    const voice = voiceOf(moment);
    let timer = 0;
    const next = () => setAt((n) => (n === null ? null : n + 1));
    const wait = (ms: number) => {
      timer = window.setTimeout(next, ms);
    };

    if (audio && voice) {
      audio.onended = next;
      audio.onerror = () => wait(LOOK_MS);
      audio.src = voice;
      audio.play().catch(() => wait(LOOK_MS));
    } else {
      wait(moment.type === 'hichkis' ? 2600 : LOOK_MS);
    }

    return () => {
      window.clearTimeout(timer);
      if (audio) {
        audio.onended = null;
        audio.onerror = null;
        audio.pause();
      }
    };
  }, [at]);

  return {
    at,
    lit: at === null ? null : (moments[at]?.id ?? null),
    start: () => {
      // One player for the whole replay, started by this tap, so phones let every voice through.
      player.current ??= new Audio();
      player.current.src = SILENCE;
      player.current.play().catch(() => {});
      setAt(0);
    },
    stop: () => setAt(null),
  };
}

export function Yaadein({
  id,
  who,
  ownsAddress = false,
  onRoom,
}: {
  id: string;
  who: KeepsakeWho;
  ownsAddress?: boolean; // true when this is the whole page, not shown inside the away screen
  onRoom?: () => void;
}) {
  const [data, setData] = useState<Keepsake | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [base, setBase] = useState('');
  const whoKey = JSON.stringify(who);

  // Load once, then keep up while the celebration is still going.
  useEffect(() => {
    let alive = true;
    const load = () =>
      getKeepsake(id, who).then(
        (k) => {
          if (!alive) return;
          setRoomLang(k.gathering.roomLang);
          setData(k);
        },
        (e: Error) => alive && setError(e.message),
      );
    load();
    const every = window.setInterval(() => document.visibilityState === 'visible' && load(), 20_000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    publicBaseUrl().then((b) => alive && setBase(b));
    return () => {
      alive = false;
      window.clearInterval(every);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, whoKey]);

  const viewer = data?.viewer;
  const key = data?.key ?? (who.role === 'visitor' ? who.key : null);

  // Private tokens don't stay in the address bar. What is left is the read-only
  // link, so copying the address never hands out the host's or the away person's link.
  useEffect(() => {
    if (!viewer || !ownsAddress) return;
    sessionStorage.setItem(`hichki:yaadein:${id}`, whoKey);
    if (who.role === 'host' || who.role === 'away') {
      if (viewer === 'away') saved.setAwayToken(id, who.token);
      if (viewer === 'host') saved.setHostToken(id, who.token);
    }
    history.replaceState(null, '', `/g/${id}/yaadein${key ? `?k=${key}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, viewer, key, ownsAddress]);

  const occasion = data?.gathering.occasion;
  useEffect(() => {
    if (occasion) document.documentElement.dataset.occasion = occasion;
  }, [occasion]);

  const moments = useMemo(() => (data ? momentsOf(data) : []), [data]);
  const replay = useReplay(moments);

  if (!data) {
    return (
      <main className="screen">
        <p className={error ? 'error' : 'muted'}>{error || 'Loading…'}</p>
      </main>
    );
  }

  const g = data.gathering;
  const away = g.awayName;
  const you = data.viewer === 'away';
  const them = you ? 'you' : away;

  // Moments grouped under the day they happened.
  const days: { key: string; at: number; moments: Moment[] }[] = [];
  for (const m of moments) {
    const last = days[days.length - 1];
    if (last && last.key === dayOf(m.at)) last.moments.push(m);
    else days.push({ key: dayOf(m.at), at: m.at, moments: [m] });
  }

  const taps = data.hichkis.length;
  const answered = moments.filter((m) => m.type === 'ask').length;
  const lettersOpened = moments.filter((m) => m.type === 'letter').length;
  const storiesKept = data.stories.length;
  const sent = data.proofs.length;

  // What each person did, most first.
  const deeds = data.people
    .map((p) => {
      const mine = data.proofs.filter((x) => x.memberId === p.id);
      const photos = mine.filter((x) => x.media !== 'audio').length;
      const voices = mine.length - photos;
      const told = data.stories.filter((s) => s.memberId === p.id).length;
      const thought = data.hichkis.filter((h) => h.memberId === p.id).length;
      const sentThings = [photos && count(photos, 'photo', 'photos'), voices && count(voices, 'voice note', 'voice notes')].filter(Boolean);
      const parts = [
        sentThings.length && `sent ${sentThings.join(' and ')}`,
        told && `recorded ${count(told, 'story', 'stories')}`,
        thought && `thought of ${them} ${thought === 1 ? 'once' : `${thought} times`}`,
      ].filter(Boolean) as string[];
      return { ...p, parts, total: mine.length + told + thought };
    })
    .sort((a, b) => b.total - a.total);
  const carried = deeds.filter((p) => p.total > 0);
  const alsoThere = deeds.filter((p) => p.total === 0);

  const first = moments[0]?.at;
  const last = moments[moments.length - 1]?.at;
  const span = !first || !last ? '' : dayOf(first) === dayOf(last) ? dateOf(first) : `${dateOf(first)} to ${dateOf(last)}`;

  const link = key ? `${base || location.origin}/g/${id}/yaadein?k=${key}` : '';
  async function share() {
    const text = `Everything from ${g.name}, kept in one place: ${link}`;
    if (navigator.share) {
      await navigator.share({ title: `${g.name} · Hichki`, text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    }
  }

  const room = onRoom
    ? null
    : data.viewer === 'host'
      ? `/g/${id}/host`
      : data.viewer === 'guest'
        ? `/g/${id}`
        : data.viewer === 'away'
          ? `/g/${id}/away`
          : null;

  return (
    <main className={`screen yaadein ${moments.length > 1 ? 'has-tabs' : ''}`}>
      <header className="yaad-cover">
        <p className="eyebrow">{g.name}</p>
        <div className="yaad-ring">
          <div className="hero-art" role="img" aria-label={`A ring of dancers holding hands, with a chair kept in the circle for ${away}`} />
          {taps > 0 && (
            <p className="yaad-count">
              <b>{taps}</b>
              <span lang="hi">बार याद किया</span>
            </p>
          )}
        </div>
        <h1>{you ? `${away}, you were there.` : `${away} was there.`}</h1>
        {taps > 0 && (
          <p className="tagline">
            {you ? 'Someone thought of you' : `Someone thought of ${away}`} {taps === 1 ? 'once' : `${taps} times`}.
          </p>
        )}
        {span && <p className="muted">{span}</p>}
        {!g.wrappedAt && (
          <p className="status">
            <span className="dot on" aria-hidden="true" />
            Still going. New moments appear here as they happen.
          </p>
        )}
      </header>

      {moments.length === 0 && (
        <section className="card empty">
          <h2>Nothing to remember yet</h2>
          <p className="muted">Every answered request, opened letter, story and hichki will be kept here, in the order it happened.</p>
        </section>
      )}

      {moments.length > 0 && (
        <ul className="yaad-tally">
          {answered > 0 && (
            <li>
              <b>{answered}</b> {answered === 1 ? 'wish' : 'wishes'} answered
            </li>
          )}
          {sent > 0 && (
            <li>
              <b>{sent}</b> {sent === 1 ? 'photo or voice' : 'photos and voices'} sent for {them}
            </li>
          )}
          {lettersOpened > 0 && (
            <li>
              <b>{lettersOpened}</b> {lettersOpened === 1 ? 'letter' : 'letters'} opened in the room
            </li>
          )}
          {storiesKept > 0 && (
            <li>
              <b>{storiesKept}</b> {storiesKept === 1 ? 'story' : 'stories'} kept
            </li>
          )}
          {carried.length > 0 && (
            <li>
              <b>{carried.length}</b> {carried.length === 1 ? 'person' : 'people'} who made it happen
            </li>
          )}
        </ul>
      )}

      {days.map((d) => (
        <section key={d.key} className="yaad-day">
          <h2>{dateOf(d.at)}</h2>
          <ol className="yaad-line">
            {d.moments.map((m) => (
              <li key={m.id} data-moment={m.id} className={`yaad-moment is-${m.type} ${replay.lit === m.id ? 'is-lit' : ''}`}>
                <MomentView moment={m} you={you} away={away} />
              </li>
            ))}
          </ol>
        </section>
      ))}

      {deeds.length > 0 && (
        <section className="yaad-people">
          <h2>Who carried {them} there</h2>
          <ul>
            {carried.map((p) => (
              <li key={p.id}>
                <b>{p.name}</b>
                <span className="muted">{p.parts.join(' · ')}</span>
              </li>
            ))}
          </ul>
          {alsoThere.length > 0 && (
            <p className="muted small">
              {carried.length ? 'Also in the room' : 'In the room'}: {alsoThere.map((p) => p.name).join(', ')}.
            </p>
          )}
        </section>
      )}

      <footer className="yaad-keep">
        {link && (
          <>
            <button type="button" className="btn btn-primary" onClick={share}>
              {copied ? 'Link copied' : `Share these ${w().memories.toLowerCase()}`}
            </button>
            <p className="muted small">The link you share only lets people look. Nobody can change anything from it.</p>
          </>
        )}
        {onRoom && (
          <button type="button" className="btn" onClick={onRoom}>
            Back to the room
          </button>
        )}
        {room && (
          <a className="btn" href={room}>
            Back to the room
          </a>
        )}
        <p className="muted note" lang="hi">
          हिचकी · किसी ने याद किया
        </p>
      </footer>

      {moments.length > 1 && (
        <nav className="tabs yaad-bar">
          <button type="button" className="is-active" onClick={replay.at === null ? replay.start : replay.stop}>
            {replay.at === null ? 'Relive it, start to end' : `Stop · ${Math.min(replay.at + 1, moments.length)} of ${moments.length}`}
          </button>
        </nav>
      )}
    </main>
  );
}

function MomentView({ moment: m, you, away }: { moment: Moment; you: boolean; away: string }) {
  const them = you ? 'you' : away;

  if (m.type === 'hichkis') {
    const n = m.taps.length;
    const end = m.taps[n - 1].at;
    return (
      <>
        <p className="eyebrow">
          {timeOf(m.at)}
          {timeOf(end) !== timeOf(m.at) ? ` to ${timeOf(end)}` : ''} · Hichki
        </p>
        <p className="yaad-dots" aria-hidden="true">
          {m.taps.slice(0, 60).map((t, i) => (
            <i key={`${t.at}-${i}`} style={{ animationDelay: `${Math.min(i, 30) * 45}ms` }} />
          ))}
        </p>
        <p>
          {namesOf(m.taps.map((t) => t.from))} thought of {them}
          {n > 1 ? `, ${n} times` : ''}.
        </p>
      </>
    );
  }

  if (m.type === 'story') {
    const s = m.story;
    return (
      <>
        <p className="eyebrow">{timeOf(m.at)} · {w().story}</p>
        <p className="request-text">{s.teller} told a story</p>
        <audio src={s.audioUrl} controls preload="none" />
        {s.transcript && (
          <p className="story-original" lang={s.language ?? undefined}>
            {s.transcript}
          </p>
        )}
        {s.translation && s.translation !== s.transcript && <p className="story-translation">{s.translation}</p>}
      </>
    );
  }

  if (m.type === 'letter') {
    const r = m.request;
    return (
      <>
        <p className="eyebrow">
          {timeOf(m.at)} · {you ? 'Your letter opened' : `${away}’s letter opened`}
        </p>
        <p className="request-text">{r.openWhen ? `When ${r.openWhen}` : 'Right when it was meant to'}</p>
        {m.proof && (
          <figure>
            <ProofView proof={m.proof} />
            <figcaption>{m.proof.memberName} showed the moment.</figcaption>
          </figure>
        )}
        {r.audioUrl && <audio src={r.audioUrl} controls preload="none" />}
        {r.transcript && <p className="yaad-words">{r.transcript}</p>}
      </>
    );
  }

  const r = m.request;
  const seen = m.others.filter((p) => p.media !== 'audio');
  const heard = m.others.filter((p) => p.media === 'audio');
  return (
    <>
      <p className="eyebrow">
        {timeOf(m.at)} · {you ? 'You asked' : `${away} asked`}
        {r.kind === 'do' ? `, ${w().behalf.toLowerCase()}` : ''}
      </p>
      <p className="request-text">{r.text}</p>
      {m.picked && (
        <figure>
          <ProofView proof={m.picked} />
          <figcaption>
            {m.picked.caption ? `“${m.picked.caption}” ` : ''}
            From {m.picked.memberName}. {you ? 'You picked this one.' : `${away} picked this one.`}
          </figcaption>
        </figure>
      )}
      {seen.length > 0 && (
        <ul className="yaad-others">
          {seen.map((p) => (
            <li key={p.id}>
              <ProofView proof={p} />
              {p.memberName}
            </li>
          ))}
        </ul>
      )}
      {heard.map((p) => (
        <div key={p.id} className="yaad-voice">
          <ProofView proof={p} />
          <span className="muted small">A voice note from {p.memberName}</span>
        </div>
      ))}
    </>
  );
}
