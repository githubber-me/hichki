import { useEffect, useRef, useState } from 'react';
import { ApiError, saved, type Draft, type Feed, type Kind, type Proof, type Req, type RoomApi , type Story } from '../api.ts';
import { useRoom, type Hichki } from '../live.ts';
import { MemberList } from './MemberList.tsx';
import { CatchUpCard, DutyControl } from '../duty.tsx';
import { ThanksComposer, ThanksView } from '../thanks.tsx';
import { Yaadein } from './Yaadein.tsx';
import { HichkiTimeline, StoryWords, Leaderboard, MicIcon, ProofView, RecordButton, Stories, Tabs, ago, clock, uploadRecording } from '../parts.tsx';

type Tab = 'ask' | 'letters' | 'people';

// The private screen for the person who couldn't come.
export function Away({ id, token: urlToken }: { id: string; token: string }) {
  const token = urlToken || saved.awayToken(id) || '';
  const room = useRoom(id, token ? { role: 'away', token } : null);
  const [tab, setTab] = useState<Tab>('ask');
  const [inRoom, setInRoom] = useState(false);
  const { feed, api } = room;

  useEffect(() => {
    if (token) saved.setAwayToken(id, token);
  }, [id, token]);

  // Tell the room this phone's timezone, so they can see the away person's clock.
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (api && tz && feed && feed.gathering.awayTz !== tz) api.setAwayTz(tz).catch(() => {});
  }, [api, feed?.gathering.awayTz]); // eslint-disable-line react-hooks/exhaustive-deps

  const [caughtUp, setCaughtUp] = useState(false);

  // Duty ran out while the page was open: fetch again so the held hichkis show.
  const dutyUntil = feed?.gathering.duty?.until ?? 0;
  useEffect(() => {
    if (!dutyUntil || !api) return;
    const t = window.setTimeout(() => window.dispatchEvent(new Event('hichki:reload')), Math.max(0, dutyUntil - Date.now()) + 1500);
    return () => window.clearTimeout(t);
  }, [dutyUntil, api]);

  if (!token) return <main className="screen"><p className="error">This link is incomplete. Ask the host to send it again.</p></main>;
  if (room.error) return <main className="screen"><p className="error">{room.error}</p></main>;
  if (!feed || !api) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;

  const g = feed.gathering;

  // Once the host wraps up, this same link opens on what the celebration left behind.
  // The room is still there underneath, one tap away.
  if (g.wrappedAt && !inRoom) return <Yaadein id={id} who={{ role: 'away', token }} onRoom={() => setInRoom(true)} />;

  const here = feed.presence.members.filter((m) => m.online).length;
  const tabs: [Tab, string][] = [['ask', 'Ask']];
  if (feed.flags.jab_kholna) tabs.push(['letters', 'Letters']);
  tabs.push(['people', `People (${feed.presence.members.length})`]);

  return (
    <main className="screen has-tabs away">
      <header className="room-head">
        <p className="eyebrow">{g.name}</p>
        <h1>Namaste, {g.awayName}</h1>
        <p className="status">
          <span className={`dot ${here ? 'on' : ''}`} aria-hidden="true" />
          {here ? `${here} ${here === 1 ? 'person is' : 'people are'} there right now` : 'Nobody has the page open right now'}
        </p>
        <a className="yaad-link" href={`/g/${id}/yaadein?t=${token}`}>
          {g.wrappedAt ? 'Your yaadein' : 'Your yaadein so far'}
        </a>
      </header>

      <HichkiMoment hichki={room.hichki} />
      {feed.catchUp && !caughtUp && <CatchUpCard api={api} feed={feed} catchUp={feed.catchUp} onDone={() => setCaughtUp(true)} />}
      {tab === 'ask' && <HichkiTimeline entries={feed.hichkis ?? []} awayName="you" limit={3} />}

      {tab === 'ask' && (
        <>
          <DutyControl api={api} gathering={g} onChange={() => setCaughtUp(false)} />
          <Composer api={api} feed={feed} />
          <MyRequests api={api} feed={feed} now={room.now()} />
          {feed.stories.some((s) => !s.requestId) && <Stories api={api} stories={feed.stories.filter((s) => !s.requestId)} canRecord={false} />}
          <Leaderboard presence={feed.presence} limit={5} />
        </>
      )}
      {tab === 'letters' && feed.flags.jab_kholna && <Letters api={api} feed={feed} />}
      {tab === 'people' && (
        <MemberList presence={feed.presence} onHichki={feed.flags.hichki ? (mid) => api.hichkiBack(mid) : undefined} />
      )}

      <Tabs<Tab> tabs={tabs} value={tab === 'letters' && !feed.flags.jab_kholna ? 'ask' : tab} onChange={setTab} />
    </main>
  );
}

