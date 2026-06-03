// Polishes a couple of Headlamp *core* UI bits that a plugin cannot reach
// through the official registration API.
//
// Today this deals with the core cluster-error banner — Headlamp renders it as
// an MUI `<Alert variant="filled" severity="error">` pinned to the top of the
// window whenever the selected cluster's health check fails. By default it is a
// harsh, near-full-width red bar that looks alarming during demos.
//
// Behaviour:
//   - On the cluster auth/login screen (the AuthChooser dialog, "Use A Token"
//     etc.) the banner is HIDDEN entirely. There it is pure noise — the auth
//     dialog already explains the situation and offers "Choose another cluster".
//     We detect that screen with `body:has(#authchooser-dialog-title)`, using
//     the stable id Headlamp sets on the AuthChooser dialog title.
//   - Everywhere else (e.g. a transient outage on a working cluster route) the
//     banner stays, but is reshaped into a compact, rounded, floating toast so
//     it still informs without looking broken.
//
// We target `.MuiAlert-filledError` specifically. This plugin's own alerts use
// the default ("standard") variant, so they are NOT affected. `!important` is
// required to win over MUI/emotion's `sx`-generated classes, which are injected
// late in the stylesheet and would otherwise override us.

const STYLE_ID = 'ndk-plugin-ui-tweaks';

const CSS = `
.MuiAlert-root.MuiAlert-filledError {
  top: 14px !important;
  border-radius: 10px !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28) !important;
  max-width: min(92vw, 720px) !important;
  padding-top: 2px !important;
  padding-bottom: 2px !important;
  align-items: center !important;
}

.MuiAlert-root.MuiAlert-filledError .MuiAlert-message {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  max-width: 60vw !important;
}

.MuiAlert-root.MuiAlert-filledError .MuiAlert-action {
  padding-top: 0 !important;
  align-items: center !important;
}

/* Auth/login screen (no usable cluster): hide the banner entirely. */
body:has(#authchooser-dialog-title) .MuiAlert-root.MuiAlert-filledError {
  display: none !important;
}
`;

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
}
