#!/usr/bin/env bash
# Give the cluster's Hichki a public HTTPS address, so phones can scan the QR code
# and use their microphone and camera (both need HTTPS).
# Uses a Cloudflare quick tunnel: no account needed, and the address changes each run.
#   bash deploy/tunnel.sh
set -euo pipefail
exec cloudflared tunnel --no-autoupdate --url http://localhost:8088
