#!/usr/bin/env bash
# Break Hichki on the cluster on purpose, so NudgeBee has something real to investigate.
#   bash deploy/break.sh uploads   every photo and voice note fails with HTTP 500 (EACCES)
#   bash deploy/break.sh memory    the pod leaks memory and is OOMKilled, then restarts in a loop
# Put it right with: bash deploy/fix.sh
set -euo pipefail

NAMESPACE="${APP_NAMESPACE:-hichki}"
# Always the Hichki cluster, whatever kubectl is pointed at.
kubectl() { command kubectl --context "kind-${CLUSTER_NAME:-hichki}" "$@"; }
FAULT="${1:-}"
case "$FAULT" in
  uploads|memory) ;;
  *) echo "Usage: bash deploy/break.sh uploads|memory" >&2; exit 1 ;;
esac

kubectl -n "$NAMESPACE" set env deployment/hichki BREAK="$FAULT"
kubectl -n "$NAMESPACE" rollout status deployment/hichki --timeout=120s || true

echo
echo "Hichki is now broken: $FAULT"
if [ "$FAULT" = uploads ]; then
  echo "Send a photo from a guest phone: it fails. Then ask NudgeBee:"
  echo "  \"Why are photo uploads failing for the hichki deployment in the $NAMESPACE namespace?\""
else
  echo "Within about a minute the pod is OOMKilled and restarts. Watch it with:"
  echo "  kubectl -n $NAMESPACE get pods -w"
  echo "Then ask NudgeBee:"
  echo "  \"Why does the hichki pod in the $NAMESPACE namespace keep restarting?\""
fi
