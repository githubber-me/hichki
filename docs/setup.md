# Running Hichki

## What you need

- Node.js 22.13 or newer
- Docker, [kind](https://kind.sigs.k8s.io), kubectl, and [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for the Kubernetes deploy
- Keys for Sarvam AI and Flagsmith. [.env.example](../.env.example) says where to get each one.

## 1. Configure

```bash
cp .env.example .env.local
```

Fill in `SARVAM_API_KEY` and `FLAGSMITH_SERVER_SIDE_ENVIRONMENT_KEY`. In Flagsmith, create three flags, all switched on: `hichki`, `jab_kholna` and `ai_requests`.

Optional: to let hosts ask for verified guests, add `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Create an application in Clerk with Google (and phone number, if you like) turned on. A development instance needs no Google Cloud setup.

Without keys, the app still runs: requests are typed instead of spoken, every flag is on, and guests always join by typing a name.

## 2. Run on your laptop

```bash
npm install
npm run dev
```

Open http://localhost:5173. The API runs on port 8080 behind it.

## 3. Run on Kubernetes

```bash
bash deploy/deploy.sh
```

This creates a local kind cluster (one control plane, two workers) if there isn't one, builds the image, loads it into the cluster, stores the two keys as a Kubernetes secret, and deploys. The app is then at http://localhost:8088.

## 4. Open it to phones

Phones need HTTPS for the microphone and camera.

```bash
bash deploy/tunnel.sh
```

This prints a public `https://….trycloudflare.com` address. Open it on the host's phone and create a gathering: the QR code points at the same address.

## 5. Connect NudgeBee

NudgeBee watches the cluster and investigates when something breaks.

1. In NudgeBee, add a Kubernetes account (Admin > Integrations > Kubernetes Clusters > Add K8s Account, Non-production). On Finish Setup, copy the whole command from the Shell Script tab into `.env.local` as one line, `CURL_COMMAND=curl ... && bash installation.sh -a "..." ...`.
2. Install the agent:

```bash
bash deploy/nudgebee.sh
```

   This keeps the flags from NudgeBee's command (agent key, relay address, signing key) and adds two for kind: `-k kind-hichki` so it can only go into this cluster, and `-d true` to turn off the eBPF node agent, which kind can't run. It also installs Loki, which gives NudgeBee the app's logs for the `uploads` fault. NudgeBee's command passes `-g true` and `-t true`, so no Prometheus or ClickHouse is installed; NudgeBee sees an OOMKilled pod through Kubernetes pod status and events. The install summary then says Prometheus and ClickHouse "failed"; that only means they were left out.

3. Check the agent is connected: `kubectl get pods -n nudgebee-agent`. The cluster shows as connected in NudgeBee after a few minutes.

## 6. Break it on purpose

To give NudgeBee a real problem to investigate:

```bash
bash deploy/break.sh uploads
```

| Fault | What happens | Ask NudgeBee |
| --- | --- | --- |
| `uploads` | Every photo and voice note fails with HTTP 500: the uploads folder is read-only | Why are photo uploads failing for the hichki deployment in the hichki namespace? |
| `memory` | The server leaks memory until it passes its 512Mi limit and is OOMKilled, then restarts in a loop | Why does the hichki pod in the hichki namespace keep restarting? |

NudgeBee's investigation can take around 8 minutes. Put the app right with:

```bash
bash deploy/fix.sh
```

## Checks

| Address | Answers when |
| --- | --- |
| `/api/health` | the server process is up |
| `/api/ready` | the database answers; also shows whether Sarvam and Flagsmith are connected |
