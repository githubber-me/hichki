import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import { api, roomApi, saved, type Member, type Proof, type PublicGathering, type Req, type RoomApi } from '../api.ts';
import { useRoom } from '../live.ts';
import { MemberList } from './MemberList.tsx';
import { HichkiButton, Leaderboard, MicIcon, PhotoButton, ProofView, RecordButton, Stories, Tabs, clock, uploadPhoto, uploadRecording } from '../parts.tsx';

// What the QR code opens. First visit asks for a name; after that the phone remembers.
export function Guest({ id }: { id: string }) {
  const [gathering, setGathering] = useState<PublicGathering | null>(null);
  const [member, setMember] = useState<Member | null>(() => saved.member(id));
  // Right after joining, show people how everyone will see them before they go in.
  const [welcoming, setWelcoming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getGathering(id).then((r) => setGathering(r.gathering), (e) => setError(e.message));
  }, [id]);

  if (error) return <main className="screen"><p className="error">{error}</p></main>;
  if (!gathering) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;
  if (!member) {
    return (
      <Join
        gathering={gathering}
        onJoined={(m) => {
          setMember(m);
          setWelcoming(true);
        }}
      />
    );
  }
  if (welcoming) {
    return <Welcome gathering={gathering} member={member} onChange={setMember} onDone={() => setWelcoming(false)} />;
  }
  return <Room gathering={gathering} member={member} />;
}

// Sign-in is only downloaded when a gathering needs it.
const VerifiedJoin = lazy(() => import('../signin.tsx'));

function Join({ gathering, onJoined }: { gathering: PublicGathering; onJoined: (m: Member) => void }) {
  const [signInKey, setSignInKey] = useState<string | null>(null);
  useEffect(() => {
    if (gathering.verified) api.config().then((c) => setSignInKey(c.signIn?.publishableKey ?? null), () => {});
  }, [gathering.verified]);

  if (gathering.verified) {
    return (
      <main className="screen">
        <JoinHero gathering={gathering} />
        {signInKey ? (
          <Suspense fallback={<p className="muted">Getting sign-in ready&hellip;</p>}>
            <VerifiedJoin publishableKey={signInKey} gathering={gathering} onJoined={onJoined} />
          </Suspense>
        ) : (
          <p className="muted">Getting sign-in ready&hellip;</p>
        )}
      </main>
    );
  }
  return <NameJoin gathering={gathering} onJoined={onJoined} />;
}

function JoinHero({ gathering }: { gathering: PublicGathering }) {
  return (
    <header className="hero hero-join">
      <p className="muted">You&rsquo;re invited to</p>
      <h1>{gathering.name}</h1>
      <p>
        {gathering.awayName} couldn&rsquo;t be here. Join so they can be part of it through you.
      </p>
    </header>
  );
}

function NameJoin({ gathering, onJoined }: { gathering: PublicGathering; onJoined: (m: Member) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Enter your name to join.');
      return;
    }
    setBusy(true);
    try {
      const { member } = await api.join(gathering.id, name);
      saved.setMember(gathering.id, member);
      onJoined(member);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <JoinHero gathering={gathering} />

      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            placeholder="Arjun"
            maxLength={40}
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Joining…' : 'Join'}
        </button>
      </form>
    </main>
  );
}

type Tab = 'room' | 'stories' | 'people';

