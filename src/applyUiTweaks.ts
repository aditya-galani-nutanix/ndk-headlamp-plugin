// Polishes a couple of Headlamp *core* UI bits that a plugin cannot reach
// through the official registration API.
//
// 1) Cluster "reconnecting" experience (the main fix).
//    When a *working* cluster's health check momentarily blips — most commonly
//    when you switch back to the Headlamp browser tab and it re-validates the
//    connection — Headlamp flashes a harsh, full-width red bar that reads
//    "Something went wrong with cluster <name>  [Choose another cluster]". It
//    usually vanishes a second later once the connection recovers, so it reads
//    as "the UI broke" when really it is just reconnecting.
//
//    That bar is Headlamp's `ClusterNotFoundPopup`, a plain MUI <Box> (a div),
//    NOT an <Alert> — so it has no stable class/id to target with CSS alone.
//    We therefore watch the DOM for it and, the moment it appears, reshape it
//    into a calm "Reconnecting to cluster…" bar with an indeterminate progress
//    animation (the "Choose another cluster" action stays, just restyled, so a
//    genuine failure is still recoverable). When the connection recovers,
//    Headlamp removes the bar on its own.
//
//    The bar is a React-managed node, so React can reset its `className` on a
//    re-render and drop the class we add. We guard against that by re-applying
//    the class whenever the node's class attribute changes.
//
// 2) Other core error notifications (MUI filled-error Alerts, e.g. the
//    AlertNotification banner) are reshaped into a compact rounded toast, and
//    hidden entirely on the auth/login screen where they are pure noise.
//
// This plugin's own alerts use the default ("standard") MUI Alert variant, so
// none of the rules below affect them.

const STYLE_ID = 'ndk-plugin-ui-tweaks';
const RECONNECTING_CLASS = 'ndk-cluster-reconnecting';

const CSS = `
@keyframes ndk-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* --- Transient cluster reconnect bar -------------------------------------- */
.${RECONNECTING_CLASS} {
  background-color: #243044 !important;
  color: #cbd5e1 !important;
  font-size: 0.82rem !important;
  font-weight: 500 !important;
  letter-spacing: 0.01em !important;
  overflow: hidden !important;
  min-height: 28px !important;
  gap: 12px !important;
}
/* Hide the original red "Something went wrong with cluster …" message (the bar's
   first child); we replace it with our calm reconnecting label below. */
.${RECONNECTING_CLASS} > *:first-child {
  display: none !important;
}
.${RECONNECTING_CLASS}::before {
  content: 'Reconnecting to cluster…';
  display: inline-flex;
  align-items: center;
}
/* Keep the "Choose another cluster" action available, but quiet and on-theme. */
.${RECONNECTING_CLASS} .MuiButton-root {
  background-color: rgba(255, 255, 255, 0.12) !important;
  color: #e2e8f0 !important;
  box-shadow: none !important;
  text-transform: none !important;
  font-size: 0.74rem !important;
  font-weight: 500 !important;
  padding: 1px 8px !important;
  min-width: 0 !important;
}
.${RECONNECTING_CLASS} .MuiButton-root:hover {
  background-color: rgba(255, 255, 255, 0.2) !important;
}
/* Indeterminate progress sliver along the bottom edge. */
.${RECONNECTING_CLASS}::after {
  content: '';
  position: absolute;
  bottom: 0;
  height: 2px;
  width: 28%;
  background: linear-gradient(90deg, transparent, #38bdf8, transparent);
  animation: ndk-reconnect-bar 1.1s ease-in-out infinite;
}
@keyframes ndk-reconnect-bar {
  0%   { left: -28%; }
  100% { left: 100%; }
}

/* --- Other core filled-error Alerts -> compact toast ---------------------- */
.MuiAlert-root.MuiAlert-filledError {
  top: 16px !important;
  border-radius: 12px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22) !important;
  max-width: min(92vw, 620px) !important;
  padding: 2px 12px !important;
  align-items: center !important;
  font-size: 0.85rem !important;
  animation: ndk-toast-in 220ms ease-out !important;
}

.MuiAlert-root.MuiAlert-filledError .MuiAlert-icon {
  margin-right: 10px !important;
  padding: 4px 0 !important;
}

.MuiAlert-root.MuiAlert-filledError .MuiAlert-message {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 56vw !important;
}

.MuiAlert-root.MuiAlert-filledError .MuiAlert-action {
  padding-top: 0 !important;
  align-items: center !important;
}

/* Auth/login screen (no usable cluster yet): hide error banners entirely —
   there the dialog already explains the situation, so they are pure noise. */
body:has(#authchooser-dialog-title) .MuiAlert-root.MuiAlert-filledError,
body:has(#authchooser-dialog-title) .${RECONNECTING_CLASS} {
  display: none !important;
}
`;

/**
 * Find Headlamp's "Something went wrong with cluster" popup root, if present.
 * The popup is a <Box> whose only reliable signature is that it contains the
 * "Choose another cluster" action plus the matching message text.
 */
function findClusterErrorBanner(): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>('.MuiButton-root');
  for (const button of Array.from(buttons)) {
    if (!/choose another cluster/i.test(button.textContent || '')) {
      continue;
    }
    const parent = button.parentElement as HTMLElement | null;
    if (parent && /something went wrong with cluster/i.test(parent.textContent || '')) {
      return parent;
    }
  }
  return null;
}

// Banners we have already attached a class-guard observer to.
const guarded = new WeakSet<HTMLElement>();

function ensureClass(banner: HTMLElement): void {
  if (!banner.classList.contains(RECONNECTING_CLASS)) {
    banner.classList.add(RECONNECTING_CLASS);
  }
}

function handleBanner(banner: HTMLElement): void {
  ensureClass(banner);
  if (guarded.has(banner)) {
    return;
  }
  guarded.add(banner);
  // eslint-disable-next-line no-console
  console.info('[NDK] cluster error banner detected → showing calm reconnecting bar');
  // React owns this node's className and may reset it on re-render, dropping our
  // class. Re-apply it whenever the class attribute changes (until unmounted).
  const attrObserver = new MutationObserver(() => {
    if (!banner.isConnected) {
      attrObserver.disconnect();
      return;
    }
    ensureClass(banner);
  });
  attrObserver.observe(banner, { attributes: true, attributeFilter: ['class'] });
}

let scanScheduled = false;
function scheduleScan(): void {
  if (scanScheduled) {
    return;
  }
  scanScheduled = true;
  window.setTimeout(() => {
    scanScheduled = false;
    const banner = findClusterErrorBanner();
    if (banner) {
      handleBanner(banner);
    }
  }, 60);
}

export function applyUiTweaks(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);

  // Version stamp so it is obvious in DevTools which bundle is live (the cluster
  // "Reconnecting…" handler only exists from this build onward).
  // eslint-disable-next-line no-console
  console.info('[NDK] UI tweaks active — cluster reconnect handler v2');

  // Watch for the cluster-error banner mounting/unmounting (it toggles as the
  // connection drops and recovers, including on tab refocus).
  const observer = new MutationObserver(() => scheduleScan());
  const start = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleScan();
    } else {
      window.setTimeout(start, 50);
    }
  };
  start();
}
