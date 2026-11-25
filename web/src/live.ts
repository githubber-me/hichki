// Live connection to the gathering. Every phone in a gathering shares one room.
// useRoom loads the feed once, then keeps it fresh from Socket.IO events.

import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { roomApi, type Feed, type Flags, type Presence, type Proof, type Req, type Story, type Who } from './api.ts';

export type Hichki = { from: string; at: number };
export type Accepted = { requestId: string; proofId: string; memberId: string; memberName: string; points: number };

export function useRoom(id: string, who: Who | null) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Moments to play on screen. Each new one replaces the last.
  const [hichki, setHichki] = useState<Hichki | null>(null);
  const [hichkiSent, setHichkiSent] = useState<Hichki | null>(null);
  const [accepted, setAccepted] = useState<Accepted | null>(null);
  // Difference between the server's clock and this phone's, for countdowns.
  const skew = useRef(0);

  const key = who ? JSON.stringify(who) : '';
  const api = useMemo(() => (who ? roomApi(id, who) : null), [id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!who || !api) return;
    let alive = true;

    const load = () =>
      api.feed().then(
        (f) => {
          if (!alive) return;
          skew.current = f.now - Date.now();
          setFeed(f);
        },
        (e: Error) => alive && setError(e.message),
      );
    load();

    const auth = who.role === 'guest' ? { gatheringId: id, ...who } : { gatheringId: id, role: who.role, token: who.token };
    const socket = io({ auth });
    const patch = (fn: (f: Feed) => Feed) => setFeed((f) => (f ? fn(f) : f));

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('fatal', (e: { error: string }) => setError(e.error));
    socket.on('flags', (flags: Flags) => patch((f) => ({ ...f, flags })));
    socket.on('presence', (presence: Presence) =>
      patch((f) => {
        const mine = f.me && presence.members.find((m) => m.id === f.me!.id);
        return { ...f, presence, me: mine ? { ...f.me!, points: mine.points } : f.me };
      }),
    );
    socket.on('request', (r: Req) => patch((f) => ({ ...f, requests: upsert(f.requests, r) })));
    socket.on('proof', (p: Proof) => patch((f) => ({ ...f, proofs: upsert(f.proofs, p) })));
    socket.on('story', (s: Story) => patch((f) => ({ ...f, stories: upsert(f.stories, s) })));
    socket.on('accepted', setAccepted);
    socket.on('hichki', setHichki);
    socket.on('hichki:sent', setHichkiSent);

    // A phone that was closed missed events, so fetch everything again when it comes back.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, key]);

  return { feed, api, connected, error, hichki, hichkiSent, accepted, now: () => Date.now() + skew.current };
}

export type Room = ReturnType<typeof useRoom>;

// Replace the item with the same id, or add it at the front (newest first).
function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
}
