import { useEffect, useState, type FormEvent } from 'react';
import { api, saved, type Member, type PublicGathering } from '../api.ts';
import { useLive } from '../live.ts';
import { MemberList } from './MemberList.tsx';

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
      <header className="hero">
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

function Room({ gathering, member }: { gathering: PublicGathering; member: Member }) {
  const { presence, error } = useLive({ gatheringId: gathering.id, role: 'guest', memberId: member.id });

  if (error) return <main className="screen"><p className="error">{error}</p></main>;

  return (
    <main className="screen">
      <header className="hero">
        <p className="muted">Hi {member.name}</p>
        <h1>{gathering.name}</h1>
        <p className="status">
          <span className={`dot ${presence?.awayOnline ? 'on' : ''}`} aria-hidden="true" />
          {presence?.awayOnline
            ? `${gathering.awayName} is with you right now`
            : `${gathering.awayName} will see everything you share`}
        </p>
      </header>

      <MemberList presence={presence} me={member.id} />
    </main>
  );
}
