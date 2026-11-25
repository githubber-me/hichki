import { useState, type FormEvent } from 'react';
import { api, saved } from '../api.ts';

const OCCASIONS = ['wedding', 'diwali', 'christmas', 'new year', 'eid', 'birthday', 'gathering'];

export function Create() {
  const [name, setName] = useState('');
  const [awayName, setAwayName] = useState('');
  const [occasion, setOccasion] = useState('wedding');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !awayName.trim()) {
      setError('Give the gathering a name and say who couldn’t come.');
      return;
    }
    setBusy(true);
    try {
      const { gathering, hostToken, awayToken } = await api.createGathering(name, occasion, awayName);
      saved.setHostToken(gathering.id, hostToken);
      saved.setAwayToken(gathering.id, awayToken);
      location.href = `/g/${gathering.id}/host?t=${hostToken}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="screen">
      <header className="hero">
        <h1>Hichki</h1>
        <p className="tagline">Kisi ne yaad kiya.</p>
        <p>Give the person who couldn&rsquo;t come a real place at the gathering.</p>
      </header>

      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>What are you celebrating?</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={"Priya and Aman\u2019s wedding"} maxLength={80} />
        </label>

        <label className="field">
          <span>Occasion</span>
          <select value={occasion} onChange={(e) => setOccasion(e.target.value)}>
            {OCCASIONS.map((o) => (
              <option key={o} value={o}>
                {o[0].toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Who couldn&rsquo;t come?</span>
          <input value={awayName} onChange={(e) => setAwayName(e.target.value)} placeholder="Meera" maxLength={40} />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create gathering'}
        </button>
      </form>
    </main>
  );
}
