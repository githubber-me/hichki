import type { Presence } from '../api.ts';

// Everyone in the gathering, people online first, with a dot for who's here now.
export function MemberList({ presence, me }: { presence: Presence | null; me?: string }) {
  if (!presence) return <p className="muted">Connecting&hellip;</p>;
  const members = [...presence.members].sort((a, b) => Number(b.online) - Number(a.online));
  const here = members.filter((m) => m.online).length;

  if (members.length === 0) return <p className="muted">Nobody has joined yet. Share the QR code.</p>;

  return (
    <section className="card">
      <h2>
        {here} here now <span className="muted">&middot; {members.length} joined</span>
      </h2>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id} className={m.online ? 'online' : ''}>
            <span className="dot" aria-hidden="true" />
            {m.name}
            {m.id === me && <span className="badge">you</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
