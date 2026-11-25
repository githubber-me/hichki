// Gallery: every photo and video people sent, in one place. Tap one to see it full
// screen, with who sent it and what it was for, and save it.

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Feed, Proof } from './api.ts';
import { clock } from './parts.tsx';
import { T } from './lang.tsx';

export function Gallery({ feed, me }: { feed: Feed; me?: string }) {
  const away = feed.gathering.awayName;
  const reqById = new Map(feed.requests.map((r) => [r.id, r]));
  const [only, setOnly] = useState<'all' | 'best'>('all');
  const [open, setOpen] = useState<number | null>(null);

  const picked = (p: Proof) => reqById.get(p.requestId)?.acceptedProofId === p.id;
  const all = feed.proofs
    .filter((p) => (p.media === 'photo' || p.media === 'video') && !p.setAside)
    .sort((a, b) => b.createdAt - a.createdAt);
  const shown = only === 'best' ? all.filter((p) => picked(p) || p.loved) : all;

  if (all.length === 0) {
    return (
      <section className="card empty gallery-empty">
        <h2>No photos yet</h2>
        <p className="muted">Every photo and video sent for {away} lands here, so the whole family can look through them.</p>
      </section>
    );
  }

  return (
    <section className="gallery">
      <div className="chips" role="tablist">
        <button type="button" role="tab" aria-selected={only === 'all'} className={only === 'all' ? 'is-active' : ''} onClick={() => setOnly('all')}>
          All <small>{all.length}</small>
        </button>
        <button type="button" role="tab" aria-selected={only === 'best'} className={only === 'best' ? 'is-active' : ''} onClick={() => setOnly('best')}>
          Picked and loved <small>{all.filter((p) => picked(p) || p.loved).length}</small>
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="muted empty">Nothing picked or loved yet.</p>
      ) : (
        <ul className="gallery-grid">
          {shown.map((p, i) => (
            <li key={p.id} className={picked(p) ? 'is-picked' : p.loved ? 'is-loved' : ''}>
              <button type="button" onClick={() => setOpen(i)} aria-label={`Open ${p.media} from ${p.memberName}`}>
                {p.media === 'photo' ? <img src={p.url} alt="" loading="lazy" /> : <video src={p.url} muted playsInline preload="metadata" />}
                {p.media === 'video' && <span className="gallery-play" aria-hidden="true" />}
                {(picked(p) || p.loved) && <span className="gallery-mark" aria-hidden="true">{picked(p) ? '★' : '♥'}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && shown[open] && (
        <Viewer
          items={shown}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          caption={(p) => {
            const r = reqById.get(p.requestId);
            return (
              <>
                <b>{p.memberId === me ? 'You' : p.memberName}</b>
                {r?.text && (
                  <>
                    {' '}for &ldquo;<T text={r.text} toggle={false} />&rdquo;
                  </>
                )}
                <span className="muted"> &middot; {clock(p.createdAt)}</span>
                {picked(p) && <span className="badge">{away} picked it</span>}
                {!picked(p) && p.loved && <span className="badge">&hearts; {away} loved it</span>}
              </>
            );
          }}
        />
      )}
    </section>
  );
}

function Viewer({
  items,
  index,
  onIndex,
  onClose,
  caption,
}: {
  items: Proof[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  caption: (p: Proof) => React.ReactNode;
}) {
  const p = items[index];
  const prev = () => onIndex((index - 1 + items.length) % items.length);
  const next = () => onIndex((index + 1) % items.length);

  // Arrow keys and Escape, for laptops.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Swipe left or right on a phone.
  const [startX, setStartX] = useState<number | null>(null);

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div
        className="viewer-media"
        onTouchStart={(e) => setStartX(e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (startX === null) return;
          const dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 50) (dx > 0 ? prev : next)();
          setStartX(null);
        }}
      >
        {p.media === 'photo' ? <img src={p.url} alt="" /> : <video key={p.id} src={p.url} controls autoPlay playsInline />}
      </div>
      <div className="viewer-bar">
        <p className="viewer-caption">{caption(p)}</p>
        <div className="viewer-actions">
          <button type="button" className="btn btn-quiet btn-small" onClick={prev} disabled={items.length < 2}>
            Previous
          </button>
          <a className="btn btn-quiet btn-small" href={p.url} download>
            Save
          </a>
          <button type="button" className="btn btn-quiet btn-small" onClick={next} disabled={items.length < 2}>
            Next
          </button>
        </div>
      </div>
      <button type="button" className="camera-close" onClick={onClose} aria-label="Close">
        &times;
      </button>
    </div>,
    document.body,
  );
}
