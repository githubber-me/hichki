#!/usr/bin/env bash
# Undo deploy/break.sh: remove the fault and wait for a healthy pod.
#   bash deploy/fix.sh
set -euo pipefail

NAMESPACE="${APP_NAMESPACE:-hichki}"
# Always the Hichki cluster, whatever kubectl is pointed at.
kubectl() { command kubectl --context "kind-${CLUSTER_NAME:-hichki}" "$@"; }
kubectl -n "$NAMESPACE" set env deployment/hichki BREAK-
kubectl -n "$NAMESPACE" rollout status deployment/hichki --timeout=120s
echo "Hichki is healthy again."
