// Auto-discovery: read NDK Remote CRs on the current (primary) cluster and
// register each available peer in Headlamp via Headlamp.setCluster(), so the
// secondary/DR cluster shows up in the cluster picker automatically.
// Owner: P1 — Day 1 first task (unblocks P2/P3 cross-cluster testing).
//
// Requires the Headlamp server to run with --enable-dynamic-clusters.
//
// How a peer's kubeconfig is located:
//   The Remote CR itself only carries the NDK service endpoint, not Kubernetes
//   API credentials. So for each Remote we look up a Secret holding the peer's
//   kubeconfig. The Secret name is taken from the Remote annotation
//   `ndk.nutanix.com/kubeconfig-secret`, or defaults to the convention
//   `ndk-peer-kubeconfig-<remoteName>`. The Secret must have a `kubeconfig` key
//   (a standard, single-context kubeconfig for the peer cluster).

import { ApiProxy, Headlamp } from '@kinvolk/headlamp-plugin/lib';

const REMOTES_PATH = '/apis/dataservices.nutanix.com/v1alpha1/remotes';
const PEER_KUBECONFIG_NAMESPACE = 'kube-system';
const KUBECONFIG_SECRET_ANNOTATION = 'ndk.nutanix.com/kubeconfig-secret';
const SECRET_DATA_KEY = 'kubeconfig';

export interface DiscoveredPeer {
  /** Remote CR name (used as the registered cluster name). */
  name: string;
  /** Whether the Remote reports an Available=True condition. */
  ready: boolean;
  /** Whether we successfully registered it via Headlamp.setCluster(). */
  registered: boolean;
  /** Populated when registration was attempted but failed. */
  error?: string;
}

interface RemoteCR {
  metadata: { name: string; annotations?: Record<string, string> };
  status?: { conditions?: Array<{ type: string; status: string }> };
}

function isAvailable(remote: RemoteCR): boolean {
  const conditions = remote.status?.conditions ?? [];
  return conditions.some(c => c.type === 'Available' && c.status === 'True');
}

function secretNameForRemote(remote: RemoteCR): string {
  return (
    remote.metadata.annotations?.[KUBECONFIG_SECRET_ANNOTATION] ||
    `ndk-peer-kubeconfig-${remote.metadata.name}`
  );
}

/**
 * Lists Remote CRs on the current cluster and registers each available peer in
 * Headlamp. Idempotent: re-registering an existing cluster just updates it.
 *
 * @returns the discovered peers with their registration status.
 */
export async function discoverAndRegisterPeers(): Promise<DiscoveredPeer[]> {
  const peers: DiscoveredPeer[] = [];

  let remotes: RemoteCR[] = [];
  try {
    const resp = await ApiProxy.request(REMOTES_PATH);
    remotes = resp?.items ?? [];
  } catch (e) {
    // No NDK on this cluster / not reachable — nothing to discover.
    return peers;
  }

  for (const remote of remotes) {
    const peer: DiscoveredPeer = {
      name: remote.metadata.name,
      ready: isAvailable(remote),
      registered: false,
    };

    if (peer.ready) {
      try {
        const secretName = secretNameForRemote(remote);
        const secret = await ApiProxy.request(
          `/api/v1/namespaces/${PEER_KUBECONFIG_NAMESPACE}/secrets/${secretName}`
        );
        // Secret .data values are already base64-encoded, which is exactly the
        // format Headlamp.setCluster expects for `kubeconfig`.
        const kubeconfig = secret?.data?.[SECRET_DATA_KEY];
        if (!kubeconfig) {
          peer.error = `Secret ${PEER_KUBECONFIG_NAMESPACE}/${secretName} has no "${SECRET_DATA_KEY}" key`;
        } else {
          await Headlamp.setCluster({ name: remote.metadata.name, kubeconfig });
          peer.registered = true;
        }
      } catch (e) {
        peer.error = e instanceof Error ? e.message : String(e);
      }
    }

    peers.push(peer);
  }

  return peers;
}