// "Kisi ne yaad kiya": plays when someone at the gathering taps Hichki.
function HichkiMoment({ hichki }: { hichki: Hichki | null }) {
  const [show, setShow] = useState<Hichki | null>(null);

  useEffect(() => {
    if (!hichki) return;
    setShow(hichki);
    navigator.vibrate?.([120, 80, 120]);
    hic();
    const t = window.setTimeout(() => setShow(null), 6000);
    return () => window.clearTimeout(t);
  }, [hichki]);

  if (!show) return null;
  return (
    <div className="hichki-toast" role="status" key={show.at}>
      <span className="hichki-art" aria-hidden="true" />
      <div>
        <p className="hichki-line" lang="hi">
          किसी ने याद किया
        </p>
        <p className="muted">
          {show.from} thought of you, just now{show.note ? <>, <em>{show.note}</em></> : null}
        </p>
      </div>
    </div>
  );
}

// A small two-note "hic". Browsers only allow sound after the person has touched
// the page once, so this stays silent until then.
function hic() {
  try {
    const ctx = new AudioContext();
    [0, 0.16].forEach((at, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i ? 880 : 660;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.16);
    });
    window.setTimeout(() => ctx.close(), 800);
  } catch {
    // No sound is fine; the screen and the buzz still say it.
  }
}

// A closed phone can't be woken, so say what arrived while it was away.

// Datetime inputs work in the phone's own time zone.
function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

