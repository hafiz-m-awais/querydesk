// ──────────────────────────────────────────────────────────────────
//  utils.js — Shared utility helpers (loaded by both pages)
// ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
