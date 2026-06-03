#!/usr/bin/env bash
# NDK install script.
# Generated from src/install/scriptText.ts via `npm run gen:script` — do not edit by hand.
#
# Required:        CSI_URL NDK_URL ARTIFACTORY_USERNAME ARTIFACTORY_API_KEY CLUSTER_NAME PC_IP
# StorageCluster:  SC_NAME PE_UUID PC_UUID
# Optional:        OS_NAME VOLUME_BINDING_MODE PC_USERNAME PC_PASSWORD CUSTOM_VALUES_URL KUBECONFIG
# LoadBalancer:    ENABLE_LB=true (default) auto-detects a free VIP from Jarvis (uses CLUSTER_NAME)
#                  for ndk-intercom-service (SyncRep); set ENABLE_LB=false for snapshot-only.
# Optional Remote: REMOTE_NAME REMOTE_NDK_SERVICE_IP REMOTE_NDK_SERVICE_PORT REMOTE_CLUSTER_NAME REMOTE_SKIP_TLS_VERIFY

set -euo pipefail

# ---- Required environment variables ----
: "${CSI_URL:?CSI_URL is required}"
: "${NDK_URL:?NDK_URL is required}"
: "${ARTIFACTORY_USERNAME:?ARTIFACTORY_USERNAME is required}"
: "${ARTIFACTORY_API_KEY:?ARTIFACTORY_API_KEY is required}"
: "${CLUSTER_NAME:?CLUSTER_NAME is required}"
: "${PC_IP:?PC_IP is required}"

# ---- Defaults for optional variables ----
OS_NAME="${OS_NAME:-ubuntu}"
VOLUME_BINDING_MODE="${VOLUME_BINDING_MODE:-WaitForFirstConsumer}"
PC_USERNAME="${PC_USERNAME:-admin}"
PC_PASSWORD="${PC_PASSWORD:-Nutanix.123}"
NAMESPACE="ntnx-system"
WORKDIR="$(mktemp -d)"
cd "$WORKDIR"

log() { printf '\n=== %s ===\n' "$*"; }

validate_ipv4() {
  if ! printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    echo "Invalid IPv4 address: $1" >&2
    return 1
  fi
}

# ---- SyncRep LoadBalancer helpers (free-IP discovery + validation) ----
# Mirrors the SyncRep doc's get-free-static-ips.sh: candidates come from the
# cluster's Jarvis static-IP allocation, and an IP counts as "in use" if it
# answers ICMP or has a common TCP port open. We never ask the operator for the
# VIP (a hand-picked IP risks colliding with one already in use).

