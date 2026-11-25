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

There are no accounts or passwords.

## Stack

| Part | Choice | Why |
| --- | --- | --- |
| Server | Node.js 22, TypeScript, Fastify | Small, fast, one language end to end |
| Live updates | Socket.IO | Rooms map directly to gatherings |
| Storage | SQLite (better-sqlite3) and an uploads folder | One file, no database server to run |
| Web page | Vite, React | Mobile first, served by the same server |
| Hosting | One container on Kubernetes, one persistent volume | Runs where NudgeBee can watch it |

## Flows

**1. Ask and deliver** (Be my eyes, Meri taraf se, Jab kholna)

1. The away person records a request.
2. The server sends the audio to Sarvam speech to text, then asks a Sarvam chat model to turn the transcript into a short card (`see` or `do`).
3. The card is broadcast to every guest in the gathering.
4. Guests upload a photo or voice note as proof.
5. The away person accepts one. That guest gets points and the leaderboard updates.
6. A voice letter is the same kind of request with a locked recording attached. Accepting proof unlocks it and it plays for the room.

If `ai_requests` is switched off, or Sarvam fails, the away person types the request instead.

**2. Hichki**

A guest taps the button. The server forwards it to the away person's open page, which plays a sound, shows who tapped and vibrates where the browser supports it.

**3. Stories** (Dadi ki kahani)

1. A guest records an elder's story (up to 30 seconds per clip).
2. Sarvam transcribes it in the spoken language and translates it.
3. Everyone can play the original voice next to the transcript and translation.

## Data model

| Table | Fields |
| --- | --- |
| gatherings | id, name, occasion, away_name, away_token, created_at |
| members | id, gathering_id, name, points |
| requests | id, gathering_id, kind (`see`, `do`, `letter`), text, audio_path, language, open_when, status, accepted_proof_id |
| proofs | id, request_id, member_id, file_path, created_at |
| stories | id, gathering_id, teller, audio_path, language, transcript, translation |

Hichki taps are live events and are not stored.

## Sponsor tools

### Sarvam AI

Called only from the server, so the key never reaches a browser.

| Use | Endpoint | Model |
| --- | --- | --- |
| Request and story transcription | `POST /speech-to-text` | `saaras:v4` |
| Request to card | `POST /v1/chat/completions` with a JSON schema | `sarvam-105b` |
| Story translation | `POST /translate` | `sarvam-translate:v1` |

### Flagsmith

The server uses the Node SDK with local evaluation, refreshes flags every few seconds, and pushes any change to every connected phone. Flipping a flag in the Flagsmith dashboard changes the whole room within seconds.

| Flag | Type | Effect |
| --- | --- | --- |
| `hichki` | On/off | Shows or hides the Hichki button |
| `jab_kholna` | On/off | Allows locked voice letters |
| `ai_requests` | On/off | Off means typed requests only; enforced on the server |
| `request_mode` | Multivariate (stretch) | Experiment per gathering: whole room answers (`room`) or one named person (`nominee`). Conversion event: `request_fulfilled` |

### NudgeBee

The NudgeBee agent runs in the cluster and reads Kubernetes events, pod status, logs and metrics. The app helps it by writing structured JSON logs, setting resource requests and limits, and exposing health checks. To show it working, we break the app on purpose and ask NudgeBee to find the cause.

## Configuration

Every environment variable is listed, with where to get it, in [.env.example](.env.example).
