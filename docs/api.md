# Hichki API

Everything the web page uses: REST routes for actions, Socket.IO events for live updates.

## Who is calling

There are no accounts. Each caller identifies itself with one header:

| Caller | Header | Where the value comes from |
| --- | --- | --- |
| Guest | `x-hichki-member: MEMBER_ID` | `member.id` returned by join, kept in `localStorage` |
| Host | `x-hichki-token: HOST_TOKEN` | `hostToken` returned when the gathering was created |
| Away person | `x-hichki-token: AWAY_TOKEN` | the `t` parameter in their private link |
| Visitor | `x-hichki-keepsake: KEY` | the `k` parameter in a shared yaadein link. Read-only: it works on `GET /keepsake` and nothing else |

Errors always come back as `{ "error": "A sentence you can show the person." }` with a 4xx or 5xx status.

Times are epoch milliseconds. Requests accept either milliseconds or an ISO string.

## Links

| Page | Address |
| --- | --- |
| Create a gathering | `/` |
| Guest (the QR code) | `/g/CODE` |
| Host | `/g/CODE/host?t=HOST_TOKEN` |
| Away person | `/g/CODE/away?t=AWAY_TOKEN`. Once the host wraps up, this opens on the yaadein, with the room one tap away |
| Yaadein (what the celebration leaves behind) | `/g/CODE/yaadein?k=KEY` for anyone the link is sent to. People from the gathering can open `/g/CODE/yaadein` as themselves; the host and the away person can also arrive with `?t=TOKEN`, which the page swaps for `?k=KEY` in the address bar so a copied address never carries a private token |

## Start of a session

1. `GET /api/gatherings/:id/feed` with the caller's header returns everything to draw the screen.
2. Connect Socket.IO (see below) and apply live events on top.

```jsonc
// GET /api/gatherings/:id/feed
{
  "gathering": { "id": "B3WV77", "name": "Priya and Aman's wedding", "occasion": "wedding", "awayName": "Meera",
                 "wrappedAt": null },   // when the host wrapped up, else null
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
| `POST /api/gatherings` | anyone | `{ name, occasion, awayName, verified? }` | `{ gathering, hostToken, awayToken }`. `verified: true` needs sign-in set up on the server. |
| `GET /api/gatherings/:id` | anyone | | `{ gathering }` |
| `POST /api/gatherings/:id/join` | anyone | `{ deviceId, name }` | `{ member }`. Same phone joining again returns the same member. |
| `DELETE /api/gatherings/:id/members/:mid` | host | | `{ ok }`. Removes a guest: their open phones get `fatal` with `removed: true`, their link stops working, and they leave the lists. |
| `POST /api/gatherings/:id/me` | guest | `{ name?, photo? }` | `{ member }`. Change your own name (still unique) or photo: `photo` is an uploaded photo's `file`, or `null` to remove it. The web page calls this from the "This is you" step shown straight after joining. Works for signed-in guests too; a signed-in guest's chosen name and photo are kept when they sign in on another phone. |
| `POST /api/gatherings/:id/verified` | host | `{ verified }` | `{ gathering }`. Turns verified guests on or off; people already in stay in. |
| `GET /api/config` | anyone | | `{ publicBaseUrl, flags, sarvam, signIn }`. `signIn` is `{ publishableKey }` when Clerk is set up, else `null`. |

**Joining rules.**

- Names are unique in a gathering (any letter case). A second "Arjun" from another phone gets 409 with a sentence suggesting a surname or initial.
- A removed guest gets 403 if they try to join again from the same phone or account.
- At most 20 joins a minute from one address (429).
- **Verified gatherings** (`gathering.verified`): the guest signs in with Clerk (Google or phone) and sends `Authorization: Bearer <Clerk session token>` with `{ deviceId }`. The server checks the token and takes the name and photo from the account; a typed `name` is ignored. One account is one member, on any phone. Without a valid token: 401.
- Members carry `avatarUrl` and `verified` (signed in) in `presence`.

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

Every tap is stored (who and when), so the yaadein page can show each time someone remembered.

## Yaadein (what the celebration leaves behind)

One page with every answered request, opened letter, story and hichki, in the order they happened. It can be read at any time and fills in as the celebration goes.

| Route | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/gatherings/:id/wrap` | host | `{ wrapped: true }` (or `false` to reopen) | `{ gathering }` with `wrappedAt` set. Nothing is locked; from now on the away person's link opens on the yaadein. |
| `GET /api/gatherings/:id/keepsake` | guest, host, away, or a visitor with the key | | see below |

```jsonc
// GET /api/gatherings/:id/keepsake
{
  "gathering": { "id": "B3WV77", "name": "...", "occasion": "wedding", "awayName": "Meera", "wrappedAt": 1795585534424 },
  "viewer": "away",                 // guest | host | away | visitor. The page says "you" to the away person.
  "key": "d630c2...",               // for the read-only link; host and away only, else null
  "people": [{ "id": "...", "name": "Arjun", "points": 10 }],
  "requests": [Request],            // same views as the feed: only the away person sees scheduled ones and sealed letters
  "proofs": [Proof],
  "stories": [Story],
  "hichkis": [{ "from": "Arjun", "memberId": "...", "at": 1795585534424 }],
  "now": 1795585534424
}
```

The key is worked out from the gathering's two private tokens (HMAC), so it can't be guessed and can't be turned back into either of them.

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
| `gathering` | everyone | `{ id, name, occasion, awayName, wrappedAt }` | The host wrapped up or reopened the gathering. |
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

## Duty pe and the away person's clock

| Route | Who | Body | Returns |
| --- | --- | --- | --- |
| `POST /api/gatherings/:id/duty` | away | `{ until, note? }`, or `{ until: null }` to come off duty | `{ gathering }`. Up to three days ahead. While on duty, hichkis are stored but not sent to the away person. |
| `POST /api/gatherings/:id/seen` | away | | `{ ok }`. The away person has read the catch-up. |
| `POST /api/gatherings/:id/away-tz` | away | `{ tz }` (IANA, e.g. `America/Toronto`) | `{ ok }`. Sent by the away person's phone, so the room can show their clock. |
| `POST /api/gatherings/:id/hichki-back` | away | `{ memberId }` | `{ ok }`. That guest's phones get `hichki:back` `{ from, at }`. Same 3 second cooldown per guest. |

`gathering` now carries `awayTz` and `duty` (`{ from, until, note }` while on duty, else `null`). The away person's feed carries `catchUp`: `{ since, wasOnDuty, dutyNote, hichkis, answered, stories }`, everything since their last visit or the start of their last duty, or `null` when there's nothing new or they're still on duty. `hichki:sent` carries `held: true` when the away person is on duty.

## Health

| Route | Meaning |
| --- | --- |
| `GET /api/health` | The process is up (liveness). |
| `GET /api/ready` | The database answers (readiness), plus whether Sarvam and Flagsmith are configured. |