# True (0) if $1 looks occupied: responds to ping, else has a common port open.
ip_in_use() {
  ip="$1"
  if ping -c 1 -W 1 "$ip" >/dev/null 2>&1; then
    return 0
  fi
  for p in 22 80 443 8080 8443; do
    if timeout 1 bash -c "cat < /dev/null > /dev/tcp/$ip/$p" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

# True (0) if $1 is already bound to some *other* Service (LB ingress / externalIP
# / spec.loadBalancerIP). ndk-intercom-service itself is excluded so re-runs pass.
ip_claimed_by_service() {
  ip="$1"
  kubectl get svc -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{" "}{.status.loadBalancer.ingress[*].ip}{" "}{.spec.externalIPs[*]}{" "}{.spec.loadBalancerIP}{"\n"}{end}' 2>/dev/null \
    | grep -v "/ndk-intercom-service " \
    | grep -Fwq "$ip"
}

# Echo the cluster's reserved static IPs (one per line) from Jarvis. The
# interesting list lives in data.custom (itself a JSON string), under static_ips.
jarvis_static_ips() {
  cl="$1"
  out="$(curl -sk --max-time 15 "https://jarvis.eng.nutanix.com/api/v1/clusters/$cl" 2>/dev/null)" || return 1
  [ -n "$out" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$out" | jq -r '.data.custom | fromjson | .static_ips[].ip' 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$out" | python3 -c 'import sys,json;d=json.load(sys.stdin);c=d.get("data",{}).get("custom");c=json.loads(c) if isinstance(c,str) else (c or {});print("\n".join(x.get("ip","") for x in c.get("static_ips",[])))' 2>/dev/null
  else
    # No JSON parser: best-effort scrape of IPv4s from the static_ips block.
    printf '%s' "$out" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}'
  fi
}

log "Prechecks"
validate_ipv4 "$PC_IP"
for c in kubectl helm curl tar wget; do
  command -v "$c" >/dev/null || { echo "Required command not found: $c" >&2; exit 1; }
done
kubectl cluster-info
kubectl get nodes

log "Step 0: ensure namespace $NAMESPACE"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

log "Step 1: install nutanix-csi-snapshot"
helm repo add nutanix https://nutanix.github.io/helm-releases >/dev/null 2>&1 || true
helm repo update
if helm -n "$NAMESPACE" status nutanix-csi-snapshot >/dev/null 2>&1; then
  echo "nutanix-csi-snapshot already installed"
else
  helm install nutanix-csi-snapshot nutanix/nutanix-csi-snapshot -n "$NAMESPACE" --create-namespace
fi

log "Step 2a: download + extract CSI chart"
csi_file="$(basename "$CSI_URL")"
curl -ksL -O -H "X-JFrog-Art-Api:$ARTIFACTORY_API_KEY" "$CSI_URL"
mkdir -p nutanix-csi-storage
tar -xzf "$csi_file" -C nutanix-csi-storage --strip-components=1

log "Step 2b: install CSI"
if helm -n "$NAMESPACE" status ntnx-csi >/dev/null 2>&1; then
  echo "ntnx-csi already installed"
else
  # NDK talks to Prism Central, so only the PC secret is needed. Disable the PE
  # secret (createSecret) — otherwise the chart's precheck demands PE
  # credentials we don't collect. If a PC secret already exists, don't let the
  # chart recreate it. This matches the supported install configuration.
  CSI_EXTRA_FLAGS="--set createSecret=false"
  if kubectl -n "$NAMESPACE" get secret ntnx-pc-secret >/dev/null 2>&1; then
    CSI_EXTRA_FLAGS="$CSI_EXTRA_FLAGS --set createPrismCentralSecret=false"
  fi
  helm install ntnx-csi -n "$NAMESPACE" ./nutanix-csi-storage \
    --set prismCentralEndPoint="$PC_IP" \
    --set pcUsername="$PC_USERNAME" \
    --set pcPassword="$PC_PASSWORD" \
    $CSI_EXTRA_FLAGS \
    --set controller.replicas=1
fi
kubectl -n "$NAMESPACE" wait --for=condition=Ready pod -l app=nutanix-csi-controller --timeout=300s
kubectl -n "$NAMESPACE" wait --for=condition=Ready pod -l app=nutanix-csi-node --timeout=300s
kubectl get csidriver

log "Step 2c: create StorageClass nutanix-volume (volumeBindingMode=$VOLUME_BINDING_MODE)"
cat <<EOF | kubectl apply -f -
allowVolumeExpansion: true
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: nutanix-volume
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
parameters:
  csi.storage.k8s.io/fstype: ext4
  storageContainer: SelfServiceContainer
  storageType: NutanixVolumes
provisioner: csi.nutanix.com
reclaimPolicy: Retain
volumeBindingMode: ${VOLUME_BINDING_MODE}
EOF

log "Step 2d: LoadBalancer for ndk-intercom-service (auto-detected free VIP)"
# NDK exposes ndk-intercom-service as a LoadBalancer (:2021) for SyncRep/Remote
# reachability. CAPX/AHV clusters have no cloud LB, so install kube-vip's
# service-LB: the cloud-provider hands out IPs from a pool and the DaemonSet
# advertises them via ARP. Non-fatal — NDK installs fine without it; only Remote
# replication needs the external IP. The VIP is discovered (Jarvis static IPs +
# free-check), never supplied by hand. Versions/config mirror a known-good
# cluster; the kube-vip SA + role already exist from the control-plane VIP.
LB_IP=""
if [ "${ENABLE_LB:-true}" != "true" ]; then
  echo "ENABLE_LB=${ENABLE_LB:-true}; skipping LoadBalancer (snapshot-only). ndk-intercom-service will stay <pending>."
else
  # kube-vip's service-LB needs the kube-vip RBAC. CAPX/AHV clusters already have
  # it (from the control-plane VIP); otherwise bootstrap it the way the SyncRep
  # doc's kubevip-install.sh does, and only skip if it's still absent afterward.
  if ! kubectl -n kube-system get sa kube-vip >/dev/null 2>&1; then
    echo "kube-vip ServiceAccount not found; installing kube-vip RBAC (kube-vip.io/manifests/rbac.yaml)..."
    kubectl apply -f https://kube-vip.io/manifests/rbac.yaml || echo "WARN: kube-vip RBAC apply failed"
  fi
  if ! kubectl -n kube-system get sa kube-vip >/dev/null 2>&1; then
    echo "WARN: 'kube-vip' ServiceAccount still missing; skipping service-LB. ndk-intercom-service will stay <pending> (SyncRep/Remote needs an external IP)."
  else
    # Re-run guard: if ndk-intercom-service already holds an external IP, keep it
    # rather than churning to a new VIP.
    existing_ip="$(kubectl -n "$NAMESPACE" get svc ndk-intercom-service -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    if [ -n "$existing_ip" ]; then
      echo "ndk-intercom-service already has external IP $existing_ip; reusing it"
      LB_IP="$existing_ip"
    else
      echo "Discovering a free static IP from Jarvis for cluster '$CLUSTER_NAME'..."
      candidates="$(jarvis_static_ips "$CLUSTER_NAME" || true)"
      if [ -z "$candidates" ]; then
        echo "WARN: could not get static IPs from Jarvis for '$CLUSTER_NAME' (unreachable, no jq/python3, or unknown cluster name). Skipping LB; ndk-intercom-service will stay <pending>."
      else
        echo "Jarvis candidates: $(printf '%s' "$candidates" | tr '\n' ' ')"
        for ip in $candidates; do
          validate_ipv4 "$ip" 2>/dev/null || continue
          echo "checking $ip ..."
          if ip_in_use "$ip"; then echo "  in use (ICMP/TCP) - skip"; continue; fi
          if ip_claimed_by_service "$ip"; then echo "  already bound to another Service - skip"; continue; fi
          # Extra check: probe once more after a short pause to catch a racing claim
          # between the first scan and actually taking the IP.
          sleep 2
          if ip_in_use "$ip"; then echo "  became reachable on re-check - skip"; continue; fi
          LB_IP="$ip"
          echo "  selected free IP: $ip"
          break
        done
        [ -n "$LB_IP" ] || echo "WARN: no free IP among Jarvis candidates; skipping LB. Free one up (or re-run); ndk-intercom-service will stay <pending>."
      fi
    fi
  fi
fi
if [ -n "$LB_IP" ]; then
    echo "Configuring kube-vip service-LB with range-global=$LB_IP-$LB_IP"
    kubectl -n kube-system create configmap kubevip \
      --from-literal "range-global=$LB_IP-$LB_IP" \
      --dry-run=client -o yaml | kubectl apply -f -
    kubectl apply -f https://raw.githubusercontent.com/kube-vip/kube-vip-cloud-provider/v0.0.7/manifest/kube-vip-cloud-controller.yaml || true
    cat <<'KVDS' | kubectl apply -f -
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: kube-vip-ds
  namespace: kube-system
  labels:
    app.kubernetes.io/name: kube-vip-ds
    app.kubernetes.io/version: v0.6.3
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: kube-vip-ds
  template:
    metadata:
      labels:
        app.kubernetes.io/name: kube-vip-ds
        app.kubernetes.io/version: v0.6.3
    spec:
      hostNetwork: true
      serviceAccountName: kube-vip
      containers:
      - name: kube-vip
        image: ghcr.io/kube-vip/kube-vip:v0.6.3
        imagePullPolicy: Always
        args:
        - manager
        securityContext:
          capabilities:
            add:
            - NET_ADMIN
            - NET_RAW
        env:
        - name: vip_arp
          value: "true"
        - name: port
          value: "6443"
        - name: vip_cidr
          value: "32"
        - name: svc_enable
          value: "true"
        - name: svc_election
          value: "true"
        - name: vip_leaderelection
          value: "true"
        - name: vip_leaseduration
          value: "5"
        - name: vip_renewdeadline
          value: "3"
        - name: vip_retryperiod
          value: "1"
        - name: prometheus_server
          value: ":2112"
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
KVDS
    kubectl -n kube-system rollout status deploy/kube-vip-cloud-provider --timeout=180s || echo "WARN: kube-vip-cloud-provider not ready yet"
    kubectl -n kube-system rollout status ds/kube-vip-ds --timeout=180s || echo "WARN: kube-vip-ds not ready yet"
    echo "LoadBalancer configured; ndk-intercom-service will be assigned external IP: $LB_IP"
fi

log "Step 3a: install cert-manager"
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.8.0/cert-manager.yaml
kubectl -n cert-manager rollout status deploy/cert-manager --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-webhook --timeout=300s
kubectl -n cert-manager rollout status deploy/cert-manager-cainjector --timeout=300s
# "Pods Ready" != "webhook usable": cainjector still has to inject the CA bundle
# into cert-manager's webhook configs before the API server will trust it. Until
# then, any cert-manager object (incl. the NDK chart's Certificate/Issuer) fails
# with "x509: certificate signed by unknown authority". Block on a server-side
# dry-run that actually exercises the webhook so Step 3d doesn't race it.
echo "Waiting for cert-manager webhook to admit resources..."
webhook_ready=""
for i in $(seq 1 30); do
  if kubectl apply --dry-run=server -f - >/dev/null 2>&1 <<'PROBE'
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: cm-webhook-probe
  namespace: cert-manager
spec:
  selfSigned: {}
PROBE
  then
    webhook_ready="yes"
    echo "cert-manager webhook is ready"
    break
  fi
  echo "waiting for cert-manager webhook ($i/30)..."
  sleep 10
done
[ -n "$webhook_ready" ] || echo "WARN: cert-manager webhook probe did not pass in time; continuing (NDK install will retry)"

log "Step 3b: set canaveral certs (os=$OS_NAME)"
wget -q http://hoth.corp.nutanix.com/ndk/easy-install/canaveral-certs/daemonset.yaml
wget -q http://hoth.corp.nutanix.com/ndk/easy-install/canaveral-certs/install_canaveral_certs.sh
chmod +x install_canaveral_certs.sh
./install_canaveral_certs.sh "$OS_NAME"

log "Step 3c: download NDK chart"
ndk_file="$(basename "$NDK_URL")"
curl -ksL -O -H "X-JFrog-Art-Api:$ARTIFACTORY_API_KEY" "$NDK_URL"
case "$ndk_file" in
  *.tgz) : ;;
  *) echo "NDK_URL does not point to a .tgz file" >&2; exit 1 ;;
