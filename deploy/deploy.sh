#!/usr/bin/env bash
# Build Hichki, load it into the local kind cluster and (re)deploy it.
# Creates the cluster first if it doesn't exist. Run from the repo root:
#   bash deploy/deploy.sh
set -euo pipefail

CLUSTER="${CLUSTER_NAME:-hichki}"
NAMESPACE="${APP_NAMESPACE:-hichki}"
ENV_FILE="${ENV_FILE:-.env.local}"
[ -f "$ENV_FILE" ] || ENV_FILE=.env

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "Creating cluster $CLUSTER"
  kind create cluster --config deploy/kind.yaml --wait 120s
fi
kubectl config use-context "kind-$CLUSTER" >/dev/null

echo "Building the image"
docker build -t hichki:dev .
kind load docker-image hichki:dev --name "$CLUSTER"

kubectl apply -f deploy/k8s/app.yaml

# Only the keys go into the cluster (Sarvam, Flagsmith, and Clerk for optional sign-in),
# read from the local env file.
echo "Updating secrets from $ENV_FILE"
kubectl -n "$NAMESPACE" create secret generic hichki-secrets \
  --from-env-file=<(grep -E '^(SARVAM_API_KEY|FLAGSMITH_SERVER_SIDE_ENVIRONMENT_KEY|CLERK_PUBLISHABLE_KEY|CLERK_SECRET_KEY)=' "$ENV_FILE") \
  --dry-run=client -o yaml | kubectl apply -f -

# Same tag every time, so restart to pick up the newly loaded image.
kubectl -n "$NAMESPACE" rollout restart deployment/hichki
kubectl -n "$NAMESPACE" rollout status deployment/hichki --timeout=120s

echo
echo "Hichki is running at http://localhost:8088"
echo "For phones, open a public HTTPS link with: bash deploy/tunnel.sh"
