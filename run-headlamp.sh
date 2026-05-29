#!/usr/bin/env bash
# Run Headlamp locally (Docker) for NDK plugin development, with auto-discovery
# of peer clusters enabled.
#
# What this sets up:
#   - Headlamp web UI on :4466
#   - Mounts the built plugin from ~/.config/Headlamp/plugins
#   - Starts with ONLY the primary kubeconfig mounted
#   - --enable-dynamic-clusters so the plugin can register peers via setCluster()
#
# The plugin discovers peers by reading NDK Remote CRs on the primary, then
# fetching each peer's kubeconfig from a Secret named
# `ndk-peer-kubeconfig-<remoteName>` in kube-system. Create that Secret with:
#
#   kubectl --kubeconfig <primary> -n kube-system create secret generic \
#     ndk-peer-kubeconfig-<remoteName> --from-file=kubeconfig=<peer.kubeconfig>
#
set -euo pipefail

PRIMARY_KUBECONFIG="${PRIMARY_KUBECONFIG:-$HOME/workspace/ndk-syncrep/primary.kubeconfig}"
PLUGINS_DIR="${PLUGINS_DIR:-$HOME/.config/Headlamp/plugins}"
IMAGE="${IMAGE:-ghcr.io/headlamp-k8s/headlamp:v0.42.0}"
PORT="${PORT:-4466}"

# Headlamp runs as a non-root user inside the container and must be able to read
# the mounted kubeconfig, so give it a world-readable copy (admin certs — keep
# private to this host and rotate after use).
MOUNT_KUBECONFIG="$(dirname "$PRIMARY_KUBECONFIG")/primary.docker.kubeconfig"
cp "$PRIMARY_KUBECONFIG" "$MOUNT_KUBECONFIG"
chmod 644 "$MOUNT_KUBECONFIG"

mkdir -p "$PLUGINS_DIR"

docker rm -f headlamp >/dev/null 2>&1 || true
docker run -d --name headlamp -p "${PORT}:4466" \
  -v "$PLUGINS_DIR:/headlamp/plugins" \
  -v "$MOUNT_KUBECONFIG:/home/headlamp/.kube/config:ro" \
  "$IMAGE" \
  -plugins-dir=/headlamp/plugins \
  -enable-dynamic-clusters

echo "Headlamp running on http://localhost:${PORT} (or http://<host-ip>:${PORT})"
echo "Open the primary cluster — the NDK plugin will auto-register discovered peers."
