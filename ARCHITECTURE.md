# Architecture

How Hichki is put together. This is the plan for the build on 25 November 2026; sections are updated as each part lands.

## Overview

Hichki is one Node.js server and one mobile-first web page. Everyone at a gathering is connected to the server over a live socket, so a request, a photo or a hichki reaches every phone at once.

```
 Away phone                 Hichki server (one container)              Guest phones
 (the person      HTTPS     +------------------------------+   live    (people at the
  who couldn't  <-------->  | Web page + REST API           | <-------> gathering)
  come)          socket     | Live updates (Socket.IO)     |  socket
                            | SQLite + uploads on a volume |
                            +------------------------------+
                               |             |
                    Sarvam AI  |             |  Flagsmith
          speech to text,      v             v  flags, polled by the server
          translation, chat                     and pushed to every phone

                 Kubernetes cluster  <--- watched by the NudgeBee agent
```

## Roles

| Role | Gets in by | Identity |
| --- | --- | --- |
| Host | Creating a gathering | Creator of the gathering |
| Guest | Scanning the gathering's QR code and typing a name | A random device id kept in the browser |
| Away | Opening the private away link | A secret token in the link |

Anyone sent the yaadein link (see flow 4) can look at that one page and do nothing else.

There are no passwords. Names are unique within a gathering, and the host can remove anyone: their phone is disconnected and their link stops working.

