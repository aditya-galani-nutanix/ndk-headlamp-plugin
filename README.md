# ndk-headlamp-plugin

A Headlamp plugin that adds **NDK Data Protection** features (snapshot, replicate,
restore, schedule) to the Headlamp Kubernetes UI. Built for the NDK hackathon.

## Prerequisites (each teammate)

- Node 20 LTS + npm 10 (use `nvm install 20`).
- The shared kubeconfig (`ndk-clusters.kubeconfig`) with the primary + secondary
  clusters. Put it somewhere and `export KUBECONFIG=/path/to/ndk-clusters.kubeconfig`.
- The Headlamp desktop app (v0.42.x) for the dev loop below.

## Quick start

```bash
git clone <this-repo> && cd ndk-headlamp-plugin
npm install
npm run start    # watch-builds and hot-copies into the local Headlamp desktop plugin dir
```

Open the Headlamp desktop app (loaded with `ndk-clusters.kubeconfig`). The plugin
appears as **"NDK Data Protection"** in the sidebar. Edits to `src/` rebuild and
hot-reload automatically.

## Two-track workflow

- **Track A — develop (per person):** `npm run start`. The watcher rebuilds on save
  and copies into `~/.config/Headlamp/plugins/ndk-headlamp-plugin/` (Linux) /
  `~/Library/Application Support/Headlamp/plugins/...` (macOS). Your local Headlamp
  hot-reloads. Only you see your changes.
- **Track B — integrate/demo (shared):** after merging to `main`, `npm run build`
  produces `dist/main.js`, which gets deployed into the shared in-cluster Headlamp so
  everyone (and the demo) sees the combined plugin. See `deploy-to-cluster.sh`.

## Project structure

```
src/
  index.tsx                 # P1 — registers sidebar, /ndk route, AppBar discovery chip
  api/
    ndk-resources.ts        # P1 (shared) — K8s factories for all NDK CRDs
    types.ts                # P1 (shared) — NDK CR TypeScript interfaces
    cluster-discovery.ts    # P1 — auto-discovery of peer clusters via Remote CRs
  components/
    ProtectionDashboard.tsx # P1 — landing page (/ndk) with live summary cards
    ClusterDiscovery.tsx    # P1 — AppBar "NDK: N peers" chip
    TakeSnapshotDialog.tsx  # P2 — manual snapshot
    SnapshotAndReplicate.tsx# P2 — merged snapshot + replicate (hero feature)
    SnapshotList.tsx        # P3 — snapshot list + status badges
    RestoreButton.tsx       # P3 — smart restore
    ScheduleForm.tsx        # P4 — create recurring schedule
    ScheduleList.tsx        # P4 — schedule list + pause/resume/delete
  utils/
    helpers.ts              # P1 (shared) — formatters
```

## NDK CRDs (confirmed on cluster)

- `dataservices.nutanix.com/v1alpha1`: `applications`, `applicationsnapshots`,
  `applicationsnapshotreplications`, `applicationsnapshotrestores`,
  `replicationtargets`, `remotes` (cluster-scoped).
- `scheduler.nutanix.com/v1alpha1`: `jobschedulers`.

## Branching

Work on `feature/<name>` branches, open a quick PR, merge to `main`. P1 owns
re-deploying `main` to the shared in-cluster Headlamp (Track B).
