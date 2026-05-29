// Auto-discovery logic: read NDK Remote CRs and register peer clusters in Headlamp.
// Owner: P1 — Day 1 first task (MUST land before P2/P3 cross-cluster testing).
//
// This is a scaffold stub. Implementation plan:
//   1. List Remote CRs (RemoteClass) on the connected primary cluster.
//   2. For each Ready remote, read the referenced kubeconfig Secret.
//   3. Call Headlamp.setCluster(...) to register the peer dynamically.
//
// Import RemoteClass from './ndk-resources' when implementing.

export interface DiscoveredPeer {
  name: string;
  ready: boolean;
}

// TODO(P1): implement real discovery using RemoteClass.useList() inside a hook,
// or RemoteClass.apiList() imperatively, then Headlamp.setCluster() per peer.
export async function discoverPeers(): Promise<DiscoveredPeer[]> {
  return [];
}