**Verified gatherings (optional).** A host can turn on *Only verified guests*, when creating the gathering or later. Guests then sign in through [Clerk](https://clerk.com) with Google or a phone number, and the server checks Clerk's session token and takes the name and photo from the account, so a name can't be typed in to pass as someone else. One account is one member. Every guest, signed in or not, can change their name or add, change or remove their photo from the People tab; a signed-in guest stays verified, and their choice is kept on other phones. The sign-in code is loaded only for verified gatherings, so open gatherings stay as fast and as sign-up-free as before. Clerk is called from [server/auth.ts](server/auth.ts) only to check who signed in; everything after that uses the member id, like any other guest.

## Duty pe

For the person who can't follow along because they're working through it: a nurse on shift, a soldier at a posting, a delivery rider.

- The away person taps **Go on duty** and picks how long, with an optional note. The room sees "Meera is on duty: night shift at the hospital, until 6 am their time".
- While on duty, hichkis are stored but not sent, so nothing buzzes at work. When duty ends, the away person first sees **While you were on duty**: who thought of them and how often, which requests were answered (with the picked photos), and new stories.
- The same catch-up appears after any absence ("While you were away"), since the last time their page was open.
- The away person's phone reports its timezone, so the room sees "It's 4:12 am for Meera in Toronto" whenever their clocks differ.
- **Hichki back**: the away person can send a hichki to one particular guest from the People tab.

## Gatherings last for days

Weddings and festivals run over several days, so a gathering never expires on its own.

- The away link works for the whole celebration. The away person sets things up once and comes back whenever they like.
- Each phone remembers who it is in each gathering (`localStorage`), so a guest who returns on day three is straight back in.
- Requests and voice letters can be **scheduled**: each has an optional `live_at` (when it appears in the room) and `until` (when it stops taking answers). The server checks every few seconds and broadcasts anything that has just gone live. On Wednesday, Meera can set up "Friday 1 PM: play my message for the couple" and "Saturday sangeet: show me Papa dancing".
- A voice letter unlocks either at a time or at a moment the room proves happened.
- A phone that is closed can't be woken. When a guest opens the page, they see what went live since their last visit.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Server | Node.js 22, TypeScript, Fastify | Small, fast, one language end to end |
| Live updates | Socket.IO | Rooms map directly to gatherings |
| Storage | SQLite (built into Node, `node:sqlite`) and an uploads folder | One file, no database server and no native module to build |
| Web page | Vite, React | Mobile first, served by the same server |
| Hosting | One container on Kubernetes, one persistent volume | Runs where NudgeBee can watch it |

## Flows

**1. Ask and deliver** (Be my eyes, Meri taraf se, Jab kholna)

1. The away person records a request.
2. The server sends the audio to Sarvam speech to text, then asks a Sarvam chat model to turn the transcript into a short card (`see` or `do`).
3. The card is broadcast to every guest in the gathering.
4. Guests upload a photo or voice note as proof.
5. The away person accepts one. That guest gets points and the leaderboard updates.
6. The away person can thank them: a line of text, a voice note, or a short selfie video recorded in the page (front camera, up to 20 seconds, kept small for phone connections). The sender's phone hears about it at once.
7. A voice letter is the same kind of request with a locked recording attached. Accepting proof unlocks it and it plays for the room.

If `ai_requests` is switched off, or Sarvam fails, the away person types the request instead.

**2. Hichki**

A guest taps the button. The server forwards it to the away person's open page, which plays a sound, shows who tapped and vibrates where the browser supports it.

**3. Stories** (Dadi ki kahani)

1. A guest records an elder's story (up to 30 seconds per clip).
2. Sarvam transcribes it in the spoken language and translates it.
3. Everyone can play the original voice next to the transcript and translation.

**4. Yaadein** (what the celebration leaves behind)

1. All through the celebration, everything that happens is already being kept: answered requests with the photos and voice notes sent for them, opened letters, stories, and every hichki tap.
2. `/g/CODE/yaadein` draws it as one page, oldest first and grouped by day: the ring of dancers with the number of hichkis in the middle, then one dotted path with every moment on it, then who did what. A button replays it from start to end, scrolling to each moment and playing its voice.
3. When it is over, the host taps **Wrap up**. Nothing is locked. Every phone hears about it, and the away person's own link now opens on the yaadein instead of the room.
4. The host and the away person can pass the page on. The shared link carries a read-only key, worked out from the gathering's two private tokens, that opens this page and nothing else.

Requests nobody answered are left off the page on purpose. It is a record of what happened.

## Data model

| Table | Fields |
| --- | --- |
| gatherings | id, name, occasion, away_name, host_token, away_token, created_at, wrapped_at |
| members | id, gathering_id, device_id, name, points, created_at |
| requests | id, gathering_id, kind (`see`, `do`, `letter`), text, audio_path, language, live_at, until, open_when, status, accepted_proof_id |
| proofs | id, request_id, member_id, file_path, created_at |
| stories | id, gathering_id, teller, audio_path, language, transcript, translation |
| hichkis | id, gathering_id, member_id, from_name, created_at |

Every hichki tap is stored, so the yaadein page can show each time someone remembered.

## Sponsor tools

### Sarvam AI

Called only from the server, so the key never reaches a browser.

| Use | Endpoint | Model |
| --- | --- | --- |
| Request and story transcription | `POST /speech-to-text` | `saaras:v4` |
| Request to card | `POST /v1/chat/completions` with a JSON schema | `sarvam-105b` |
| Story translation | `POST /translate` | `sarvam-translate:v1` |

### Flagsmith

The server uses the Node SDK (`@flagsmith/nodejs`) with local evaluation, refreshes flags every `FLAGSMITH_REFRESH_SECONDS`, and pushes any change to every connected phone as a `flags` event. Flipping a flag in the Flagsmith dashboard changes the whole room within seconds. Flags are enforced on the server too, so a hidden button can't be called directly. If Flagsmith can't be reached, every flag falls back to on.

| Flag | Type | Effect |
| --- | --- | --- |
| `hichki` | On/off | Shows or hides the Hichki button |
| `jab_kholna` | On/off | Allows locked voice letters |
| `request_packs` | On/off with a JSON value | Ready-made requests per occasion (wedding, Diwali, trip and more) shown to the away person as ideas. Editing the value in Flagsmith updates every away screen live ([server/packs.ts](server/packs.ts) has the shape and the defaults) |
| `ai_requests` | On/off | Off means typed requests only; enforced on the server |
| `request_mode` | Multivariate (stretch) | Experiment per gathering (identity `gathering_CODE`): whole room answers (`room`) or one named person (`nominee`). Exposure is recorded when a request is created; conversion event `request_fulfilled` carries the seconds it took. Needs `FLAGSMITH_EXPERIMENTS=on` |

### NudgeBee

The NudgeBee agent runs in the cluster and reads Kubernetes events, pod status, logs and metrics. The app helps it by writing structured JSON logs, setting resource requests and limits, and exposing health checks. To show it working, we break the app on purpose and ask NudgeBee to find the cause.

Breaking it is one switch, the `BREAK` environment variable ([server/faults.ts](server/faults.ts)), set on the cluster by `deploy/break.sh` and removed by `deploy/fix.sh`. Both faults are real failures, not fake log lines:

| `BREAK` | What happens | What NudgeBee should find |
| --- | --- | --- |
| `uploads` | The uploads folder is made read-only | Uploads return HTTP 500; logs show `EACCES` on the volume |
| `memory` | The server keeps allocating memory it never frees | The pod passes its 512Mi limit, is OOMKilled and restarts in a loop |

## Deployment

One Docker image ([Dockerfile](Dockerfile)) holds the server and the built web page. [deploy/deploy.sh](deploy/deploy.sh) builds it, loads it into a local kind cluster ([deploy/kind.yaml](deploy/kind.yaml)) and applies [deploy/k8s/app.yaml](deploy/k8s/app.yaml): a namespace, a config map, a 2 GiB volume, one pod (replaced, never doubled, because it owns the SQLite file) and a NodePort on `localhost:8088`. Phones reach it over HTTPS through a Cloudflare quick tunnel ([deploy/tunnel.sh](deploy/tunnel.sh)).

## API

Every route and live event the web page uses is in [docs/api.md](docs/api.md).

## Configuration

Every environment variable is listed, with where to get it, in [.env.example](.env.example).
