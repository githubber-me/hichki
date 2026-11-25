// The REST API. Every route is listed in docs/api.md.
//
// Who is calling is sent in headers:
//   x-hichki-member: MEMBER_ID   a guest
//   x-hichki-token:  TOKEN       the host or the away person (their private link token)

import type { FastifyReply, FastifyRequest } from 'fastify';
import { app, log } from './app.ts';
import {
  addHichki,
  addPoints,
  createGathering,
  createProof,
  createRequest,
  createStory,
  getGathering,
  getMember,
  getProof,
  getRequest,
  getStory,
  joinGathering,
  keepsakeKey,
  listHichkis,
  listMembers,
  listProofs,
  listRequests,
  listStories,
  cancelRequest,
  ping,
  setRequestStatus,
  setRequestTranscript,
  setWrapped,
  updateStory,
  type Gathering,
  type Member,
  type RequestKind,
  type RequestRow,
  memberByDevice,
  memberWithName,
  removeMember,
  updateProfile,
  setVerified,
  onDuty,
  setDuty,
  markAwaySeen,
  setAwayTz,
  setThanks,
  listHichkisSince,
} from './db.ts';
import { isOwnFile, mediaOf, mediaUrl, saveUpload, UploadError } from './files.ts';
import { flagStatus, flags, packs, requestMode, trackFulfilled } from './flags.ts';
import { packFor } from './packs.ts';
import { broadcastPresence, disconnectMember, emitAll, emitAway, emitToMember, onlineMemberIds, presence, publishRequest } from './live.ts';
import { sarvamEnabled, SarvamError, toCard, transcribe, translate } from './sarvam.ts';
import { signedInGuest, signInEnabled, SignInError } from './auth.ts';
import { config } from './config.ts';
import { gatheringView, proofView, requestView, storyView } from './views.ts';

const POINTS_FOR_ACCEPTED_PROOF = 10;
const HICHKI_COOLDOWN_MS = 3_000;
const MAX_SCHEDULE_AHEAD_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Caller =
  | { role: 'guest'; gathering: Gathering; member: Member }
  | { role: 'host'; gathering: Gathering }
  | { role: 'away'; gathering: Gathering };

function findGathering(id: string): Gathering {
  const g = getGathering(String(id ?? '').toUpperCase());
  if (!g) throw new HttpError(404, 'No gathering with that code.');
  return g;
}

function caller(req: FastifyRequest, g: Gathering): Caller | null {
  const token = req.headers['x-hichki-token'];
  if (token && token === g.away_token) return { role: 'away', gathering: g };
  if (token && token === g.host_token) return { role: 'host', gathering: g };
  const memberId = req.headers['x-hichki-member'];
  if (typeof memberId === 'string') {
    const member = getMember(memberId);
    if (member && member.gathering_id === g.id && !member.removed_at) return { role: 'guest', gathering: g, member };
  }
  return null;
}

function requireCaller(req: FastifyRequest, g: Gathering, ...roles: Caller['role'][]): Caller {
  const c = caller(req, g);
  if (!c) throw new HttpError(401, 'Join the gathering first.');
  if (!roles.includes(c.role)) throw new HttpError(403, 'You can’t do that from this screen.');
  return c;
}

// The request and its gathering, from a request id in the URL.
function findRequest(id: string): { request: RequestRow; gathering: Gathering } {
  const request = getRequest(String(id ?? ''));
  if (!request) throw new HttpError(404, 'That request doesn’t exist.');
  return { request, gathering: findGathering(request.gathering_id) };
}

// Times arrive as epoch milliseconds or ISO strings. Empty means "not set".
function parseTime(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) throw new HttpError(400, `${field} isn’t a valid time.`);
  if (ms > Date.now() + MAX_SCHEDULE_AHEAD_MS) throw new HttpError(400, `${field} is too far ahead.`);
  return ms;
}

function memberName(id: string): string {
  return getMember(id)?.name ?? 'Someone';
}

