# NDK Headlamp Plugin

A [Headlamp](https://headlamp.dev) plugin that brings **Nutanix Data services for
Kubernetes (NDK)** data protection into the Kubernetes dashboard. Install NDK and
then snapshot, replicate, restore, and schedule protection for your stateful
workloads — all point-and-click, without touching `kubectl` or raw YAML.

## Why

NDK protects Kubernetes applications through CRDs (`applications`,
`applicationsnapshots`, `applicationsnapshotreplications`,
`applicationsnapshotrestores`, `replicationtargets`, `remotes`, `jobschedulers`).
Driving those by hand is tedious and error-prone. This plugin turns the full
NDK data-protection lifecycle into guided UI flows inside Headlamp.

## Features

- **Install NDK** — a guided form that either generates a ready-to-run
  `install-ndk.sh` or runs the installer as an in-cluster Job and streams its
  logs live (installs CSI, cert-manager, NDK, and configures storage/remote).
- **Add cluster** — paste or upload a kubeconfig to register a cluster with
  Headlamp on the fly.
- **Protection dashboard** — a single landing page (`/ndk`) with live summary
  cards for applications, snapshots, replications, and schedules.
- **Snapshot & replicate** — take an application snapshot and replicate it to a
  peer cluster in one action (the headline workflow).
- **Restore** — smart restore of a snapshot, including snapshots replicated in
  from another cluster.
- **Schedules** — create recurring protection jobs and pause/resume/delete them.
- **Replication targets** — create, list, and safely delete replication targets
  and their remote peers.

## Quick start

```bash
git clone <this-repo> && cd ndk-headlamp-plugin
npm install
npm run start   # watch-build + hot-copy into the local Headlamp desktop plugin dir
```

Open the Headlamp desktop app (v0.42.x) with a kubeconfig for your NDK
cluster(s). The plugin shows up as **NDK Data Protection** in the sidebar and
hot-reloads on every save.

Requirements: Node 20 LTS + npm 10 (`nvm install 20`).

## Building & deploying

- `npm run build` produces `dist/main.js` for a production install.
- `deploy-to-cluster.sh` pushes that build into a shared in-cluster Headlamp pod
  for demos (`KUBECONFIG=... ./deploy-to-cluster.sh`).
- The install script is defined once in `src/install/scriptText.ts`; run
  `npm run gen:script` to regenerate the standalone `scripts/install-ndk.sh`.

## Project layout

```
src/
  index.tsx          # registers sidebar, /ndk route, and AppBar actions
  api/               # K8s CRD factories, imperative writers, schedule actions, types
  install/           # install inputs/validation, canonical script, in-cluster Job
  components/         # dashboard + all dialogs (install, snapshot, replicate, restore, schedule)
  utils/helpers.ts   # shared formatters
scripts/             # generator + generated install-ndk.sh
```

## Development

See [`AGENTS.md`](./AGENTS.md) for the full script reference and Headlamp plugin
patterns. Typical loop: `npm run start`, then `npm run tsc`, `npm run lint`, and
`npm run test` before opening a PR.
