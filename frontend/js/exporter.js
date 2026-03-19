/**
 * exporter.js
 * Exports the FULL parsed dataset as a downloadable CSV.
 * Operates on backend response rows directly — never on DOM state.
 * RFC 4180 quoting, UTF-8 BOM for Excel auto-detection.
 */

(() => {
  'use strict';

  /**
   * window.exportCSV(data, sourceFilename)
   * @param {Object} data           - Full API response from /api/upload
   * @param {string} sourceFilename - Original uploaded filename
   */
  window.exportCSV = function (data, sourceFilename) {
    // Accept both `columns` (upload endpoint) and `fields` (alternate key)
    const columns = data.columns || data.fields || [];
    const rows    = Array.isArray(data.rows) ? data.rows : [];

    if (columns.length === 0) { notify('No column definitions to export', 'error');   return; }
    if (rows.length === 0)    { notify('No data rows to export',          'warning'); return; }

    try {
      const csv      = buildCSV(columns, rows);
      const filename = buildFilename(data, sourceFilename);
      triggerDownload(csv, filename);
      notify(`Exported ${rows.length.toLocaleString()} rows → ${filename}`, 'success', 3500);
    } catch (err) {
      notify(`Export failed: ${err.message}`, 'error');
      console.error('[exporter]', err);
    }
  };

  // ── CSV builder ──────────────────────────────────────────────────────────────
  function buildCSV(columns, rows) {
    const lines = [ columns.map(quoteField).join(',') ];
    rows.forEach(row => {
      lines.push(
        columns.map(col => quoteField(row[col] != null ? String(row[col]) : '')).join(',')
      );
    });
    // UTF-8 BOM + RFC 4180 CRLF
    return '\uFEFF' + lines.join('\r\n');
  }

  function quoteField(v) {
    const s = String(v);
    return /[,"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // ── Filename ─────────────────────────────────────────────────────────────────
  function buildFilename(data, sourceFilename) {
    const parts = [];
    if (sourceFilename) parts.push(safe(sourceFilename.replace(/\.[^.]+$/, '')));
    else                parts.push('parsed_logs');
    if (data.pattern_id) parts.push(safe(data.pattern_id));
    const now = new Date();
    parts.push([
      now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
      '_', pad(now.getHours()), pad(now.getMinutes()),
    ].join(''));
    return parts.join('_') + '.csv';
  }

  function safe(s) { return s.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_'); }
  function pad(n)  { return String(n).padStart(2, '0'); }

  // ── Download ──────────────────────────────────────────────────────────────────
  function triggerDownload(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function notify(msg, type, dur) {
    window.toastNotify?.(msg, type, dur);
  }

})();