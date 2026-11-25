import { useState } from 'react';
import type { Presence } from '../api.ts';

// Everyone in the gathering, people online first, with a dot for who's here now.
// Signed-in guests show their photo and a verified mark. The host can remove people.
export function MemberList({
  presence,
  me,
  onRemove,
  onHichki,
}: {
  presence: Presence | null;
  me?: string;
  onRemove?: (memberId: string) => Promise<void>;
  onHichki?: (memberId: string) => Promise<unknown>;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');

  if (!presence) return <p className="muted">Connecting&hellip;</p>;
  const members = [...presence.members].sort((a, b) => Number(b.online) - Number(a.online));
  const here = members.filter((m) => m.online).length;

  if (members.length === 0) return <p className="muted">Nobody has joined yet. Share the QR code.</p>;

  async function remove(id: string) {
    setError('');
    try {
      await onRemove?.(id);
    } catch (err) {
      setError((err as Error).message);
    }
    setConfirming(null);
  }

  return (
    <section className="card">
      <h2>
        {here} here now <span className="muted">&middot; {members.length} joined</span>
      </h2>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.id} className={m.online ? 'online' : ''}>
            {m.avatarUrl ? (
              <img className="avatar" src={m.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="dot" aria-hidden="true" />
            )}
            <span className="member-name">{m.name}</span>
            {m.verified && (
              <span className="badge badge-verified" title="Signed in">
                verified
              </span>
            )}
            {m.id === me && <span className="badge">you</span>}
            {onHichki && (
              <button
                type="button"
                className="btn btn-quiet btn-small member-remove"
                onClick={async () => {
                  setError('');
                  try {
                    await onHichki(m.id);
                    setSentTo(m.id);
                    window.setTimeout(() => setSentTo((s) => (s === m.id ? null : s)), 3000);
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                {sentTo === m.id ? 'Sent' : 'Hichki'}
              </button>
            )}
            {onRemove &&
              (confirming === m.id ? (
                <span className="member-actions">
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => remove(m.id)}>
                    Remove {m.name}
                  </button>
                  <button type="button" className="btn btn-quiet btn-small" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-quiet btn-small member-remove" onClick={() => setConfirming(m.id)}>
                  Remove
                </button>
              ))}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
