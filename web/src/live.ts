// Live connection to the gathering. Every phone in a gathering shares one room.

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Presence } from './api.ts';

type Auth =
  | { gatheringId: string; role: 'guest'; memberId: string }
  | { gatheringId: string; role: 'host' | 'away'; token: string };

export function useLive(auth: Auth | null) {
  const [presence, setPresence] = useState<Presence | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = auth ? JSON.stringify(auth) : '';

  useEffect(() => {
    if (!auth) return;
    const socket = io({ auth });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('presence', setPresence);
    socket.on('fatal', (e: { error: string }) => setError(e.error));
    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { presence, connected, error };
}