function sarvamProblem(err: unknown): HttpError {
  if (err instanceof SarvamError) {
    return new HttpError(502, `Couldn’t understand the recording right now (${err.message}). Type it instead.`);
  }
  return new HttpError(500, 'Something went wrong. Try again.');
}

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  if (err instanceof HttpError || err instanceof UploadError) {
    return reply.code(err.status).send({ error: err.message });
  }
  if (err.statusCode && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ error: err.message });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.code(500).send({ error: 'Something went wrong. Try again.' });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

// Liveness: the process is up.
app.get('/api/health', async () => ({ ok: true }));

// Readiness: the database answers. Kubernetes stops sending traffic if this fails.
app.get('/api/ready', async (_req, reply: FastifyReply) => {
  try {
    ping();
    return { ok: true, sarvam: sarvamEnabled, flags: flagStatus() };
  } catch (err) {
    log.error({ event: 'not_ready', err: (err as Error).message }, 'database not answering');
    return reply.code(503).send({ ok: false });
  }
});

app.get('/api/config', async () => ({
  publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? '',
  flags: flags(),
  sarvam: sarvamEnabled,
  // Public by design: the browser needs it to show the sign-in screen.
  signIn: signInEnabled ? { publishableKey: config.clerk.publishableKey } : null,
}));

// ---------------------------------------------------------------------------
// Gatherings and members
// ---------------------------------------------------------------------------

app.post('/api/gatherings', async (req) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = clean(body.name, 80);
  const occasion = clean(body.occasion, 40) || 'gathering';
  const awayName = clean(body.awayName, 40);
  if (!name || !awayName) throw new HttpError(400, 'Give the gathering a name and say who couldn’t come.');

  const verified = body.verified === true;
  if (verified && !signInEnabled) throw new HttpError(400, 'Verified guests need sign-in, which isn\u2019t set up on this server.');

  const g = createGathering(name, occasion, awayName, verified);
  req.log.info({ event: 'gathering_created', gatheringId: g.id, occasion }, 'gathering created');
  return { gathering: gatheringView(g), hostToken: g.host_token, awayToken: g.away_token };
});

app.get('/api/gatherings/:id', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  return { gathering: gatheringView(g) };
});

app.post('/api/gatherings/:id/join', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const deviceId = clean(body.deviceId, 64);
  if (!deviceId) throw new HttpError(400, 'Enter your name to join.');
  if (!allowJoin(req.ip)) throw new HttpError(429, 'Too many people joined from here just now. Try again in a minute.');

  // Verified gathering: the name and photo come from the guest's sign-in, not a text box.
  let name = clean(body.name, 40);
  let auth: { userId: string; avatarUrl: string | null } | null = null;
  if (g.verified) {
    try {
      const guest = await signedInGuest(req.headers.authorization);
      name = guest.name;
      auth = { userId: guest.userId, avatarUrl: guest.avatarUrl };
    } catch (err) {
      if (err instanceof SignInError) throw new HttpError(401, err.message);
      throw err;
    }
  }
  if (!name) throw new HttpError(400, 'Enter your name to join.');

  const returning = auth ? null : memberByDevice(g.id, deviceId);
  if (returning?.removed_at) throw new HttpError(403, 'The host has removed you from this gathering.');

  // Names are unique in a gathering, so nobody can pass as someone who's already here.
  const clash = memberWithName(g.id, name, returning?.id ?? null);
  if (clash && clash.auth_user_id !== auth?.userId) {
    throw new HttpError(
      409,
      auth
        ? `Someone called ${clash.name} has already joined. Ask the host to check.`
        : `${clash.name} has already joined. Add a surname or an initial, like ${name} K.`,
    );
  }

  const member = joinGathering(g.id, deviceId, name, auth);
  if (member.removed_at) throw new HttpError(403, 'The host has removed you from this gathering.');

  req.log.info({ event: 'member_joined', gatheringId: g.id, memberId: member.id, verified: !!auth }, 'member joined');
  broadcastPresence(g.id);
  return {
    member: { id: member.id, name: member.name, points: member.points, avatarUrl: member.avatar_url, verified: !!member.auth_user_id },
  };
});

