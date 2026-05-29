#!/usr/bin/env bash
# Track B: build the plugin and deploy it into the shared in-cluster Headlamp.
# Usage: KUBECONFIG=/path/to/primary.kubeconfig ./deploy-to-cluster.sh
#
# NOTE: the in-cluster pod's /headlamp/plugins is ephemeral — a pod restart wipes
# this. For a permanent install, bake the plugin into the image or mount a volume.
set -euo pipefail

NS="${NS:-kube-system}"
PLUGIN_NAME="ndk-headlamp-plugin"
DEST="/headlamp/plugins/${PLUGIN_NAME}"

echo ">> building..."
npm run build

POD="$(kubectl get pods -n "$NS" -l app.kubernetes.io/name=headlamp -o jsonpath='{.items[0].metadata.name}')"
echo ">> deploying to pod $POD ($NS)"

kubectl exec -n "$NS" "$POD" -- sh -c "mkdir -p $DEST"
kubectl exec -i -n "$NS" "$POD" -- sh -c "cat > $DEST/main.js" < dist/main.js
kubectl exec -i -n "$NS" "$POD" -- sh -c "cat > $DEST/package.json" < dist/package.json

echo ">> done. Refresh the Headlamp browser tab to load the new build."