esac
NDK_VALUES_FLAGS=""
if [ -n "${CUSTOM_VALUES_URL:-}" ]; then
  curl -ksL -H "X-JFrog-Art-Api:$ARTIFACTORY_API_KEY" "$CUSTOM_VALUES_URL" -o custom-values.yaml
  NDK_VALUES_FLAGS="-f custom-values.yaml"
fi

log "Step 3d: install NDK"
# Re-runnability: a previous run can leave a non-deployed (failed/pending)
# release behind, and 'helm install' cannot reuse that name. Keep a healthy
# release as-is; otherwise remove the leftover before installing.
# NOTE: keep the '|| true' — under 'set -euo pipefail' a bare assignment whose
# command-substitution pipeline fails (e.g. 'helm status ndk' on a fresh cluster
# with no release, propagated by pipefail) aborts the whole script. The guard
# lets ndk_status fall back to "" so the install path below runs.
ndk_status="$(helm -n "$NAMESPACE" status ndk 2>/dev/null | sed -n 's/^STATUS: //p')" || true
if [ "$ndk_status" = "deployed" ]; then
  echo "ndk already installed"
else
  if [ -n "$ndk_status" ]; then
    echo "removing previous ndk release (status: $ndk_status)"
    helm -n "$NAMESPACE" uninstall ndk || true
  fi
  # Retry to absorb a transient webhook miss right after cert-manager comes up.
  ndk_ok=""
  for i in $(seq 1 5); do
    if helm install ndk -n "$NAMESPACE" "$ndk_file" \
      $NDK_VALUES_FLAGS \
      --set tls.server.clusterName="$CLUSTER_NAME"; then
      ndk_ok="yes"
      break
    fi
    echo "ndk install attempt $i failed; cleaning up and retrying in 15s..."
    helm -n "$NAMESPACE" uninstall ndk >/dev/null 2>&1 || true
    sleep 15
  done
  [ -n "$ndk_ok" ] || { echo "NDK install failed after retries" >&2; exit 1; }
