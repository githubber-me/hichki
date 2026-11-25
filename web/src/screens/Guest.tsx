import { useEffect, useState, type FormEvent } from 'react';
import { api, saved, type Member, type Proof, type PublicGathering, type Req, type RoomApi } from '../api.ts';
import { useRoom } from '../live.ts';
import { MemberList } from './MemberList.tsx';
import { HichkiButton, Leaderboard, MicIcon, PhotoButton, ProofView, RecordButton, Stories, Tabs, clock, uploadPhoto, uploadRecording } from '../parts.tsx';

// What the QR code opens. First visit asks for a name; after that the phone remembers.
export function Guest({ id }: { id: string }) {
  const [gathering, setGathering] = useState<PublicGathering | null>(null);
  const [member, setMember] = useState<Member | null>(() => saved.member(id));
  const [error, setError] = useState('');

  useEffect(() => {
    api.getGathering(id).then((r) => setGathering(r.gathering), (e) => setError(e.message));
  }, [id]);

  if (error) return <main className="screen"><p className="error">{error}</p></main>;
  if (!gathering) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;
  if (!member) return <Join gathering={gathering} onJoined={setMember} />;
  return <Room gathering={gathering} member={member} />;
}

function Join({ gathering, onJoined }: { gathering: PublicGathering; onJoined: (m: Member) => void }) {
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
      <header className="hero hero-join">
        <p className="muted">You&rsquo;re invited to</p>
        <h1>{gathering.name}</h1>
        <p>
          {gathering.awayName} couldn&rsquo;t be here. Join so they can be part of it through you.
        </p>
      </header>

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
      {tab === 'people' && <MemberList presence={feed.presence} me={member.id} />}

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
