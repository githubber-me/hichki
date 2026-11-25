# Hichki API

Everything the web page uses: REST routes for actions, Socket.IO events for live updates.

## Who is calling

There are no accounts. Each caller identifies itself with one header:

| Caller | Header | Where the value comes from |
| --- | --- | --- |
| Guest | `x-hichki-member: MEMBER_ID` | `member.id` returned by join, kept in `localStorage` |
| Host | `x-hichki-token: HOST_TOKEN` | `hostToken` returned when the gathering was created |
| Away person | `x-hichki-token: AWAY_TOKEN` | the `t` parameter in their private link |

Errors always come back as `{ "error": "A sentence you can show the person." }` with a 4xx or 5xx status.

Times are epoch milliseconds. Requests accept either milliseconds or an ISO string.

## Links

| Page | Address |
| --- | --- |
| Create a gathering | `/` |
| Guest (the QR code) | `/g/CODE` |
| Host | `/g/CODE/host?t=HOST_TOKEN` |
| Away person | `/g/CODE/away?t=AWAY_TOKEN` |

## Start of a session

1. `GET /api/gatherings/:id/feed` with the caller's header returns everything to draw the screen.
2. Connect Socket.IO (see below) and apply live events on top.

```jsonc
// GET /api/gatherings/:id/feed
{
  "gathering": { "id": "B3WV77", "name": "Priya and Aman's wedding", "occasion": "wedding", "awayName": "Meera" },
  "role": "guest",                      // guest | host | away
  "me": { "id": "...", "name": "Arjun", "points": 10 },   // guests only, else null
  "flags": { "hichki": true, "jab_kholna": true, "ai_requests": true },
  "presence": { "members": [{ "id": "...", "name": "Arjun", "points": 10, "online": true }], "awayOnline": true },
  "requests": [Request],                // see below; guests never get scheduled ones
  "proofs": [Proof],
  "stories": [Story],
  "now": 1795585534424                  // server time, to correct a phone's clock for countdowns
}
```

## Gatherings

| Route | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/gatherings` | anyone | `{ name, occasion, awayName }` | `{ gathering, hostToken, awayToken }` |
| `GET /api/gatherings/:id` | anyone | | `{ gathering }` |
| `POST /api/gatherings/:id/join` | anyone | `{ deviceId, name }` | `{ member }`. Same phone joining again returns the same member. |
| `GET /api/config` | anyone | | `{ publicBaseUrl, flags, sarvam }` |

## Uploads

Upload a file first, then pass the returned `file` to the route that uses it.

`POST /api/gatherings/:id/uploads` (guest, host or away), `multipart/form-data` with one field `file`.

- Photos: jpeg, png, webp, heic. Audio: webm, ogg, mp4/m4a, aac, mp3, wav. Video: mp4, webm, mov.
- Limit: `MAX_UPLOAD_MB` (10 MB by default).
- Returns `{ file, url, media, mime, bytes }`. `media` is `photo`, `audio` or `video`. `url` can be used directly in `<img>` or `<audio>`.

Recordings sent to Sarvam (voice requests, stories) must be **30 seconds or less**. Stop the recorder at 30 seconds.

## Requests and letters

A request is one card in the room.

```jsonc
// Request
{
  "id": "...",
  "kind": "see",                 // see (Be my eyes) | do (Meri taraf se) | letter (Jab kholna)
  "status": "open",              // see/do: scheduled | open | done | closed
                                 // letter: scheduled | locked | unlocked
  "text": "Show me Dadi when she sees the bride",
  "textOriginal": "दादी को दुल्हन देखते हुए दिखाओ",   // as spoken, may be null
  "language": "hi-IN",
  "audioUrl": "/media/...",      // the away person's recording; null for guests until a letter unlocks
  "transcript": "...",           // null for guests until a letter unlocks
  "openWhen": "the cake is cut", // letters
  "nomineeId": null,             // set when one guest is asked by name
  "liveAt": 1795585534424,       // when it appears in the room
  "until": null,                 // when it stops taking answers
  "unlockAt": null,              // letters: opens at this time even without proof
  "acceptedProofId": null,
  "fulfilledAt": null,
  "createdAt": 1795585534424
}
```

| Route | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/gatherings/:id/requests/draft` | away | `{ file, language? }` (an uploaded recording) | `{ kind, text, textOriginal, transcript, language, file }` |
| `POST /api/gatherings/:id/requests` | away | see below | `{ request, mode }` |
| `DELETE /api/requests/:rid` | away | | `{ request }` (now `closed`) |
| `POST /api/requests/:rid/proofs` | guest | `{ file, caption? }` | `{ proof }` |
| `POST /api/requests/:rid/accept` | away | `{ proofId }` | `{ request }` |

