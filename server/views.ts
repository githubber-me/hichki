// How rows from the database are shown to each kind of viewer.
// "room" is guests and the host; "away" is the person who couldn't come.

import type { Gathering, ProofRow, RequestRow, StoryRow } from './db.ts';
import { mediaOf, mediaUrl } from './files.ts';

export type Viewer = 'room' | 'away';

export function gatheringView(g: Gathering) {
  return { id: g.id, name: g.name, occasion: g.occasion, awayName: g.away_name, wrappedAt: g.wrapped_at ?? null };
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
    liveAt: r.live_at,
    until: r.until,
    unlockAt: r.unlock_at,
    acceptedProofId: r.accepted_proof_id,
    fulfilledAt: r.fulfilled_at,
    createdAt: r.created_at,
  };
}

export function proofView(p: ProofRow, memberName: string) {
  return {
    id: p.id,
    requestId: p.request_id,
    memberId: p.member_id,
    memberName,
    media: p.media,
    url: mediaUrl(p.file),
    caption: p.caption,
    createdAt: p.created_at,
  };
}

export function storyView(s: StoryRow) {
  return {
    id: s.id,
    teller: s.teller,
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