// A few joins per minute from one address is plenty for a family; more is spam.
const joinsByIp = new Map<string, number[]>();
function allowJoin(ip: string): boolean {
  const now = Date.now();
  const recent = (joinsByIp.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  joinsByIp.set(ip, recent);
  return true;
}

// The host removes someone. Their phone is disconnected, their link stops working,
// and they leave the member list and leaderboard. What they already sent stays.
app.delete('/api/gatherings/:id/members/:mid', async (req) => {
  const { id, mid } = req.params as { id: string; mid: string };
  const g = findGathering(id);
  requireCaller(req, g, 'host');
  const member = getMember(mid);
  if (!member || member.gathering_id !== g.id || member.removed_at) throw new HttpError(404, 'That person isn\u2019t in this gathering.');

  removeMember(member.id);
  req.log.info({ event: 'member_removed', gatheringId: g.id, memberId: member.id }, 'member removed');
  disconnectMember(g.id, member.id);
  broadcastPresence(g.id);
  return { ok: true };
});

// A guest changes their own name or photo. Signed-in guests can too: their account
// stays verified, they just choose how they appear. Names stay unique.
//   name:   new name (optional)
//   photo:  an uploaded photo's "file", or null to remove the photo (optional)
app.post('/api/gatherings/:id/me', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = requireCaller(req, g, 'guest');
  if (c.role !== 'guest') throw new HttpError(403, 'Join the gathering first.');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const name = body.name === undefined ? c.member.name : clean(body.name, 40);
  if (!name) throw new HttpError(400, 'Your name can\u2019t be empty.');
  const clash = memberWithName(g.id, name, c.member.id);
  if (clash) throw new HttpError(409, `${clash.name} has already joined. Add a surname or an initial.`);

  let avatarUrl = c.member.avatar_url;
  if (body.photo === null) avatarUrl = null;
  else if (body.photo !== undefined) {
    if (!isOwnFile(g.id, body.photo) || mediaOf(body.photo) !== 'photo') throw new HttpError(400, 'Choose a photo.');
    avatarUrl = mediaUrl(body.photo);
  }

  updateProfile(c.member.id, name, avatarUrl);
  req.log.info({ event: 'profile_updated', gatheringId: g.id, memberId: c.member.id }, 'profile updated');
  broadcastPresence(g.id);
  return { member: { id: c.member.id, name, points: c.member.points, avatarUrl, verified: !!c.member.auth_user_id } };
});

// The host turns verified guests on or off. People already in stay in.
app.post('/api/gatherings/:id/verified', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'host');
  const verified = ((req.body ?? {}) as Record<string, unknown>).verified === true;
  if (verified && !signInEnabled) throw new HttpError(400, 'Verified guests need sign-in, which isn\u2019t set up on this server.');

  setVerified(g.id, verified);
  const updated = findGathering(g.id);
  req.log.info({ event: 'verified_changed', gatheringId: g.id, verified }, 'verified changed');
  emitAll(g.id, 'gathering', gatheringView(updated));
  return { gathering: gatheringView(updated) };
});

// Everything a screen needs to draw itself, from this caller's point of view.
// Phones call this when they open, then keep up with live events.
app.get('/api/gatherings/:id/feed', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = requireCaller(req, g, 'guest', 'host', 'away');
  const viewer = c.role === 'away' ? 'away' : 'room';

  const names = new Map(presence(g.id).members.map((m) => [m.id, m.name]));
  return {
    gathering: gatheringView(g),
    role: c.role,
    me: c.role === 'guest' ? { id: c.member.id, name: c.member.name, points: c.member.points } : null,
    flags: flags(),
    // Ready-made requests for this occasion (away person only).
    packs: c.role === 'away' ? packFor(packs(), g.occasion) : [],
    // "While you were away" for the away person (null when there's nothing to show).
    catchUp: c.role === 'away' ? catchUp(g) : null,
    presence: presence(g.id),
    requests: listRequests(g.id)
      .map((r) => requestView(r, viewer))
      .filter((r) => r !== null),
    proofs: listProofs(g.id).map((p) => proofView(p, names.get(p.member_id) ?? 'Someone')),
    stories: listStories(g.id).map(storyView),
    now: Date.now(),
  };
});