**Speaking a request** is two steps: upload the recording, call `draft` to get a card from Sarvam, let the away person check or edit it, then create it. If `draft` fails (409 when the `ai_requests` flag is off, 502 or 503 when Sarvam can't help), show a text box instead. Typed requests skip `draft`.

**Creating** (`POST /requests`):

```jsonc
{
  "kind": "see",                  // see | do | letter
  "text": "Show me the haldi",    // required for see/do; optional for letters
  "textOriginal": "...", "language": "hi-IN", "transcript": "...",   // from the draft, optional
  "audioFile": "B3WV77/....webm", // letters: the recorded letter (from an upload)
  "openWhen": "the cake is cut",  // letters: the moment that opens it
  "liveAt": "2026-11-27T13:00:00+05:30",  // optional: schedule it; default now
  "until": null,                  // optional: stop taking answers after this
  "unlockAt": null,               // letters: open at a time instead of (or as well as) a moment
  "nomineeId": null               // optional: ask one guest by name
}
```

A letter needs `audioFile` or `text`, and `openWhen` or `unlockAt`. Letters return 409 while the `jab_kholna` flag is off.

**Accepting** gives the sender 10 points. Accepting proof on a letter unlocks it, and its `audioUrl` and `transcript` are then sent to the room.

## Hichki

`POST /api/gatherings/:id/hichki` (guest or host), no body. Returns `{ ok: true }`.

- 409 while the `hichki` flag is off.
- 429 if the same person taps again within 3 seconds. The message can be shown as is.

## Stories (Dadi ki kahani)

```jsonc
// Story
{
  "id": "...",
  "teller": "Dadi",
  "status": "processing",        // processing | ready | failed
  "error": null,                 // a sentence to show when failed; the voice is still saved
  "audioUrl": "/media/...",
  "language": "pa-IN",           // spoken language, detected if not given
  "targetLanguage": "en-IN",
  "transcript": "...",           // in the spoken language
  "translation": "...",          // in targetLanguage
  "createdAt": 1795585534424
}
```

`POST /api/gatherings/:id/stories` (guest, host or away): `{ file, teller, language?, targetLanguage? }`. Returns the story as `processing`; updates arrive as `story` events. Language codes: `hi-IN`, `pa-IN`, `bn-IN`, `kn-IN`, `ta-IN`, `te-IN`, `ml-IN`, `mr-IN`, `gu-IN`, `od-IN`, `en-IN` and others Sarvam supports.

## Live events (Socket.IO)

Connect to the same origin:

```js
io({ auth: { gatheringId, role: 'guest', memberId } })   // guest
io({ auth: { gatheringId, role: 'host', token } })       // host
io({ auth: { gatheringId, role: 'away', token } })       // away person
```

| Event | Who gets it | Payload | Meaning |
| --- | --- | --- | --- |
| `flags` | everyone | `{ hichki, jab_kholna, ai_requests }` | On connect, and whenever a flag is flipped in Flagsmith. Show or hide features straight away. |
| `presence` | everyone | `{ members, awayOnline }` | Who is here, and points for the leaderboard (members are sorted by points). |
| `request` | everyone, each with their own view | Request | New or changed request. Replace by `id`. Guests first see a scheduled request when it goes live. |
| `proof` | everyone | Proof | Someone sent proof. |
| `accepted` | everyone | `{ requestId, proofId, memberId, memberName, points }` | The away person picked a winner. Good moment to celebrate on screen. |
| `hichki` | away person | `{ from, at }` | Someone remembered you. Play the moment. |
| `hichki:sent` | everyone | `{ from, at }` | For a small "Arjun sent a hichki" note in the room. |
| `story` | everyone | Story | A story was added or finished processing. |
| `fatal` | the caller | `{ error }` | The connection was refused (bad code or link). Show the message. |

```jsonc
// Proof
{ "id": "...", "requestId": "...", "memberId": "...", "memberName": "Arjun",
  "media": "photo", "url": "/media/...", "caption": "Dadi!", "createdAt": 1795585534424 }
```

Phones that were closed miss events. When a page becomes visible again, fetch the feed again.

## Health

| Route | Meaning |
| --- | --- |
| `GET /api/health` | The process is up (liveness). |
| `GET /api/ready` | The database answers (readiness), plus whether Sarvam and Flagsmith are configured. |
