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

Without keys, the app still runs: requests are typed instead of spoken, and every flag is on.

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

1. In NudgeBee, add a Kubernetes account and copy its agent key into `.env.local` as `NUDGEBEE_AGENT_KEY`.
2. Install the agent into the cluster with NudgeBee's install script. On kind, pass `-d true` to turn off the eBPF node agent, which kind can't run:

```bash
curl -fsSLO https://raw.githubusercontent.com/nudgebee/k8s-agent/main/installation.sh
bash installation.sh -a "$NUDGEBEE_AGENT_KEY" -d true
```

3. Check the agent is connected: `kubectl get pods -n nudgebee-agent`. The cluster shows as connected in NudgeBee after a few minutes.

## Checks

| Address | Answers when |
| --- | --- |
| `/api/health` | the server process is up |
| `/api/ready` | the database answers; also shows whether Sarvam and Flagsmith are connected |