fi
kubectl -n "$NAMESPACE" wait --for=condition=Available deployment/ndk-controller-manager --timeout=300s

log "Step 4: register local StorageCluster"
if [ -n "${PE_UUID:-}" ] && [ -n "${PC_UUID:-}" ]; then
  SC_NAME_RAW="${SC_NAME:-${CLUSTER_NAME}-storagecluster}"
  # Kubernetes object names must be lowercase RFC 1123; normalize so a name like
  # "NDK-container" can't abort the whole install at apply time.
  SC_NAME="$(printf '%s' "$SC_NAME_RAW" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9.-]/-/g' -e 's/^[^a-z0-9]*//' -e 's/[^a-z0-9]*$//')"
  [ "$SC_NAME" = "$SC_NAME_RAW" ] || echo "Normalized StorageCluster name '$SC_NAME_RAW' -> '$SC_NAME'"
  # Non-fatal: NDK is already installed; a registration hiccup shouldn't fail the run.
  cat <<EOF | kubectl apply -f - || echo "WARN: StorageCluster apply failed; fix and re-apply separately"
apiVersion: dataservices.nutanix.com/v1alpha1
kind: StorageCluster
metadata:
  name: ${SC_NAME}
spec:
  storageServerUuid: "${PE_UUID}"
  managementServerUuid: "${PC_UUID}"