// Speak (or type) a request, check the card, then send it now or schedule it.
function Composer({ api, feed }: { api: RoomApi; feed: Feed }) {
  const [draft, setDraft] = useState<Partial<Draft> | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('see');
  const [later, setLater] = useState(false);
  const [liveAt, setLiveAt] = useState(() => toLocalInput(Date.now() + 10 * 60000));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const voice = feed.flags.ai_requests;

  function open(d: Partial<Draft>, note = '') {
    setDraft(d);
    setText(d.text ?? '');
    setKind(d.kind === 'do' ? 'do' : d.kind === 'story' ? 'story' : 'see');
    setError(note);
    window.setTimeout(() => box.current?.focus(), 50);
  }

  async function spoken(blob: Blob) {
    setBusy('Listening…');
    setError('');
    try {
      const up = await uploadRecording(api, blob);
      open(await api.draft(up.file));
    } catch (e) {
      // 409 means voice is switched off; anything else means Sarvam couldn't help.
      const off = e instanceof ApiError && e.status === 409;
      open({}, off ? 'Voice is switched off right now. Type it instead.' : 'We couldn’t catch that. Type it instead.');
    }
    setBusy('');
  }

  async function send() {
    if (!text.trim()) {
      setError('Say what you’d like to see, or what someone should do for you.');
      return;
    }
    setBusy('Sending…');
    try {
      await api.createRequest({
        kind,
        text: text.trim(),
        textOriginal: draft?.textOriginal,
        transcript: draft?.transcript,
        language: draft?.language,
        liveAt: later ? new Date(liveAt).getTime() : null,
      });
      setDraft(null);
      setText('');
      setLater(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  }

  if (!draft) {
    return (
      <section className="composer">
        {voice && (
          <RecordButton
            onDone={spoken}
            disabled={!!busy}
            className="away-mic"
            idle={busy ? <span className="recording-count"><small>{busy}</small></span> : <MicIcon />}
          />
        )}
        <h2>{voice ? 'Tap and speak' : 'Ask the room'}</h2>
        <p className="muted">Ask to see something, or ask someone to do something for you. Hindi works too.</p>
        <button type="button" className="btn btn-quiet" onClick={() => open({})}>
          {voice ? 'Type it instead' : 'Write a request'}
        </button>
        {error && <p className="error">{error}</p>}
        {feed.packs.length > 0 && (
          <div className="ideas">
            <p className="eyebrow">Ideas for the {feed.gathering.occasion}</p>
            <ul>
              {feed.packs.map((idea) => (
                <li key={idea.text}>
                  <button type="button" className={`idea idea-${idea.kind}`} onClick={() => open({ kind: idea.kind, text: idea.text })}>
                    {idea.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card composer-card">
      <p className="eyebrow">Check it before it goes to the room</p>
      {draft.textOriginal && draft.textOriginal !== text && (
        <p className="request-original" lang={draft.language ?? undefined}>
          You said: {draft.textOriginal}
        </p>
      )}
      <div className="choice">
        <button type="button" className={kind === 'see' ? 'is-active' : ''} onClick={() => setKind('see')}>
          Show me
        </button>
        <button type="button" className={kind === 'do' ? 'is-active' : ''} onClick={() => setKind('do')}>
          Do this for me
        </button>
        <button type="button" className={kind === 'story' ? 'is-active' : ''} onClick={() => setKind('story')}>
          Tell me a story
        </button>
      </div>
      <label className="field">
        <span>{kind === 'see' ? 'What do you want to see?' : kind === 'story' ? 'Whose story, and about what?' : 'What should someone do for you?'}</span>
        <textarea
          ref={box}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          placeholder={kind === 'see' ? 'Show me Dadi when she sees the bride' : kind === 'story' ? 'Ask Dadi how she celebrated Diwali as a girl' : 'Touch Nani’s feet for me'}
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} /> Send it later
      </label>
      {later && (
        <label className="field">
          <span>When should the room see it?</span>
          <input type="datetime-local" value={liveAt} min={toLocalInput(Date.now())} onChange={(e) => setLiveAt(e.target.value)} />
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={send} disabled={!!busy}>
          {busy || (later ? 'Schedule it' : 'Send to the room')}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setDraft(null)} disabled={!!busy}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// Everything the away person has asked for: waiting, scheduled, and answered.
function MyRequests({ api, feed, now }: { api: RoomApi; feed: Feed; now: number }) {
  const asks = feed.requests.filter((r) => r.kind !== 'letter' && r.status !== 'closed');
  if (asks.length === 0) return null;
  return (
    <section className="my-requests">
      <h2>What you asked for</h2>
      {asks.map((r) => (
        <MyRequest key={r.id} request={r} proofs={feed.proofs.filter((p) => p.requestId === r.id)} stories={feed.stories} api={api} now={now} />
      ))}
    </section>
  );
}

function MyRequest({ request, proofs, stories, api, now }: { request: Req; proofs: Proof[]; stories: Story[]; api: RoomApi; now: number }) {
  // For a story request, each recorded answer is also a story with its words written down.
  const storyOf = (p: Proof) => stories.find((s) => s.requestId === request.id && s.audioUrl === p.url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const won = proofs.find((p) => p.id === request.acceptedProofId);

  return (
    <article className={`card request-card is-${request.status}`}>
      <p className="eyebrow">
        {request.status === 'scheduled' && <span className="badge">Scheduled for {clock(request.liveAt)}</span>}
        {request.status === 'open' && `Asked ${ago(request.liveAt, now)}`}
        {request.status === 'done' && 'Answered'}
      </p>
      <p className="request-text">{request.text}</p>

      {request.status === 'scheduled' && (
        <>
          <p className="muted small">Nobody at the gathering can see this yet.</p>
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => run(() => api.closeRequest(request.id))}>
            Cancel it
          </button>
        </>
      )}

      {request.status === 'open' && proofs.length === 0 && <p className="muted small">Waiting for someone to answer.</p>}

      {request.status === 'open' && proofs.length > 0 && (
        <>
          <p className="muted small">Pick the one you love. That person gets 10 points.</p>
          <ul className="proof-grid">
            {proofs.map((p) => (
              <li key={p.id}>
                <ProofView proof={p} />
                {storyOf(p) && <StoryWords story={storyOf(p)!} />}
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => api.accept(request.id, p.id))}>
                  Pick {p.memberName}&rsquo;s
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {won && (
        <>
          <ProofView proof={won} />
          {storyOf(won) && <StoryWords story={storyOf(won)!} />}
          <p className="muted small">From {won.memberName}.</p>
          {won.thanks ? <ThanksView thanks={won.thanks} from="You" /> : <ThanksComposer api={api} proof={won} />}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

// Jab kholna: record a letter now, and choose the moment or the time it opens.
function Letters({ api, feed }: { api: RoomApi; feed: Feed }) {
  const [file, setFile] = useState('');
  const [openWhen, setOpenWhen] = useState('');
  const [timed, setTimed] = useState(false);
  const [unlockAt, setUnlockAt] = useState(() => toLocalInput(Date.now() + 60 * 60000));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const letters = feed.requests.filter((r) => r.kind === 'letter');

  async function recorded(blob: Blob) {
    setBusy('Saving…');
    setError('');
    try {
      setFile((await uploadRecording(api, blob)).file);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  }

  async function seal() {
    if (!openWhen.trim() && !timed) {
      setError('Say the moment that opens it, or pick a time.');
      return;
    }
    setBusy('Sealing…');
    try {
      await api.createRequest({
        kind: 'letter',
        audioFile: file,
        openWhen: openWhen.trim() || undefined,
        unlockAt: timed ? new Date(unlockAt).getTime() : null,
      });
      setFile('');
      setOpenWhen('');
      setTimed(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy('');
  }

  return (
    <section className="letters">
      <header className="section-head">
        <h2>
          Jab kholna <small>open when</small>
        </h2>
        <p className="muted">Record a voice letter now. It stays sealed until its moment comes, then plays for the whole room.</p>
      </header>

      <div className="card letter-composer">
        {!file ? (
          <RecordButton
            onDone={recorded}
            disabled={!!busy}
            className="btn btn-primary"
            idle={
              <>
                <MicIcon /> {busy || 'Record a letter (30 seconds)'}
              </>
            }
          />
        ) : (
          <>
            <p className="banner">Recorded. Now choose when it opens.</p>
            <label className="field">
              <span>Open when&hellip;</span>
              <input value={openWhen} onChange={(e) => setOpenWhen(e.target.value)} placeholder="the cake is cut" maxLength={80} />
            </label>
            <label className="check">
              <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Also open it at a set time
            </label>
            {timed && (
              <label className="field">
                <span>Opens at</span>
                <input type="datetime-local" value={unlockAt} min={toLocalInput(Date.now())} onChange={(e) => setUnlockAt(e.target.value)} />
              </label>
            )}
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={seal} disabled={!!busy}>
                {busy || 'Seal the letter'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setFile('')} disabled={!!busy}>
                Record again
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      {letters.map((l) => {
        const proofs = feed.proofs.filter((p) => p.requestId === l.id);
        return (
          <article key={l.id} className={`card letter-card is-${l.status}`}>
            <p className="eyebrow">
              {l.status === 'unlocked' ? 'Opened' : l.status === 'scheduled' ? `Appears at ${clock(l.liveAt)}` : 'Sealed'}
            </p>
            <p className="request-text">
              {l.openWhen ? `Open when ${l.openWhen}` : l.unlockAt ? `Opens at ${clock(l.unlockAt)}` : 'A letter'}
            </p>
            {l.audioUrl && <audio src={l.audioUrl} controls preload="none" />}
            {l.status === 'locked' && proofs.length > 0 && <OpenLetter api={api} letter={l} proofs={proofs} />}
            {l.status === 'locked' && proofs.length === 0 && l.openWhen && (
              <p className="muted small">It opens when someone shows you the moment and you say yes.</p>
            )}
          </article>
        );
      })}
    </section>
  );
}

// Someone says the moment happened. Saying yes opens the letter for the room.
function OpenLetter({ api, letter, proofs }: { api: RoomApi; letter: Req; proofs: Proof[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open(proofId: string) {
    setBusy(true);
    try {
      await api.accept(letter.id, proofId);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <>
      <p className="muted small">Is this the moment? Saying yes plays your letter for everyone.</p>
      <ul className="proof-grid">
        {proofs.map((p) => (
          <li key={p.id}>
            <ProofView proof={p} />
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => open(p.id)}>
              Yes, open it
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </>
  );
}
