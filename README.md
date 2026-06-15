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

## Highlights

- **Install NDK** — a guided form that either generates a ready-to-run
  `install-ndk.sh` or runs the installer as an in-cluster Job and streams its
  logs live (installs CSI, cert-manager, NDK, and configures storage). Remote
  registration is no longer bundled here — it lives in its own **Remotes**
  section so install stays focused on the cluster itself.
- **Add cluster** — paste or upload a kubeconfig to register a cluster with
  Headlamp on the fly.
- **Cluster switcher** — a custom cluster chooser with a clear dropdown
  affordance, so multi-cluster switching is obvious.
- **Calmer reconnects** — Headlamp's harsh red "something went wrong with
  cluster" flash is softened into a quiet "Reconnecting…" bar.
- **Snapshot & replicate** — take an application snapshot and replicate it to a
  peer cluster in one action (the headline workflow).
- **Restore** — smart restore of a snapshot, including snapshots replicated in
  from another cluster.

## The NDK Data Protection sidebar

The plugin adds a single **NDK Data Protection** section to the sidebar, split
into a read-only Overview plus one focused page per resource type. You *view*
everything on the Overview and *create / manage* each resource on its own page.

| Page | Path | What it does |
| --- | --- | --- |
| **Overview** | `/ndk` | Read-only landing page. Everything protected on the cluster at a glance — applications, snapshots, replications, replication targets, remotes, and schedules. No creation here; jump to a section to act. |
| **Applications** | `/ndk/applications` | NDK-protected applications discovered on the cluster. |
| **Snapshots** | `/ndk/snapshots` | Point-in-time snapshots. Snapshot & replicate, or restore. |
| **Replications** | `/ndk/replications` | Live status of every replication — in progress, complete, or blocked (with the reason, including target health). |
| **Remotes** | `/ndk/remotes` | Register and list peer clusters you replicate to — one **Remote** per peer (pointing at its `ndk-intercom-service`). |
| **Replication Targets** | `/ndk/replication-targets` | The per-namespace destinations snapshots replicate to. Create one per namespace + remote, with **safe delete** that respects finalizers and in-flight replications. |
| **Schedules** | `/ndk/schedules` | Recurring snapshot (and replication) schedules. Create, pause, resume, and delete. |

Every NDK **Application** detail view also gets an inline **NDK Data Protection**
panel with Snapshot & Replicate, Schedule, and Create Replication Target actions
scoped to that application's namespace, plus its snapshots, replications,
replication targets, and schedules.

## Quick start

```bash
git clone <this-repo> && cd ndk-headlamp-plugin
npm install
npm run start   # watch-build + hot-copy into the local Headlamp plugin dir
```

Open Headlamp (v0.42.x) with a kubeconfig for your NDK cluster(s). The plugin
shows up as **NDK Data Protection** in the sidebar and hot-reloads on every save.

Requirements: Node 20 LTS + npm 10 (`nvm install 20`).

## Building & deploying

- `npm run build` produces `dist/main.js` for a production install.
- `npm run start` watch-builds and copies the bundle into the local Headlamp
  plugins dir (`~/.config/Headlamp/plugins/ndk-headlamp-plugin`).
- `deploy-to-cluster.sh` pushes a build into a shared in-cluster Headlamp pod
  for demos (`KUBECONFIG=... ./deploy-to-cluster.sh`).
- The install script is defined once in `src/install/scriptText.ts`; run
  `npm run gen:script` to regenerate the standalone `scripts/install-ndk.sh`.

## Project layout

```
src/
  index.tsx          # cluster chooser, AppBar actions, NDK sidebar + per-resource routes
  applyUiTweaks.ts   # softens Headlamp's core cluster-error banner
  api/               # K8s CRD factories, imperative writers, schedule actions, types
  install/           # install inputs/validation, canonical script, in-cluster Job
  components/         # Overview dashboard, per-resource lists, cluster chooser,
                     #   AppBar actions, and all dialogs (install, add-cluster,
                     #   snapshot/replicate, restore, schedule, replication target, remote)
  utils/helpers.ts   # shared formatters
scripts/             # generator + generated install-ndk.sh
```

## Development

See [`AGENTS.md`](./AGENTS.md) for the full script reference and Headlamp plugin
patterns. Typical loop: `npm run start`, then `npm run tsc`, `npm run lint`, and
`npm run test` before opening a PR.
