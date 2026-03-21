// ══════════════════════════════════════════════
// VoxScribe — utils.js
// Shared utility functions
// ══════════════════════════════════════════════

// ── Toast ─────────────────────────────────────
export function showToast(msg, duration = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

// ── Duration ──────────────────────────────────
export function formatDuration(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── Exports ───────────────────────────────────

export function exportTxt(entries, sessionName) {
  if (!entries.length) { showToast('Nada que exportar'); return; }
  const lines = [
    `Transcripción: ${sessionName}`,
    `Exportado: ${new Date().toLocaleString('es-DO')}`,
    '─'.repeat(60),
    '',
    ...entries.map(e => `[${e.timestamp}] ${e.speakerName}: ${e.text}`),
  ];
  _download(lines.join('\n'), `${_slug(sessionName)}.txt`, 'text/plain');
  showToast('✓ Exportado como TXT');
}

export function exportJson(entries, sessionName) {
  if (!entries.length) { showToast('Nada que exportar'); return; }
  const data = {
    session: sessionName,
    exportedAt: new Date().toISOString(),
    entries,
  };
  _download(JSON.stringify(data, null, 2), `${_slug(sessionName)}.json`, 'application/json');
  showToast('✓ Exportado como JSON');
}

export function exportPdf(entries, sessionName) {
  if (!entries.length) { showToast('Nada que exportar'); return; }

  // Build a printable HTML page in a new window
  const dark = document.body.dataset.theme === 'dark';
  const bg   = dark ? '#0c0c10' : '#f8f7ff';
  const fg   = dark ? '#f0efff' : '#18172b';
  const muted= dark ? '#9896b8' : '#4a4768';
  const border= dark ? '#2a2a3a' : '#dddaf0';

  const rows = entries.map(e => `
    <tr>
      <td style="color:${muted};font-family:monospace;font-size:12px;white-space:nowrap;padding:8px 12px;border-bottom:1px solid ${border}">[${e.timestamp}]</td>
      <td style="color:${e.speakerColor};font-weight:600;font-size:13px;padding:8px 12px;border-bottom:1px solid ${border};white-space:nowrap">${_esc(e.speakerName)}</td>
      <td style="font-size:14px;padding:8px 12px;border-bottom:1px solid ${border};line-height:1.6">${_esc(e.text)}</td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${_esc(sessionName)}</title>
    <style>
      body { background:${bg}; color:${fg}; font-family:'Segoe UI',system-ui,sans-serif; margin:0; padding:32px; }
      h1   { font-size:22px; margin-bottom:4px; }
      p    { color:${muted}; font-size:13px; margin-bottom:24px; }
      table{ width:100%; border-collapse:collapse; }
      @media print { body { padding:16px; } }
    </style>
  </head><body>
    <h1>${_esc(sessionName)}</h1>
    <p>Exportado: ${new Date().toLocaleString('es-DO')} · ${entries.length} fragmentos</p>
    <table><tbody>${rows}</tbody></table>
    <script>window.onload=()=>window.print();<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
  else showToast('Permite ventanas emergentes para exportar PDF');
}

// ── Helpers ───────────────────────────────────
function _download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'transcripcion';
}

function _esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
