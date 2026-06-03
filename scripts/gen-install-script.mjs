#!/usr/bin/env node
// Emits scripts/install-ndk.sh from the canonical body in
// src/install/scriptText.ts. The body is a String.raw template using `DOLLAR{`
// in place of bash `${` (so it does not collide with JS template substitution);
// we extract it verbatim and restore the bash expansions. No build/transpile is
// required, so this works on plain Node.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const srcPath = join(root, 'src', 'install', 'scriptText.ts');
const outPath = join(root, 'scripts', 'install-ndk.sh');

const src = readFileSync(srcPath, 'utf8');
const match = src.match(/String\.raw`([\s\S]*?)`;/);
if (!match) {
  console.error(`Could not find the INSTALL_NDK_SH body in ${srcPath}`);
  process.exit(1);
}
const body = match[1].replace(/DOLLAR\{/g, '${');

const header = [
  '#!/usr/bin/env bash',
  '# NDK install script.',
  '# Generated from src/install/scriptText.ts via `npm run gen:script` — do not edit by hand.',
  '#',
  '# Required:        CSI_URL NDK_URL ARTIFACTORY_USERNAME ARTIFACTORY_API_KEY CLUSTER_NAME PC_IP',
  '# StorageCluster:  SC_NAME PE_UUID PC_UUID',
  '# Optional:        OS_NAME VOLUME_BINDING_MODE PC_USERNAME PC_PASSWORD CUSTOM_VALUES_URL KUBECONFIG',
  '# LoadBalancer:    ENABLE_LB=true (default) auto-detects a free VIP from Jarvis (uses CLUSTER_NAME)',
  '#                  for ndk-intercom-service (SyncRep); set ENABLE_LB=false for snapshot-only.',
  '# Optional Remote: REMOTE_NAME REMOTE_NDK_SERVICE_IP REMOTE_NDK_SERVICE_PORT REMOTE_CLUSTER_NAME REMOTE_SKIP_TLS_VERIFY',
  '',
].join('\n');

writeFileSync(outPath, `${header}\n${body}`, { mode: 0o755 });
console.log(`Wrote ${outPath}`);