EOF
  kubectl wait storagecluster "${SC_NAME}" --for=jsonpath='{.status.available}'=true --timeout=300s \
    || echo "WARN: StorageCluster ${SC_NAME} not available yet; check 'kubectl describe storagecluster ${SC_NAME}'"
else
  echo "PE_UUID/PC_UUID not provided; skipping StorageCluster"
fi

log "Step 5: register Remote peer (optional)"
if [ -n "${REMOTE_NDK_SERVICE_IP:-}" ]; then
  validate_ipv4 "$REMOTE_NDK_SERVICE_IP"
  REMOTE_NAME_RAW="${REMOTE_NAME:-remote-${REMOTE_NDK_SERVICE_IP//./-}}"
  REMOTE_NAME="$(printf '%s' "$REMOTE_NAME_RAW" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9.-]/-/g' -e 's/^[^a-z0-9]*//' -e 's/[^a-z0-9]*$//')"
  [ "$REMOTE_NAME" = "$REMOTE_NAME_RAW" ] || echo "Normalized Remote name '$REMOTE_NAME_RAW' -> '$REMOTE_NAME'"
  REMOTE_NDK_SERVICE_PORT="${REMOTE_NDK_SERVICE_PORT:-2021}"
  {
    echo "apiVersion: dataservices.nutanix.com/v1alpha1"
    echo "kind: Remote"
    echo "metadata:"
    echo "  name: ${REMOTE_NAME}"
    echo "spec:"
    echo "  ndkServiceIp: \"${REMOTE_NDK_SERVICE_IP}\""
    echo "  ndkServicePort: ${REMOTE_NDK_SERVICE_PORT}"
    if [ -n "${REMOTE_CLUSTER_NAME:-}" ]; then
      echo "  clusterName: \"${REMOTE_CLUSTER_NAME}\""
    fi
    if [ "${REMOTE_SKIP_TLS_VERIFY:-true}" = "true" ]; then
      echo "  tlsConfig:"
      echo "    skipTLSVerify: true"
    fi
  } | kubectl apply -f - || echo "WARN: Remote apply failed; fix and re-apply separately"
else
  echo "REMOTE_NDK_SERVICE_IP not provided; skipping Remote"
fi

log "Verification"
kubectl -n "$NAMESPACE" get pods
kubectl -n "$NAMESPACE" get deploy
kubectl get sc nutanix-volume
kubectl -n "$NAMESPACE" get svc ndk-intercom-service 2>/dev/null || true
kubectl get storagecluster 2>/dev/null || true
kubectl get remote 2>/dev/null || true

log "NDK install complete"
