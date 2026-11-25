import { useEffect, useState } from 'react';
import { api, type PublicGathering } from '../api.ts';
import { useLive } from '../live.ts';
import { MemberList } from './MemberList.tsx';

// The private screen for the person who couldn't come.
export function Away({ id, token }: { id: string; token: string }) {
  const [gathering, setGathering] = useState<PublicGathering | null>(null);
  const [error, setError] = useState('');
  const { presence, error: liveError } = useLive(token ? { gatheringId: id, role: 'away', token } : null);

  useEffect(() => {
    api.getGathering(id).then((r) => setGathering(r.gathering), (e) => setError(e.message));
  }, [id]);

  if (!token) return <main className="screen"><p className="error">This link is incomplete. Ask the host to send it again.</p></main>;
  if (error || liveError) return <main className="screen"><p className="error">{error || liveError}</p></main>;
  if (!gathering) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;

  return (
    <main className="screen">
      <header className="hero">
        <p className="muted">Welcome, {gathering.awayName}</p>
        <h1>{gathering.name}</h1>
        <p>Everyone here can see your requests and send you what you ask for.</p>
      </header>

      <MemberList presence={presence} />
    </main>
  );
}