// ---------------------------------------------------------------------------
// Uploads: photos and voice recordings. Upload first, then use the returned
// "file" in a request, proof, letter or story.
// ---------------------------------------------------------------------------

app.post('/api/gatherings/:id/uploads', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = requireCaller(req, g, 'guest', 'host', 'away');
  const part = await req.file();
  if (!part) throw new HttpError(400, 'Attach a file.');
  const stored = await saveUpload(g.id, part);
  req.log.info(
    { event: 'upload', gatheringId: g.id, role: c.role, media: stored.media, bytes: stored.bytes },
    'file uploaded',
  );
  return stored;
});

// ---------------------------------------------------------------------------
// Requests (Be my eyes, Meri taraf se) and letters (Jab kholna)
// ---------------------------------------------------------------------------

// Step 1 for a spoken request: turn a recording into a draft card.
// The away person checks it, edits if needed, then creates the request.
app.post('/api/gatherings/:id/requests/draft', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!flags().ai_requests) throw new HttpError(409, 'Voice requests are switched off right now. Type it instead.');
  if (!sarvamEnabled) throw new HttpError(503, 'Voice requests aren’t set up yet. Type it instead.');
  if (!isOwnFile(g.id, body.file) || mediaOf(body.file) !== 'audio') throw new HttpError(400, 'Record your request first.');

  const language = clean(body.language, 10) || undefined;
  try {
    const heard = await transcribe(body.file, { language, mode: 'codemix' });
    if (!heard.transcript) throw new HttpError(422, 'Couldn’t hear anything in that recording. Try again a little closer.');
    const card = await toCard(heard.transcript, heard.language);
    req.log.info({ event: 'request_drafted', gatheringId: g.id, kind: card.kind, language: heard.language }, 'draft');
    return { ...card, transcript: heard.transcript, language: heard.language, file: body.file };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw sarvamProblem(err);
  }
});

// Step 2: create a request or a letter. Typed requests skip the draft step.
app.post('/api/gatherings/:id/requests', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const kind = clean(body.kind, 10) as RequestKind;
  if (!['see', 'do', 'letter'].includes(kind)) throw new HttpError(400, 'Choose what kind of request this is.');
  if (kind === 'letter' && !flags().jab_kholna) throw new HttpError(409, 'Voice letters are switched off right now.');

  const text = clean(body.text, 140);
  const openWhen = clean(body.openWhen, 140) || null;
  const audioFile = body.audioFile === undefined || body.audioFile === null ? null : body.audioFile;
  if (audioFile !== null && (!isOwnFile(g.id, audioFile) || mediaOf(audioFile) === 'photo')) {
    throw new HttpError(400, 'That recording couldn’t be found. Record it again.');
  }

  if (kind === 'letter') {
    if (!audioFile && !text) throw new HttpError(400, 'Record your letter first.');
    if (!openWhen && body.unlockAt === undefined) throw new HttpError(400, 'Say when it should open.');
  } else if (!text) {
    throw new HttpError(400, 'Write what you’d like the room to do.');
  }

  const liveAt = parseTime(body.liveAt, 'Start time') ?? Date.now();
  const until = parseTime(body.until, 'End time');
  const unlockAt = kind === 'letter' ? parseTime(body.unlockAt, 'Open time') : null;
  if (until !== null && until <= liveAt) throw new HttpError(400, 'The end time must be after the start time.');
  if (unlockAt !== null && unlockAt < liveAt) throw new HttpError(400, 'A letter can’t open before it appears.');

  // The request_mode experiment: in "nominee" gatherings, one person is asked by name.
  let nomineeId: string | null = clean(body.nomineeId, 64) || null;
  if (nomineeId && getMember(nomineeId)?.gathering_id !== g.id) nomineeId = null;
  let mode: 'room' | 'nominee' = nomineeId ? 'nominee' : 'room';
  if (!nomineeId && kind !== 'letter') {
    mode = await requestMode(g.id);
    if (mode === 'nominee') nomineeId = pickNominee(g.id);
  }

  const r = createRequest({
    gathering_id: g.id,
    kind,
    text: text || (kind === 'letter' ? `A voice letter from ${g.away_name}` : ''),
    text_original: clean(body.textOriginal, 200) || null,
    language: clean(body.language, 10) || null,
    transcript: clean(body.transcript, 2000) || null,
    audio_file: audioFile,
    open_when: openWhen,
    nominee_id: nomineeId,
    live_at: liveAt,
    until,
    unlock_at: unlockAt,
  });

  req.log.info(
    { event: 'request_created', gatheringId: g.id, requestId: r.id, kind, status: r.status, mode, scheduled: r.status === 'scheduled' },
    'request created',
  );
  publishRequest(r);

  // Letters get a transcript in the background, so the room can read along when it opens.
  if (kind === 'letter' && audioFile && !r.transcript && sarvamEnabled) {
    transcribe(audioFile, { mode: 'codemix' })
      .then((t) => {
        setRequestTranscript(r.id, t.transcript, t.language);
        const updated = getRequest(r.id);
        if (updated) publishRequest(updated);
      })
      .catch((err) => log.warn({ event: 'letter_transcript_failed', requestId: r.id, err: err.message }, 'letter transcript failed'));
  }

  return { request: requestView(r, 'away'), mode };
});

