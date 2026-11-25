// How rows from the database are shown to each kind of viewer.
// "room" is guests and the host; "away" is the person who couldn't come.

import type { Gathering, ProofRow, RequestRow, StoryRow } from './db.ts';
import { mediaOf, mediaUrl } from './files.ts';

export type Viewer = 'room' | 'away';

export function gatheringView(g: Gathering) {
  return {
    id: g.id,
    name: g.name,
    occasion: g.occasion,
    awayName: g.away_name,
    wrappedAt: g.wrapped_at ?? null,
    verified: !!g.verified,
    // The away person's timezone, so the room can show their clock.
    awayTz: g.away_tz,
    roomLang: g.room_lang ?? 'hi',
    readLang: g.read_lang ?? '',
    awayReason: g.away_reason ?? null,
    // Duty pe: shown to the room as "on duty until 6 AM".
    duty: g.duty_until && g.duty_from && g.duty_until > Date.now() ? { from: g.duty_from, until: g.duty_until, note: g.duty_note } : null,
  };
}

// Returns null when this viewer shouldn't see the request at all.
export function requestView(r: RequestRow, viewer: Viewer) {
  if (viewer === 'room' && r.status === 'scheduled') return null;

  // A locked letter shows the room what moment it's waiting for, but not what it says.
  const hidden = viewer === 'room' && r.kind === 'letter' && r.status !== 'unlocked';

  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    text: r.text,
    textOriginal: r.text_original,
    language: r.language,
    audioUrl: !hidden && r.audio_file ? mediaUrl(r.audio_file) : null,
    transcript: hidden ? null : r.transcript,
    openWhen: r.open_when,
    nomineeId: r.nominee_id,
    // Who asked: 'main' (the gathering's away person) or another away person's id.
    askedBy: r.asked_by ?? 'main',
    askedByName: r.asked_by_name ?? null,
    liveAt: r.live_at,
    until: r.until,
    unlockAt: r.unlock_at,
    acceptedProofId: r.accepted_proof_id,
    fulfilledAt: r.fulfilled_at,
    createdAt: r.created_at,
  };
}

export function proofView(p: ProofRow, memberName: string, viewer: Viewer = 'room') {
  return {
    // Hearts are public; "set aside" is only ever shown to the away person.
    loved: !!p.loved_at,
    lovedAt: p.loved_at ?? null,
    setAside: viewer === 'away' ? !!p.set_aside : false,
    id: p.id,
    requestId: p.request_id,
    memberId: p.member_id,
    memberName,
    media: p.media,
    url: mediaUrl(p.file),
    caption: p.caption,
    createdAt: p.created_at,
    // The away person's thank-you, once they've sent one.
    thanks: p.thanks_at
      ? {
          text: p.thanks_text ?? null,
          url: p.thanks_file ? mediaUrl(p.thanks_file) : null,
          media: p.thanks_file ? mediaOf(p.thanks_file) : null,
          at: p.thanks_at,
        }
      : null,
  };
}

export function storyView(s: StoryRow) {
  return {
    id: s.id,
    teller: s.teller,
    requestId: s.request_id ?? null, // set when told in answer to a story request
    memberId: s.member_id,
    status: s.status,
    error: s.error,
    audioUrl: mediaUrl(s.audio_file),
    media: mediaOf(s.audio_file),
    language: s.language,
    targetLanguage: s.target_language,
    transcript: s.transcript,
    translation: s.translation,
    createdAt: s.created_at,
  };
}
