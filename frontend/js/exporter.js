/**
 * exporter.js
 * Exports the FULL parsed dataset as a downloadable CSV.
 * Fetches ALL rows from the backend using page_size=-1 (no pagination).
 * RFC 4180 quoting, UTF-8 BOM for Excel auto-detection.
 */

(() => {
  'use strict';

  const API_ENDPOINT = 'http://localhost:8000/api/upload';

  /**
   * window.exportCSV(data, sourceFilename)
   * @param {Object} data           - Full API response from /api/upload
   * @param {string} sourceFilename - Original uploaded filename
   */
  window.exportCSV = function (data, sourceFilename) {
    // ── Fetch ALL rows via page_size=-1 ───────────────────────────────────
    // The backend paginates by default (100 rows/page).
    // page_size=-1 is a sentinel that disables pagination entirely and
    // returns all rows in one response — no slicing, no page state needed.
    //
    // We re-upload the original file because the frontend never holds the
    // full dataset in memory — window._fullParsedData only has the current
    // page slice (e.g. 100 of 2245 rows).
    //
    // The stored file reference is window._exportFile, set by uploader.js
    // at parse time so we always have the original File object available.

    const file = window._exportFile;

    if (!file) {
      notify('No file available for export. Please re-upload the file.', 'error', 4000);
      return;
    }

    // Show a loading toast while the fetch is in progress
    notify('Preparing full export…', 'info', 3000);

    const formData = new FormData();
    formData.append('file', file);

    // page_size=-1 tells the backend to skip pagination and return ALL rows
    const url = `${API_ENDPOINT}?page=1&page_size=-1`;

    fetch(url, { method: 'POST', body: formData })
      .then(res => {
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        return res.json();
      })
      .then(fullData => {
        const columns = fullData.columns || fullData.fields || [];
        const rows    = Array.isArray(fullData.rows) ? fullData.rows : [];

        if (columns.length === 0) { notify('No column definitions to export', 'error');   return; }
        if (rows.length === 0)    { notify('No data rows to export',          'warning'); return; }

        try {
          const csv      = buildCSV(columns, rows);
          const filename = buildFilename(data, sourceFilename);  // use original data for filename meta
          triggerDownload(csv, filename);
          // Single toast fired here with accurate full row count
          notify(`Exported ${rows.length.toLocaleString()} rows`, 'success', 3500);
        } catch (err) {
          notify(`Export failed: ${err.message}`, 'error');
          console.error('[exporter]', err);
        }
      })
      .catch(err => {
        notify(`Export failed: ${err.message}`, 'error', 5000);
        console.error('[exporter] fetch error', err);
      });
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