// Spread the asks around: the online guest with the fewest points.
function pickNominee(gatheringId: string): string | null {
  const here = new Set(onlineMemberIds(gatheringId));
  const candidates = presence(gatheringId).members.filter((m) => here.has(m.id));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.points - b.points);
  return candidates[0].id;
}

// The away person thanks whoever sent the proof they picked: a line of text, or a
// voice or video note (upload it first). The sender's phone hears about it at once.
app.post('/api/proofs/:pid/thanks', async (req) => {
  const proof = getProof((req.params as { pid: string }).pid);
  if (!proof) throw new HttpError(404, 'That answer doesn\u2019t exist.');
  const { request, gathering } = findRequest(proof.request_id);
  requireCaller(req, gathering, 'away');
  if (request.accepted_proof_id !== proof.id) throw new HttpError(409, 'Pick this one first, then say thank you.');

  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = clean(body.text, 280) || null;
  const file = body.file === undefined || body.file === null ? null : body.file;
  if (file !== null && (!isOwnFile(gathering.id, file) || mediaOf(file) === 'photo')) {
    throw new HttpError(400, 'Record a voice or video note, or write a line.');
  }
  if (!text && !file) throw new HttpError(400, 'Write a line, or record a voice or video note.');

  setThanks(proof.id, text, file);
  const updated = getProof(proof.id)!;
  const view = proofView(updated, memberName(updated.member_id));
  req.log.info({ event: 'thanks_sent', gatheringId: gathering.id, media: file ? mediaOf(file) : 'text' }, 'thank-you sent');
  emitAll(gathering.id, 'proof', view);
  await emitToMember(gathering.id, updated.member_id, 'thanks', { from: gathering.away_name, proofId: proof.id, requestText: request.text });
  return { proof: view };
});

// The away person withdraws a request or letter.
app.delete('/api/requests/:rid', async (req) => {
  const { request, gathering } = findRequest((req.params as { rid: string }).rid);
  requireCaller(req, gathering, 'away');
  if (request.status === 'done' || request.status === 'unlocked') throw new HttpError(409, 'That one has already happened.');
  cancelRequest(request.id);
  const updated = getRequest(request.id)!;
  publishRequest(updated);
  return { request: requestView(updated, 'away') };
});

