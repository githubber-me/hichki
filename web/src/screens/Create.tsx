import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, saved } from '../api.ts';
import { AWAY_REASONS, HICHKI_SCRIPT, ROOM_LANGS } from '../words.ts';
import { READ_LANGUAGES } from '../lang.tsx';

const OCCASIONS = ['wedding', 'diwali', 'christmas', 'new year', 'eid', 'birthday', 'trip', 'gathering'];

export function Create() {
  const [name, setName] = useState('');
  const [awayName, setAwayName] = useState('');
  const [occasion, setOccasion] = useState('wedding');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [roomLang, setRoomLangChoice] = useState('hi');
  const [readLang, setReadLang] = useState('');
  const [awayReason, setAwayReason] = useState('');
  const [others, setOthers] = useState<{ name: string; reason: string }[]>([]);
  const more = useRef<HTMLDetailsElement>(null);
  // The verified switch only appears when this server has sign-in set up.
  const [canVerify, setCanVerify] = useState(false);
  useEffect(() => {
    api.config().then((c) => setCanVerify(!!c.signIn), () => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !awayName.trim()) {
      setError('Give the gathering a name and say who couldn’t come.');
      return;
    }
    setBusy(true);
    try {
      const { gathering, hostToken, awayToken } = await api.createGathering(name, occasion, awayName, verified, roomLang, { readLang, awayReason: awayReason || null, others: others.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), reason: o.reason || null })) });
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
      <header className="hero hero-create">
        {/* A ring of dancers with one gap, and an empty chair standing in it. */}
        <div className="hero-art" role="img" aria-label="A ring of dancers holding hands, with one empty chair in the gap" />
        <HichkiScripts />
        <h1 className="hero-title">Hichki</h1>
        <p className="tagline">Kisi ne yaad kiya.</p>
        <p className="muted">Give the person who couldn&rsquo;t come a real place at the gathering.</p>
      </header>

      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>What are you celebrating?</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={"Priya and Aman\u2019s wedding"} maxLength={80} />
        </label>

        <label className="field">
          <span>Who couldn&rsquo;t come?</span>
          <input value={awayName} onChange={(e) => setAwayName(e.target.value)} placeholder="Meera" maxLength={40} />
        </label>
        <button
          type="button"
          className="link-quiet more-people-hint"
          onClick={() => {
            if (more.current) more.current.open = true;
            if (others.length === 0) setOthers([{ name: '', reason: '' }]);
            window.setTimeout(() => more.current?.querySelector<HTMLInputElement>('.other-row input')?.focus(), 50);
          }}
        >
          More than one person can&rsquo;t make it? Add them in Additional settings.
        </button>

        {/* Everything else is optional, and folded away. */}
        <details className="more-settings" ref={more}>
          <summary>Additional settings</summary>

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
            <span>Why can&rsquo;t {awayName.trim() || 'they'} come?</span>
            <select value={awayReason} onChange={(e) => setAwayReason(e.target.value)}>
              {AWAY_REASONS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <small className="muted">Nurses, doctors, soldiers and shift workers get Duty pe ready for them, and ideas made for their situation.</small>
          </label>

          <div className="field others-field">
            <span>Others who couldn&rsquo;t come</span>
            {others.map((o, i) => (
              <div key={i} className="other-row">
                <input
                  value={o.name}
                  onChange={(e) => setOthers(others.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Rahul"
                  maxLength={40}
                  aria-label="Their name"
                />
                <select
                  value={o.reason}
                  onChange={(e) => setOthers(others.map((x, k) => (k === i ? { ...x, reason: e.target.value } : x)))}
                  aria-label="Why they can't come"
                >
                  {AWAY_REASONS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setOthers([...others, { name: '', reason: '' }])}>
              Add another person
            </button>
            <small className="muted">Each one gets their own private link, on the host screen.</small>
          </div>


          <label className="field">
            <span>Names of things in</span>
            <select value={roomLang} onChange={(e) => setRoomLangChoice(e.target.value)}>
              {ROOM_LANGS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <small className="muted">Jab kholna, Dadi ki kahani and the rest follow this. Hichki stays Hichki.</small>
          </label>

          <label className="field">
            <span>Show everything in</span>
            <select value={readLang} onChange={(e) => setReadLang(e.target.value)}>
              {READ_LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <small className="muted">Requests, letters and stories are translated for everyone. The original is always one tap away.</small>
          </label>

          {canVerify && (
            <label className="switch">
              <input type="checkbox" aria-label="Only verified guests" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              <span>
                <strong>Only verified guests</strong>
                <small>Guests sign in with Google or their phone number, so nobody can join under someone else&rsquo;s name.</small>
              </span>
            </label>
          )}
        </details>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create gathering'}
        </button>
      </form>
    </main>
  );
}

// On the landing page there is no room yet, so the name goes through every script:
// हिचकी, ಹಿಚ್ಕಿ, ஹிச்கி... the same word in every family's letters.
const SCRIPTS = Object.entries(HICHKI_SCRIPT).filter(([code]) => code !== 'en' && code !== 'mr');

function HichkiScripts() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % SCRIPTS.length), 2200);
    return () => window.clearInterval(t);
  }, []);
  const [code, text] = SCRIPTS[i];
  return (
    <p className="hero-hindi" lang={code} key={code} aria-label="Hichki">
      {text}
    </p>
  );
}
