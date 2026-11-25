import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, getKeepsake, publicBaseUrl, saved, type PublicGathering, type RoomApi } from '../api.ts';
import { useRoom } from '../live.ts';
import { MemberList } from './MemberList.tsx';
import { AwayClock, DutyBanner } from '../duty.tsx';
import { AWAY_REASONS, ROOM_LANGS, reasonLine, setRoomLang, w } from '../words.ts';
import { READ_LANGUAGES } from '../lang.tsx';
import { HichkiBack } from './Guest.tsx';
import { HichkiButton, HichkiTimeline, Leaderboard } from '../parts.tsx';

export function Host({ id, token: urlToken }: { id: string; token: string }) {
  const token = urlToken || saved.hostToken(id) || '';
  const [gathering, setGathering] = useState<PublicGathering | null>(null);
  const [guestUrl, setGuestUrl] = useState('');
  const [awayUrl, setAwayUrl] = useState('');
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const room = useRoom(id, token ? { role: 'host', token } : null);
  const presence = room.feed?.presence ?? null;
  const liveError = room.error;

  useEffect(() => {
    api.getGathering(id).then((r) => setGathering(r.gathering), (e) => setError(e.message));
    if (token) saved.setHostToken(id, token);
  }, [id, token]);

  // The away link needs the away token, which only the creator's phone has.
  useEffect(() => {
    publicBaseUrl().then(async (base) => {
      const guest = `${base}/g/${id}`;
      setGuestUrl(guest);
      setQr(await QRCode.toString(guest, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#5a2212', light: '#0000' } }));
      const away = saved.awayToken(id);
      if (away) setAwayUrl(`${base}/g/${id}/away?t=${away}`);
    });
  }, [id]);

  async function shareAway() {
    const text = `Join ${gathering?.name ?? 'the gathering'} from wherever you are: ${awayUrl}`;
    if (navigator.share) {
      await navigator.share({ title: 'Hichki', text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(awayUrl);
      setCopied(true);
    }
  }

  if (error || liveError) return <main className="screen"><p className="error">{error || liveError}</p></main>;
  if (!gathering) return <main className="screen"><p className="muted">Loading&hellip;</p></main>;

  return (
    <main className="screen">
      <header className="hero">
        <p className="muted">You&rsquo;re hosting</p>
        <h1>{gathering.name}</h1>
      </header>

      <section className="card qr-card">
        <h2>Scan to join</h2>
        <div className="qr-frame" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="code">
          Or open <strong>{guestUrl.replace(/^https?:\/\//, '')}</strong>
        </p>
      </section>

      <section className="card">
        <h2>Send {gathering.awayName} their link</h2>
        <p className="muted">
          This private link lets {gathering.awayName} take part from wherever they are. It works for the whole
          celebration, so they only need it once.
        </p>
        {awayUrl ? (
          <button className="btn btn-primary" onClick={shareAway}>
            {copied ? 'Link copied' : `Share ${gathering.awayName}’s link`}
          </button>
        ) : (
          <p className="muted">Open this page on the phone that created the gathering to share it.</p>
        )}
        <p className="status">
          <span className={`dot ${presence?.awayOnline ? 'on' : ''}`} aria-hidden="true" />
          {presence?.awayOnline ? `${gathering.awayName} is here now` : `${gathering.awayName} hasn’t opened it yet`}
        </p>
        <AwayClock gathering={room.feed?.gathering ?? gathering} />
        {reasonLine((room.feed?.gathering ?? gathering).awayReason, gathering.awayName) && (
          <p className="reason-line">{reasonLine((room.feed?.gathering ?? gathering).awayReason, gathering.awayName)}</p>
        )}
      </section>

      <DutyBanner gathering={room.feed?.gathering ?? gathering} />
      <HichkiBack moment={room.hichkiBack} />

      {room.api && room.feed?.flags.hichki && <HichkiButton api={room.api} awayName={gathering.awayName} people={room.feed.awayPeople ?? []} />}
      {room.api && room.feed && <OthersAway api={room.api} links={room.feed.awayLinks ?? []} online={room.feed.presence.awayOnlineIds ?? []} />}
      {room.feed && <HichkiTimeline entries={room.feed.hichkis ?? []} awayName={gathering.awayName} limit={3} />}
      {presence && <Leaderboard presence={presence} limit={5} />}
      {room.api && <VerifiedSwitch api={room.api} gathering={room.feed?.gathering ?? gathering} />}
      {room.api && <Settings api={room.api} gathering={room.feed?.gathering ?? gathering} />}
      <MemberList presence={presence} onRemove={room.api ? async (mid) => void (await room.api!.removeMember(mid)) : undefined} />

      {room.api && <WrapUp api={room.api} gathering={room.feed?.gathering ?? gathering} token={token} />}
    </main>
  );
}

// The end of the celebration. Wrapping up locks nothing: it turns the away
// person's link into their yaadein, and gives the host a read-only link to pass on.
function WrapUp({ api: roomApi, gathering, token }: { api: RoomApi; gathering: PublicGathering; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState('');
  const away = gathering.awayName;
  const wrapped = !!gathering.wrappedAt;

  // Worked out ahead of the tap, because phones only open the share sheet straight from a tap.
  useEffect(() => {
    Promise.all([publicBaseUrl(), getKeepsake(gathering.id, { role: 'host', token })]).then(
      ([base, k]) => k.key && setLink(`${base}/g/${gathering.id}/yaadein?k=${k.key}`),
      () => {},
    );
  }, [gathering.id, token]);

  async function wrap(next: boolean) {
    setBusy(true);
    setError('');
    try {
      await roomApi.wrap(next);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  async function share() {
    const text = `Everything from ${gathering.name}, kept in one place: ${link}`;
    if (navigator.share) {
      await navigator.share({ title: `${gathering.name} · Hichki`, text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    }
  }

  return (
    <section className="card wrap-card">
      <h2>
        {wrapped ? 'Wrapped up' : 'When it’s all over'} <small>{w().memories.toLowerCase()}, what’s left to keep</small>
      </h2>
      <p className="muted">
        {wrapped
          ? `${away}’s link now opens on their ${w().memories.toLowerCase()}. Send the page to the family too: the link only lets people look.`
          : `Wrap up, and everything that happened becomes ${away}’s ${w().memories.toLowerCase()}: every photo, voice note, letter and hichki on one page, in the order it happened.`}
      </p>
      {wrapped ? (
        <button type="button" className="btn btn-primary" onClick={share} disabled={!link}>
          {copied ? 'Link copied' : `Share the ${w().memories.toLowerCase()}`}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => wrap(true)} disabled={busy}>
          {busy ? 'Wrapping up…' : 'Wrap up the celebration'}
        </button>
      )}
      <a className="btn" href={`/g/${gathering.id}/yaadein?t=${token}`}>
        {wrapped ? `Open the ${w().memories.toLowerCase()}` : `See the ${w().memories.toLowerCase()} so far`}
      </a>
      {wrapped && (
        <button type="button" className="btn btn-quiet" onClick={() => wrap(false)} disabled={busy}>
          Reopen the gathering
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Verified guests can be turned on or off at any time. People already in stay in.
function VerifiedSwitch({ api: roomApi, gathering }: { api: RoomApi; gathering: PublicGathering }) {
  const [canVerify, setCanVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.config().then((c) => setCanVerify(!!c.signIn), () => {});
  }, []);
  if (!canVerify) return null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError('');
    try {
      await roomApi.setVerified(next);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <section className="card">
      <label className="switch">
        <input type="checkbox" aria-label="Only verified guests" checked={gathering.verified} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        <span>
          <strong>Only verified guests</strong>
          <small>
            {gathering.verified
              ? 'New guests sign in with Google or their phone number. People already here stay in.'
              : 'Anyone with the QR code joins by typing a name. Names must be different from each other.'}
          </small>
        </span>
      </label>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Settings the host can change any time: why the away person can't come, the
// language for names of things, and the language everything is shown in.
function Settings({ api: roomApi, gathering }: { api: RoomApi; gathering: PublicGathering }) {
  const [error, setError] = useState('');
  async function change(s: { roomLang?: string; readLang?: string; awayReason?: string | null }) {
    setError('');
    try {
      const { gathering: g } = await roomApi.settings(s);
      setRoomLang(g.roomLang);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <details className="card more-settings">
      <summary>Settings</summary>
      <label className="field">
        <span>Why can&rsquo;t {gathering.awayName} come?</span>
        <select value={gathering.awayReason ?? ''} onChange={(e) => change({ awayReason: e.target.value || null })}>
          {AWAY_REASONS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Names of things in</span>
        <select value={gathering.roomLang ?? 'hi'} onChange={(e) => change({ roomLang: e.target.value })}>
          {ROOM_LANGS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <small className="muted">
          {w().letter}, {w().story}, {w().memories}. Hichki stays Hichki.
        </small>
      </label>
      <label className="field">
        <span>Show everything in</span>
        <select value={gathering.readLang ?? ''} onChange={(e) => change({ readLang: e.target.value })}>
          {READ_LANGUAGES.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <small className="muted">Translated for every phone, with the original one tap away.</small>
      </label>
      {error && <p className="error">{error}</p>}
    </details>
  );
}

// Everyone else who couldn't come: each gets their own private link to share.
function OthersAway({ api: roomApi, links, online }: { api: RoomApi; links: { id: string; name: string; token: string }[]; online: string[] }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [base, setBase] = useState('');
  useEffect(() => {
    publicBaseUrl().then(setBase);
  }, []);
  const linkFor = (l: { token: string }) => `${base}${location.pathname.replace(/\/host$/, '')}/away?t=${l.token}`;

  async function share(l: { id: string; name: string; token: string }) {
    const url = linkFor(l);
    const text = `Join from wherever you are, ${l.name}: ${url}`;
    if (navigator.share) await navigator.share({ title: 'Hichki', text }).catch(() => {});
    else {
      await navigator.clipboard.writeText(url);
      setCopied(l.id);
    }
  }

  async function add() {
    if (!name.trim()) return setError('Enter their name.');
    setBusy(true);
    setError('');
    try {
      await roomApi.addAwayPerson(name.trim(), reason || null);
      setName('');
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <details className="card more-settings away-people" open={links.length > 0}>
      <summary>Others who couldn&rsquo;t come {links.length > 0 && <small className="muted">({links.length})</small>}</summary>
      {links.map((l) => (
        <div key={l.id} className="away-person">
          <span className={`dot ${online.includes(l.id) ? 'on' : ''}`} aria-hidden="true" />
          <span className="member-name">{l.name}</span>
          <button type="button" className="btn btn-quiet btn-small" onClick={() => share(l)}>
            {copied === l.id ? 'Link copied' : 'Share their link'}
          </button>
        </div>
      ))}
      <label className="field">
        <span>Add someone</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rahul" maxLength={40} />
      </label>
      <label className="field">
        <span>Why can&rsquo;t they come?</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {AWAY_REASONS.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>
        {busy ? 'Adding\u2026' : 'Add, and get their link'}
      </button>
      {error && <p className="error">{error}</p>}
    </details>
  );
}