// A guest sends proof: a photo or voice note for a request, or proof that a letter's moment came.
app.post('/api/requests/:rid/proofs', async (req) => {
  const { request, gathering } = findRequest((req.params as { rid: string }).rid);
  const c = requireCaller(req, gathering, 'guest');
  if (c.role !== 'guest') throw new HttpError(403, 'Join the gathering first.');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const open = request.status === 'open' || request.status === 'locked';
  if (!open) throw new HttpError(409, 'This one isn’t taking answers any more.');
  if (!isOwnFile(gathering.id, body.file)) throw new HttpError(400, 'Attach a photo or a voice note.');

  const proof = createProof({
    request_id: request.id,
    member_id: c.member.id,
    file: body.file,
    media: mediaOf(body.file),
    caption: clean(body.caption, 200) || null,
  });

  req.log.info({ event: 'proof_sent', gatheringId: gathering.id, requestId: request.id, media: proof.media }, 'proof sent');
  emitAll(gathering.id, 'proof', proofView(proof, c.member.name));
  return { proof: proofView(proof, c.member.name) };
});

// The away person picks the best proof. The sender gets points; a letter unlocks.
app.post('/api/requests/:rid/accept', async (req) => {
  const { request, gathering } = findRequest((req.params as { rid: string }).rid);
  requireCaller(req, gathering, 'away');
  const body = (req.body ?? {}) as Record<string, unknown>;

  const proof = getProof(clean(body.proofId, 64));
  if (!proof || proof.request_id !== request.id) throw new HttpError(400, 'Pick one of the answers.');
  if (request.status !== 'open' && request.status !== 'locked') throw new HttpError(409, 'You’ve already picked one.');

  const now = Date.now();
  setRequestStatus(request.id, request.kind === 'letter' ? 'unlocked' : 'done', {
    accepted_proof_id: proof.id,
    fulfilled_at: now,
  });
  addPoints(proof.member_id, POINTS_FOR_ACCEPTED_PROOF);
  trackFulfilled(gathering.id, (now - request.live_at) / 1000);

  const updated = getRequest(request.id)!;
  req.log.info(
    { event: 'proof_accepted', gatheringId: gathering.id, requestId: request.id, kind: request.kind, seconds: Math.round((now - request.live_at) / 1000) },
    'proof accepted',
  );
  publishRequest(updated);
  emitAll(gathering.id, 'accepted', {
    requestId: request.id,
    proofId: proof.id,
    memberId: proof.member_id,
    memberName: memberName(proof.member_id),
    points: POINTS_FOR_ACCEPTED_PROOF,
  });
  broadcastPresence(gathering.id);
  return { request: requestView(updated, 'away') };
});

// ---------------------------------------------------------------------------
// Hichki: one tap tells the away person someone just thought of them.
// ---------------------------------------------------------------------------

const lastHichki = new Map<string, number>();

