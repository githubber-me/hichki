#!/usr/bin/env bash
# Install the NudgeBee agent into the local kind cluster, so NudgeBee can watch Hichki.
#
# Copy the "Shell Script" command from NudgeBee's Finish Setup screen
# (app.nudgebee.com > Admin > Integrations > Kubernetes Clusters > Add K8s Account)
# into .env.local as one line:
#   CURL_COMMAND=curl -fsSL .../installation.sh -o installation.sh && bash installation.sh -a "..." ...
# This script keeps that command's flags (key, relay, signing key), adds the kind
# cluster's context and turns off the eBPF node agent, which kind can't run.
#   bash deploy/nudgebee.sh
set -euo pipefail

CLUSTER="${CLUSTER_NAME:-hichki}"
ENV_FILE="${ENV_FILE:-.env.local}"
[ -f "$ENV_FILE" ] || ENV_FILE=.env

CMD="${CURL_COMMAND:-$(grep -E '^CURL_COMMAND=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$CMD" ]; then
  echo "Set CURL_COMMAND in $ENV_FILE to the install command NudgeBee shows." >&2
  exit 1
fi

# Take the flags after "bash installation.sh" without running anything else in the line.
ARGS=()
while IFS= read -r -d '' arg; do ARGS+=("$arg"); done < <(
  CMD="$CMD" python3 -I -c '
import os, shlex, sys
words = shlex.split(os.environ["CMD"])
i = max(i for i, w in enumerate(words) if w.endswith("installation.sh"))
sys.stdout.write("".join(w + "\0" for w in words[i + 1:]))
')
if [ "${#ARGS[@]}" -eq 0 ]; then
  echo "Could not find the installation.sh flags in CURL_COMMAND." >&2
  exit 1
fi

kubectl config use-context "kind-$CLUSTER" >/dev/null

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL -o "$WORK/installation.sh" https://raw.githubusercontent.com/nudgebee/k8s-agent/main/installation.sh

# The installer may ask to install Prometheus and Loki (logs for the uploads fault).
# Answer yes. Each question only comes up when that tool isn't in the cluster yet.
echo "Installing the NudgeBee agent into kind-$CLUSTER"
printf 'yes\nyes\n' | bash "$WORK/installation.sh" "${ARGS[@]}" -k "kind-$CLUSTER" -d true

kubectl get pods -n nudgebee-agent
echo "The cluster shows as connected in NudgeBee after a few minutes."
