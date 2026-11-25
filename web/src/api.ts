// Small helpers for talking to the server and remembering this phone.

export type PublicGathering = { id: string; name: string; occasion: string; awayName: string };
export type Member = { id: string; name: string; points: number };
export type Presence = {
  members: (Member & { online: boolean })[];
  awayOnline: boolean;
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data as T;
}

export const api = {
  createGathering: (name: string, occasion: string, awayName: string) =>
    request<{ gathering: PublicGathering; hostToken: string; awayToken: string }>('/api/gatherings', {
      name,
      occasion,
      awayName,
    }),
  getGathering: (id: string) => request<{ gathering: PublicGathering }>(`/api/gatherings/${id}`),
  join: (id: string, name: string) =>
    request<{ member: Member }>(`/api/gatherings/${id}/join`, { deviceId: deviceId(), name }),
  config: () => request<{ publicBaseUrl: string }>('/api/config'),
};

// A random id for this phone, kept across visits so people never have to sign in.
export function deviceId(): string {
  let id = localStorage.getItem('hichki:device');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('hichki:device', id);
  }
  return id;
}

// Gatherings can run for days, so each phone remembers who it is in each one.
export const saved = {
  member: (gatheringId: string): Member | null => read(`hichki:member:${gatheringId}`),
  setMember: (gatheringId: string, m: Member) => write(`hichki:member:${gatheringId}`, m),
  hostToken: (gatheringId: string): string | null => read(`hichki:host:${gatheringId}`),
  setHostToken: (gatheringId: string, token: string) => write(`hichki:host:${gatheringId}`, token),
  awayToken: (gatheringId: string): string | null => read(`hichki:away:${gatheringId}`),
  setAwayToken: (gatheringId: string, token: string) => write(`hichki:away:${gatheringId}`, token),
};

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

// The address phones should use. PUBLIC_BASE_URL wins, so a laptop on localhost
// still prints a QR code that phones can open.
let baseUrl: Promise<string> | null = null;
export function publicBaseUrl(): Promise<string> {
  baseUrl ??= api
    .config()
    .then((c) => c.publicBaseUrl || location.origin)
    .catch(() => location.origin);
  return baseUrl;
}