app.post('/api/gatherings/:id/hichki', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = requireCaller(req, g, 'guest', 'host');
  if (!flags().hichki) throw new HttpError(409, 'Hichki is switched off right now.');

  const who = c.role === 'guest' ? c.member.id : `host:${g.id}`;
  const last = lastHichki.get(who) ?? 0;
  if (Date.now() - last < HICHKI_COOLDOWN_MS) throw new HttpError(429, 'Sent. Give it a moment before the next one.');
  lastHichki.set(who, Date.now());

  const from = c.role === 'guest' ? c.member.name : 'The host';
  const payload = { from, at: Date.now() };
  addHichki(g.id, c.role === 'guest' ? c.member.id : null, from, payload.at);
  // Duty pe: while the away person is on duty, hichkis are kept for later, not buzzed.
  const held = onDuty(g);
  req.log.info({ event: 'hichki', gatheringId: g.id, held }, 'hichki sent');
  if (!held) emitAway(g.id, 'hichki', payload);
  emitAll(g.id, 'hichki:sent', { ...payload, held });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Duty pe: for someone working through the celebration (a shift, a posting).
// ---------------------------------------------------------------------------

// Since when to catch the away person up: their last visit, or the start of
// their last duty if that was earlier. Nothing while they're still on duty.
function catchUp(g: Gathering) {
  if (onDuty(g)) return null;
  const marks = [g.away_seen_at, g.duty_from].filter((t): t is number => !!t);
  if (marks.length === 0) return null;
  const since = Math.min(...marks);
  const hichkis = listHichkisSince(g.id, since).map((h) => ({ from: h.from_name, memberId: h.member_id, at: h.created_at }));
  const answered = listRequests(g.id).filter((r) => (r.status === 'done' || r.status === 'unlocked') && (r.fulfilled_at ?? 0) > since);
  const stories = listStories(g.id).filter((s) => s.created_at > since);
  if (hichkis.length === 0 && answered.length === 0 && stories.length === 0) return null;
  return {
    since,
    wasOnDuty: !!g.duty_from && g.duty_from >= since - 1000,
    dutyNote: g.duty_note,
    hichkis,
    answered: answered.map((r) => r.id),
    stories: stories.map((s) => s.id),
  };
}

// The away person goes on duty until a time (with an optional note), or comes off duty.
app.post('/api/gatherings/:id/duty', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  const body = (req.body ?? {}) as Record<string, unknown>;
  const until = body.until === null ? null : parseTime(body.until, 'End of duty');
  if (until !== null && until <= Date.now()) throw new HttpError(400, 'Pick a time later than now.');
  if (until !== null && until > Date.now() + 3 * 24 * 60 * 60 * 1000) throw new HttpError(400, 'Duty can be set for up to three days at a time.');

  setDuty(g.id, until, clean(body.note, 80) || null);
  const updated = findGathering(g.id);
  req.log.info({ event: until ? 'duty_on' : 'duty_off', gatheringId: g.id }, 'duty changed');
  emitAll(g.id, 'gathering', gatheringView(updated));
  return { gathering: gatheringView(updated) };
});

// The away person has seen the catch-up; next time, start from now.
app.post('/api/gatherings/:id/seen', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  markAwaySeen(g.id);
  return { ok: true };
});

// The away person's phone tells us its timezone, so the room can see their clock.
app.post('/api/gatherings/:id/away-tz', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  const tz = clean(((req.body ?? {}) as Record<string, unknown>).tz, 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    throw new HttpError(400, 'Unknown timezone.');
  }
  if (tz && tz !== g.away_tz) {
    setAwayTz(g.id, tz);
    emitAll(g.id, 'gathering', gatheringView(findGathering(g.id)));
  }
  return { ok: true };
});

// Hichki back: the away person remembers one particular guest.
app.post('/api/gatherings/:id/hichki-back', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'away');
  if (!flags().hichki) throw new HttpError(409, 'Hichki is switched off right now.');
  const member = getMember(clean(((req.body ?? {}) as Record<string, unknown>).memberId, 64));
  if (!member || member.gathering_id !== g.id || member.removed_at) throw new HttpError(404, 'That person isn\u2019t in this gathering.');

  const key = `back:${g.id}:${member.id}`;
  if (Date.now() - (lastHichki.get(key) ?? 0) < HICHKI_COOLDOWN_MS) throw new HttpError(429, 'Sent. Give it a moment before the next one.');
  lastHichki.set(key, Date.now());

  req.log.info({ event: 'hichki_back', gatheringId: g.id }, 'hichki back');
  await emitToMember(g.id, member.id, 'hichki:back', { from: g.away_name, at: Date.now() });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Yaadein: what the celebration leaves behind. One page with every answered
// request, opened letter, story and hichki, in the order they happened.
// ---------------------------------------------------------------------------

// The host says the celebration is over (or reopens it). Nothing is locked; the
// away person's link simply opens on their yaadein from now on.
app.post('/api/gatherings/:id/wrap', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  requireCaller(req, g, 'host');
  const body = (req.body ?? {}) as Record<string, unknown>;

  setWrapped(g.id, body.wrapped === false ? null : (g.wrapped_at ?? Date.now()));
  const updated = findGathering(g.id);
  req.log.info({ event: updated.wrapped_at ? 'gathering_wrapped' : 'gathering_reopened', gatheringId: g.id }, 'wrap changed');
  emitAll(g.id, 'gathering', gatheringView(updated));
  return { gathering: gatheringView(updated) };
});

