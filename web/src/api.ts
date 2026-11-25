// Small helpers for talking to the server and remembering this phone.

export type PublicGathering = {
  id: string;
  name: string;
  occasion: string;
  awayName: string;
  wrappedAt: number | null;
  verified: boolean; // guests must sign in to join
  awayTz: string | null; // the away person's timezone, from their phone
  duty: { from: number; until: number; note: string | null } | null; // Duty pe
};
export type Member = { id: string; name: string; points: number; avatarUrl?: string | null; verified?: boolean };
export type Presence = {
  members: (Member & { online: boolean })[];
  awayOnline: boolean;
};

async function request<T>(path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? extraHeaders : { 'content-type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data as T;
}

export const api = {
  createGathering: (name: string, occasion: string, awayName: string, verified = false) =>
    request<{ gathering: PublicGathering; hostToken: string; awayToken: string }>('/api/gatherings', {
      name,
      occasion,
      awayName,
      verified,
    }),
  getGathering: (id: string) => request<{ gathering: PublicGathering }>(`/api/gatherings/${id}`),
  join: (id: string, name: string) =>
    request<{ member: Member }>(`/api/gatherings/${id}/join`, { deviceId: deviceId(), name }),
  // Verified gatherings: the name comes from the sign-in, proven by the session token.
  joinSignedIn: (id: string, sessionToken: string) =>
    request<{ member: Member }>(`/api/gatherings/${id}/join`, { deviceId: deviceId() }, { authorization: `Bearer ${sessionToken}` }),
  config: () =>
    request<{ publicBaseUrl: string; signIn: { publishableKey: string } | null }>('/api/config'),
};

// ---------------------------------------------------------------------------
// The room: everything a screen needs once someone is inside a gathering.
// Shapes match docs/api.md.
// ---------------------------------------------------------------------------

export type Role = 'guest' | 'host' | 'away';
export type Flags = { hichki: boolean; jab_kholna: boolean; ai_requests: boolean };
export type Kind = 'see' | 'do' | 'letter' | 'story';

export type Req = {
  id: string;
  kind: Kind;
  status: 'scheduled' | 'open' | 'done' | 'closed' | 'locked' | 'unlocked';
  text: string | null;
  textOriginal: string | null;
  language: string | null;
  audioUrl: string | null;
  transcript: string | null;
  openWhen: string | null;
  nomineeId: string | null;
  liveAt: number;
  until: number | null;
  unlockAt: number | null;
  acceptedProofId: string | null;
  fulfilledAt: number | null;
  createdAt: number;
};

export type Proof = {
  id: string;
  requestId: string;
  memberId: string;
  memberName: string;
  media: 'photo' | 'audio' | 'video';
  url: string;
  caption: string | null;
  createdAt: number;
  // The away person's thank-you for this proof, once sent.
  thanks: { text: string | null; url: string | null; media: 'audio' | 'video' | 'photo' | null; at: number } | null;
};

export type Story = {
  id: string;
  teller: string;
  requestId: string | null; // set when told in answer to a story request
  memberId: string | null;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  audioUrl: string;
  language: string | null;
  targetLanguage: string | null;
  transcript: string | null;
  translation: string | null;
  createdAt: number;
};

export type CatchUp = {
  since: number;
  wasOnDuty: boolean;
  dutyNote: string | null;
  hichkis: { from: string; memberId: string | null; note?: string | null; at: number }[];
  answered: string[]; // request ids
  stories: string[]; // story ids
};

// One hichki in the timeline: who remembered, when, and the line they added, if any.
export type HichkiEntry = { from: string; memberId: string | null; note: string | null; at: number };

// A ready-made request idea for the occasion (from Flagsmith's `request_packs`).
export type PackItem = { kind: 'see' | 'do' | 'story'; text: string };

export type Feed = {
  gathering: PublicGathering;
  role: Role;
  me: Member | null;
  flags: Flags;
  packs: PackItem[];
  hichkis: HichkiEntry[]; // newest first
  // "While you were away" (away person only; null when there's nothing new).
  catchUp: CatchUp | null;
  presence: Presence;
  requests: Req[];
  proofs: Proof[];
  stories: Story[];
  now: number;
};

export type Draft = {
  kind: Kind;
  text: string;
  textOriginal: string | null;
  transcript: string | null;
  language: string | null;
  file: string;
};

export type NewRequest = {
  kind: Kind;
  text?: string;
  textOriginal?: string | null;
  language?: string | null;
  transcript?: string | null;
  audioFile?: string;
  openWhen?: string;
  liveAt?: number | null;
  until?: number | null;
  unlockAt?: number | null;
  nomineeId?: string | null;
};

export type Stored = { file: string; url: string; media: 'photo' | 'audio' | 'video'; mime: string; bytes: number };

// Who is calling. Guests are known by their member id, the host and the away
// person by the token in their link.
export type Who = { role: 'guest'; memberId: string } | { role: 'host' | 'away'; token: string };

export function roomApi(id: string, who: Who) {
  const auth: Record<string, string> =
    who.role === 'guest' ? { 'x-hichki-member': who.memberId } : { 'x-hichki-token': who.token };

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? auth : { ...auth, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Try again.', res.status);
    return data as T;
  }

  const g = `/api/gatherings/${id}`;
  return {
    feed: () => call<Feed>('GET', `${g}/feed`),
    // Upload first, then hand the returned `file` to whatever uses it.
    upload: async (blob: Blob, filename: string): Promise<Stored> => {
      const form = new FormData();
      form.append('file', blob, filename);
      const res = await fetch(`${g}/uploads`, { method: 'POST', headers: auth, body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(data.error ?? 'That didn’t upload. Try again.', res.status);
      return data as Stored;
    },
    draft: (file: string) => call<Draft>('POST', `${g}/requests/draft`, { file }),
    createRequest: (body: NewRequest) => call<{ request: Req }>('POST', `${g}/requests`, body),
    closeRequest: (rid: string) => call<{ request: Req }>('DELETE', `/api/requests/${rid}`),
    sendProof: (rid: string, file: string, caption?: string, extra: { teller?: string } = {}) =>
      call<{ proof: Proof }>('POST', `/api/requests/${rid}/proofs`, { file, caption, ...extra }),
    accept: (rid: string, proofId: string) => call<{ request: Req }>('POST', `/api/requests/${rid}/accept`, { proofId }),
    hichki: (note?: string) => call<{ ok: true }>('POST', `${g}/hichki`, note ? { note } : {}),
    // The host says the celebration is over, or reopens it.
    wrap: (wrapped: boolean) => call<{ gathering: PublicGathering }>('POST', `${g}/wrap`, { wrapped }),
    // Guest only: change your name, or your photo (an uploaded file, or null to remove it).
    updateMe: (changes: { name?: string; photo?: string | null }) => call<{ member: Member }>('POST', `${g}/me`, changes),
    // Away only.
    thank: (proofId: string, changes: { text?: string; file?: string }) => call<{ proof: Proof }>('POST', `/api/proofs/${proofId}/thanks`, changes),
    setDuty: (until: number | null, note?: string) => call<{ gathering: PublicGathering }>('POST', `${g}/duty`, { until, note }),
    seen: () => call<{ ok: true }>('POST', `${g}/seen`, {}),
    setAwayTz: (tz: string) => call<{ ok: true }>('POST', `${g}/away-tz`, { tz }),
    hichkiBack: (memberId: string) => call<{ ok: true }>('POST', `${g}/hichki-back`, { memberId }),
    // Host only.
    removeMember: (memberId: string) => call<{ ok: true }>('DELETE', `${g}/members/${memberId}`),
    setVerified: (verified: boolean) => call<{ gathering: PublicGathering }>('POST', `${g}/verified`, { verified }),
    addStory: (file: string, teller: string, language?: string, targetLanguage?: string) =>
      call<Story>('POST', `${g}/stories`, { file, teller, language, targetLanguage }),
  };
}

export type RoomApi = ReturnType<typeof roomApi>;

// ---------------------------------------------------------------------------
// Yaadein: the page a celebration leaves behind.
// ---------------------------------------------------------------------------

export type Tap = { from: string; memberId: string | null; at: number };

export type Keepsake = {
  gathering: PublicGathering;
  viewer: Role | 'visitor';
  key: string | null; // for the read-only link; only the host and the away person get it
  people: Member[];
  requests: Req[];
  proofs: Proof[];
  stories: Story[];
  hichkis: Tap[];
  now: number;
};

// Someone from the gathering, or anyone holding the read-only key from a shared link.
export type KeepsakeWho = Who | { role: 'visitor'; key: string };

export async function getKeepsake(id: string, who: KeepsakeWho): Promise<Keepsake> {
  const headers: Record<string, string> =
    who.role === 'guest'
      ? { 'x-hichki-member': who.memberId }
      : who.role === 'visitor'
        ? { 'x-hichki-keepsake': who.key }
        : { 'x-hichki-token': who.token };
  const res = await fetch(`/api/gatherings/${id}/keepsake`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Try again.', res.status);
  return data as Keepsake;
}

// Carries the HTTP status, so screens can tell "switched off" (409) from "try again".
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

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