function Room({ gathering, member }: { gathering: PublicGathering; member: Member }) {
  const room = useRoom(gathering.id, { role: 'guest', memberId: member.id });
  const [tab, setTab] = useState<Tab>('room');
  const { feed, api: roomApi } = room;

  if (room.error) return <main className="screen"><p className="error">{room.error}</p></main>;
  if (!feed || !roomApi) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;

  const away = gathering.awayName;
  const asks = feed.requests.filter((r) => r.kind !== 'letter' && r.status === 'open');
  const letters = feed.requests.filter((r) => r.kind === 'letter' && r.status !== 'scheduled');
  const earlier = feed.requests.filter((r) => r.kind !== 'letter' && r.status === 'done');
  const proofsFor = (r: Req) => feed.proofs.filter((p) => p.requestId === r.id);
  const nameOf = (id: string | null) => feed.presence.members.find((m) => m.id === id)?.name;

  return (
    <main className="screen has-tabs">
      <header className="room-head">
        <h1>{gathering.name}</h1>
        <p className="status">
          <span className={`dot ${feed.presence.awayOnline ? 'on' : ''}`} aria-hidden="true" />
          {feed.presence.awayOnline ? `${away} is with you right now` : `${away} will see everything you send`}
        </p>
      </header>

      {feed.gathering.wrappedAt && (
        <a className="banner" href={`/g/${gathering.id}/yaadein`}>
          That&rsquo;s a wrap. See everything {away} was part of
        </a>
      )}

      {tab === 'room' && (
        <>
          {room.accepted && (
            <p className="banner celebrate" role="status">
              {away} picked {room.accepted.memberId === member.id ? 'yours' : `${room.accepted.memberName}’s`}. +10
            </p>
          )}

          {asks.length === 0 && letters.length === 0 && (
            <section className="card empty">
              <h2>{earlier.length ? 'Nothing is waiting right now' : `${away} hasn’t asked for anything yet`}</h2>
              <p className="muted">
                {earlier.length
                  ? `When ${away} asks again, it shows up here on every phone. Until then, send a hichki.`
                  : 'When they do, it shows up here on every phone. Until then, send a hichki.'}
              </p>
            </section>
          )}

          {asks.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              proofs={proofsFor(r)}
              api={roomApi}
              away={away}
              me={member.id}
              nominee={nameOf(r.nomineeId)}
            />
          ))}

          {feed.flags.jab_kholna &&
            letters.map((r) => <LetterCard key={r.id} letter={r} proofs={proofsFor(r)} api={roomApi} away={away} me={member.id} />)}

          {feed.flags.hichki && <HichkiButton api={roomApi} awayName={away} />}
          {room.hichkiSent && <p className="muted note">{room.hichkiSent.from} sent a hichki at {clock(room.hichkiSent.at)}.</p>}

          <Leaderboard presence={feed.presence} me={member.id} limit={5} />

          {earlier.length > 0 && (
            <section className="earlier">
              <h2>Already answered</h2>
              {earlier.map((r) => {
                const won = feed.proofs.find((p) => p.id === r.acceptedProofId);
                return (
                  <article key={r.id} className="card done-card">
                    <p className="request-text">{r.text}</p>
                    {won && <ProofView proof={won} />}
                    {won && <p className="muted">{away} picked {won.memberId === member.id ? 'yours' : `${won.memberName}’s`}.</p>}
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}

      {tab === 'stories' && <Stories api={roomApi} stories={feed.stories} />}
      {tab === 'people' && (
        <>
          <Profile api={roomApi} gatheringId={gathering.id} me={feed.presence.members.find((m) => m.id === member.id) ?? member} />
          <MemberList presence={feed.presence} me={member.id} />
        </>
      )}

      <Tabs<Tab>
        tabs={[
          ['room', 'Room'],
          ['stories', 'Stories'],
          ['people', `People (${feed.presence.members.length})`],
        ]}
        value={tab}
        onChange={setTab}
      />
    </main>
  );
}

// One thing the away person asked for, with ways to answer it.
function RequestCard({
  request,
  proofs,
  api: roomApi,
  away,
  me,
  nominee,
}: {
  request: Req;
  proofs: Proof[];
  api: RoomApi;
  away: string;
  me: string;
  nominee?: string;
}) {
  const send = useSend(roomApi, request.id);
  const mine = proofs.filter((p) => p.memberId === me).length;

  return (
    <article className={`card request-card kind-${request.kind}`}>
      <p className="eyebrow">
        {request.kind === 'see' ? `${away} wants to see` : `${away} asks, on their behalf`}
        {request.nomineeId === me ? ' · asked for you by name' : nominee ? ` · asked ${nominee}` : ''}
      </p>
      <p className="request-text">{request.text}</p>
      {request.textOriginal && request.textOriginal !== request.text && (
        <p className="request-original" lang={request.language ?? undefined}>
          {request.textOriginal}
        </p>
      )}

      <div className="actions">
        <PhotoButton onPick={send.photo} disabled={send.busy}>
          {send.busy ? 'Sending…' : request.kind === 'see' ? 'Send a photo' : 'Send photo proof'}
        </PhotoButton>
        <RecordButton
          onDone={send.voice}
          disabled={send.busy}
          className="btn btn-quiet"
          idle={
            <>
              <MicIcon /> Voice note
            </>
          }
        />
      </div>
      {send.error && <p className="error">{send.error}</p>}

      <p className="muted small">
        {proofs.length === 0
          ? 'Nobody has sent anything yet. Be the first.'
          : `${proofs.length} sent so far${mine ? `, ${mine} from you` : ''}. ${away} picks one.`}
        {request.until ? ` Open until ${clock(request.until)}.` : ''}
      </p>
    </article>
  );
}

// Jab kholna: a voice letter that stays locked until the room shows its moment happened.
function LetterCard({ letter, proofs, api: roomApi, away, me }: { letter: Req; proofs: Proof[]; api: RoomApi; away: string; me: string }) {
  const send = useSend(roomApi, letter.id);

  if (letter.status === 'unlocked') {
    return (
      <article className="card letter-card is-open">
        <p className="eyebrow">A letter from {away}{letter.openWhen ? ` · for when ${letter.openWhen}` : ''}</p>
        {letter.audioUrl && <audio src={letter.audioUrl} controls preload="none" />}
        {(letter.transcript || letter.text) && <p className="request-text">{letter.transcript || letter.text}</p>}
      </article>
    );
  }

  const sent = proofs.some((p) => p.memberId === me);
  return (
    <article className="card letter-card is-locked">
      <p className="eyebrow">A sealed letter from {away}</p>
      <p className="request-text">
        {letter.openWhen ? `Open when ${letter.openWhen}` : letter.unlockAt ? `Opens at ${clock(letter.unlockAt)}` : 'Opens soon'}
      </p>
      {letter.openWhen && (
        <>
          <div className="actions">
            <PhotoButton onPick={send.photo} disabled={send.busy}>
              {send.busy ? 'Sending…' : 'It’s happening, send a photo'}
            </PhotoButton>
          </div>
          <p className="muted small">
            {sent ? `Sent. It opens when ${away} sees it.` : `${away} opens it for the room when they see the moment.`}
            {letter.unlockAt ? ` Otherwise it opens at ${clock(letter.unlockAt)}.` : ''}
          </p>
        </>
      )}
      {send.error && <p className="error">{send.error}</p>}
    </article>
  );
}

// Upload a photo or a voice note, then attach it to a request as proof.
function useSend(roomApi: RoomApi, requestId: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(upload: () => Promise<{ file: string }>) {
    setBusy(true);
    setError('');
    try {
      const up = await upload();
      await roomApi.sendProof(requestId, up.file);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return {
    busy,
    error,
    photo: (file: File) => run(() => uploadPhoto(roomApi, file)),
    voice: (blob: Blob) => run(() => uploadRecording(roomApi, blob)),
  };
}

// How you appear to everyone: your name and photo. Quiet by default, one tap to change.
// Signed-in guests can change these too; their account stays verified either way.
function Profile({ api: roomApi, gatheringId, me }: { api: RoomApi; gatheringId: string; me: Member }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(changes: { name?: string; photo?: string | null }) {
    setBusy(true);
    setError('');
    try {
      const { member } = await roomApi.updateMe(changes);
      saved.setMember(gatheringId, member);
      if (changes.name !== undefined) setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const stored = await uploadPhoto(roomApi, file);
      await save({ photo: stored.file });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="profile">
      <div className="profile-row">
        {me.avatarUrl ? (
          <img className="profile-photo" src={me.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="profile-photo profile-initial" aria-hidden="true">
            {me.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="profile-name">
          {me.name}
          {me.verified && <span className="badge badge-verified">verified</span>}
        </span>
        {!open && (
          <button type="button" className="btn btn-quiet btn-small" onClick={() => { setName(me.name); setOpen(true); }}>
            Edit
          </button>
        )}
      </div>

      {open && (
        <form
          className="profile-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return setError('Your name can\u2019t be empty.');
            save({ name });
          }}
        >
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={40} />
          </label>
          <div className="profile-actions">
            <label className="btn btn-quiet btn-small">
              {me.avatarUrl ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
            {me.avatarUrl && (
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => save({ photo: null })}>
                Remove photo
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
          <div className="profile-actions">
            <button className="btn btn-primary btn-small" disabled={busy}>
              {busy ? 'Saving\u2026' : 'Save'}
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => { setOpen(false); setError(''); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// "This is you": straight after joining, the guest sees the name and photo everyone
// will see. Signed-in guests start with their account's name and photo. They can
// continue as they are, or change either first.
function Welcome({
  gathering,
  member,
  onChange,
  onDone,
}: {
  gathering: PublicGathering;
  member: Member;
  onChange: (m: Member) => void;
  onDone: () => void;
}) {
  const roomApiForMe = roomApi(gathering.id, { role: 'guest', memberId: member.id });
  const [name, setName] = useState(member.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function update(changes: { name?: string; photo?: string | null }) {
    const { member: updated } = await roomApiForMe.updateMe(changes);
    saved.setMember(gathering.id, updated);
    onChange(updated);
    return updated;
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    await run(async () => {
      const stored = await uploadPhoto(roomApiForMe, file);
      await update({ photo: stored.file });
    });
  }

  async function continueIn(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Your name can\u2019t be empty.');
    setBusy(true);
    setError('');
    try {
      if (name.trim() !== member.name) await update({ name });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <header className="hero hero-join">
        <p className="muted">You&rsquo;re in</p>
        <h1>This is you at {gathering.name}</h1>
        <p>It&rsquo;s how {gathering.awayName} and everyone else will see you. Change anything you like.</p>
      </header>

      <form className="card welcome" onSubmit={continueIn}>
        <div className="welcome-photo">
          {member.avatarUrl ? (
            <img className="profile-photo welcome-big" src={member.avatarUrl} alt="Your photo" referrerPolicy="no-referrer" />
          ) : (
            <span className="profile-photo profile-initial welcome-big" aria-hidden="true">
              {(name.trim() || member.name).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="profile-actions">
            <label className="btn btn-quiet btn-small">
              {member.avatarUrl ? 'Change photo' : 'Add a photo'}
              <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
            {member.avatarUrl && (
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => run(() => update({ photo: null }))}>
                Remove photo
              </button>
            )}
          </div>
        </div>

        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            maxLength={40}
          />
        </label>
        {member.verified && <p className="badge badge-verified">verified</p>}

        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'One moment\u2026' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