// Anyone from the gathering can read the yaadein. So can anyone holding the
// read-only key (x-hichki-keepsake), which lets them look and nothing else.
app.get('/api/gatherings/:id/keepsake', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = caller(req, g);
  const key = keepsakeKey(g);
  if (!c && req.headers['x-hichki-keepsake'] !== key) {
    throw new HttpError(401, 'This link is incomplete. Ask whoever sent it to send it again.');
  }

  // Only the away person sees what the room hasn't seen yet, the same as in the feed.
  const viewer = c?.role === 'away' ? 'away' : 'room';
  const people = listMembers(g.id);
  const names = new Map(people.map((m) => [m.id, m.name]));
  return {
    gathering: gatheringView(g),
    viewer: c?.role ?? 'visitor',
    // The host and the away person can pass the page on; guests and visitors can't.
    key: c?.role === 'host' || c?.role === 'away' ? key : null,
    people: people.map((m) => ({ id: m.id, name: m.name, points: m.points })),
    requests: listRequests(g.id)
      .map((r) => requestView(r, viewer))
      .filter((r) => r !== null),
    proofs: listProofs(g.id).map((p) => proofView(p, names.get(p.member_id) ?? 'Someone')),
    stories: listStories(g.id).map(storyView),
    hichkis: listHichkis(g.id).map((h) => ({ from: h.from_name, memberId: h.member_id, at: h.created_at })),
    now: Date.now(),
  };
});

// ---------------------------------------------------------------------------
// Dadi ki kahani: stories, transcribed and translated in the background.
// ---------------------------------------------------------------------------

app.post('/api/gatherings/:id/stories', async (req) => {
  const g = findGathering((req.params as { id: string }).id);
  const c = requireCaller(req, g, 'guest', 'host', 'away');
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!isOwnFile(g.id, body.file) || mediaOf(body.file) !== 'audio') throw new HttpError(400, 'Record the story first.');
  const teller = clean(body.teller, 40);
  if (!teller) throw new HttpError(400, 'Say who is telling the story.');

  const story = createStory({
    gathering_id: g.id,
    member_id: c.role === 'guest' ? c.member.id : null,
    teller,
    audio_file: body.file,
    language: clean(body.language, 10) || null,
    target_language: clean(body.targetLanguage, 10) || 'en-IN',
  });

  req.log.info({ event: 'story_started', gatheringId: g.id, storyId: story.id }, 'story recorded');
  emitAll(g.id, 'story', storyView(story));
  void processStory(story.id);
  return { story: storyView(story) };
});

async function processStory(id: string) {
  const story = getStory(id);
  if (!story) return;
  const publish = () => {
    const s = getStory(id);
    if (s) emitAll(s.gathering_id, 'story', storyView(s));
  };

  if (!sarvamEnabled) {
    updateStory(id, { status: 'failed', error: 'Stories can’t be transcribed yet. The voice is saved.' });
    return publish();
  }

  try {
    const heard = await transcribe(story.audio_file, { language: story.language ?? undefined, mode: 'transcribe' });
    const language = heard.language ?? story.language;
    updateStory(id, { transcript: heard.transcript, language });
    publish();

    let translation: string | null = null;
    if (language && language !== story.target_language && heard.transcript) {
      try {
        translation = await translate(heard.transcript, language, story.target_language);
      } catch (err) {
        log.warn({ event: 'story_translate_failed', storyId: id, err: (err as Error).message }, 'translation failed');
      }
    } else {
      translation = heard.transcript;
    }
    updateStory(id, { translation, status: 'ready' });
    log.info({ event: 'story_ready', storyId: id, language }, 'story ready');
  } catch (err) {
    const message =
      err instanceof SarvamError && err.status === 400
        ? 'Couldn’t read that recording. Keep each story under 30 seconds.'
        : 'Couldn’t transcribe that story right now. The voice is saved.';
    log.warn({ event: 'story_failed', storyId: id, err: (err as Error).message }, 'story failed');
    updateStory(id, { status: 'failed', error: message });
  }
  publish();
}
