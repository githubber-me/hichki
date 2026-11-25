import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, getKeepsake, publicBaseUrl, saved, type PublicGathering, type RoomApi } from '../api.ts';
import { useRoom } from '../live.ts';
import { MemberList } from './MemberList.tsx';
import { HichkiButton, Leaderboard } from '../parts.tsx';

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
      </section>

      {room.api && room.feed?.flags.hichki && <HichkiButton api={room.api} awayName={gathering.awayName} />}
      {presence && <Leaderboard presence={presence} limit={5} />}
      <MemberList presence={presence} />

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
        {wrapped ? 'Wrapped up' : 'When it’s all over'} <small>yaadein, what’s left to keep</small>
      </h2>
      <p className="muted">
        {wrapped
          ? `${away}’s link now opens on their yaadein. Send the page to the family too: the link only lets people look.`
          : `Wrap up, and everything that happened becomes ${away}’s yaadein: every photo, voice note, letter and hichki on one page, in the order it happened.`}
      </p>
      {wrapped ? (
        <button type="button" className="btn btn-primary" onClick={share} disabled={!link}>
          {copied ? 'Link copied' : 'Share the yaadein'}
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => wrap(true)} disabled={busy}>
          {busy ? 'Wrapping up…' : 'Wrap up the celebration'}
        </button>
      )}
      <a className="btn" href={`/g/${gathering.id}/yaadein?t=${token}`}>
        {wrapped ? 'Open the yaadein' : 'See the yaadein so far'}
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
