/**
 * table.js
 * Renders parsed log data into the results table.
 *
 * Dynamic columns: populated from backend `columns` or `fields` key.
 * Preview limit:   first 100 rows rendered in DOM by default.
 * Features:        sticky header, row search, column resize,
 *                  semantic field colouring, row-level CSV copy,
 *                  on-demand VirusTotal check for IP / URL cells.
 */

(() => {
  'use strict';

  const PREVIEW_ROWS  = 100;
  const STATUS_FIELD  = 'sc_status';
  const ACTION_FIELD  = 'action';
  const VT_ENDPOINT   = 'http://localhost:8000/api/vt_check';

  // Fields that trigger a VT check when clicked
  const VT_FIELDS = new Set([
    'src_ip', 'dst_ip', 'c_ip', 's_ip',         // common IP field names
    'client_ip', 'server_ip', 'remote_ip',
    'ip', 'ipaddress', 'ip_address',
    'url', 'uri', 'request_url', 'cs_uri_stem',  // common URL field names
    'cs_uri', 'referer', 'cs_referer',
  ]);

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const tableHead      = document.getElementById('table-head');
  const tableBody      = document.getElementById('table-body');
  const tableInfo      = document.getElementById('table-info');
  const tableSearch    = document.getElementById('table-search');
  const rowCountLabel  = document.getElementById('row-count-label');
  const previewNotice  = document.getElementById('preview-notice');
  const emptyState     = document.getElementById('empty-state');
  const tableContainer = document.getElementById('table-container');

  let _columns  = [];
  let _allRows  = [];
  let _filtered = [];

  // ── Public: render ─────────────────────────────────────────────────────────
  window.renderTable = function (data) {
    _columns  = data.columns || data.fields || [];
    _allRows  = Array.isArray(data.rows) ? data.rows : [];
    _filtered = _allRows;

    if (emptyState)     emptyState.setAttribute('hidden', '');
    if (tableContainer) {
      tableContainer.removeAttribute('hidden');
      requestAnimationFrame(() => tableContainer.classList.add('animate-in'));
    }

    if (_columns.length === 0 || _allRows.length === 0) {
      if (tableInfo) {
        tableInfo.textContent = _columns.length === 0
          ? 'No field definitions returned by server'
          : 'No rows in response';
      }
      return;
    }

    buildHead(_columns);
    renderRows(_filtered);
    updateToolbar(data);

    if (tableSearch) {
      tableSearch.value = '';
      tableSearch.removeEventListener('input', onSearch);
      tableSearch.addEventListener('input', onSearch);
    }
  };

  // ── Public: reset ──────────────────────────────────────────────────────────
  window.resetTable = function () {
    if (tableContainer) {
      tableContainer.classList.remove('animate-in');
      tableContainer.setAttribute('hidden', '');
    }
    if (emptyState) {
      emptyState.removeAttribute('hidden');
      requestAnimationFrame(() => emptyState.classList.add('animate-in'));
      setTimeout(() => emptyState.classList.remove('animate-in'), 300);
    }

    if (tableHead)     tableHead.innerHTML       = '';
    if (tableBody)     tableBody.innerHTML       = '';
    if (tableSearch)   tableSearch.value         = '';
    if (tableInfo)     tableInfo.textContent     = '';
    if (rowCountLabel) rowCountLabel.textContent = '';

    _columns  = [];
    _allRows  = [];
    _filtered = [];
  };

  // ── Build header ───────────────────────────────────────────────────────────
  function buildHead(columns) {
    tableHead.innerHTML = '';
    const tr = document.createElement('tr');

    const thNum = document.createElement('th');
    thNum.className   = 'col-rownum';
    thNum.textContent = '#';
    thNum.title       = 'Click a row number to copy that row as CSV';
    tr.appendChild(thNum);

    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.replace(/_/g, ' ');
      th.dataset.col = col;
      th.title       = col;

      // Visual cue that this column is VT-clickable
      if (VT_FIELDS.has(col.toLowerCase())) {
        th.classList.add('col--vt-enabled');
        th.title = `${col} · Click a cell to check on VirusTotal`;
      }

      const handle = document.createElement('div');
      handle.className = 'col-resizer';
      handle.addEventListener('mousedown', e => initResize(th, e));
      th.appendChild(handle);

      tr.appendChild(th);
    });

    tableHead.appendChild(tr);
  }

  // ── Render rows ────────────────────────────────────────────────────────────
  function renderRows(rows) {
    tableBody.innerHTML = '';

    const limit   = Math.min(rows.length, PREVIEW_ROWS);
    const visible = rows.slice(0, limit);
    const frag    = document.createDocumentFragment();

    visible.forEach((row, idx) => {
      const tr = document.createElement('tr');

      tr.appendChild(buildIndexCell(row, idx + 1));

      _columns.forEach(col => {
        const td  = document.createElement('td');
        const val = row[col] != null ? String(row[col]) : '';

        td.dataset.field = col;
        td.title         = val;

        colorField(td, col, val);
        td.appendChild(document.createTextNode(val));

        // Attach VT click handler for qualifying fields with a non-empty value
        if (val && VT_FIELDS.has(col.toLowerCase())) {
          attachVTHandler(td, val);
        }

        tr.appendChild(td);
      });

      frag.appendChild(tr);
    });

    tableBody.appendChild(frag);
    updateRowCount(rows.length, limit);
  }

  // ── Row index cell — row-level copy ───────────────────────────────────────
  function buildIndexCell(row, displayIndex) {
    const td = document.createElement('td');
    td.className    = 'col-rownum';
    td.style.cursor = 'pointer';

    td.appendChild(document.createTextNode(displayIndex));

    const hint = document.createElement('span');
    hint.className   = 'copy-hint';
    hint.textContent = 'copy';
    hint.title       = 'Copy row as CSV';
    hint.addEventListener('click', e => { e.stopPropagation(); copyRowToClipboard(row, hint); });
    td.appendChild(hint);

    td.addEventListener('click', () => copyRowToClipboard(row, hint));
    return td;
  }

  // ── VirusTotal click handler ───────────────────────────────────────────────
  /**
   * Attaches a click listener to an IP or URL cell.
   *
   * State machine per cell:
   *   idle      → click → checking (spinner badge)
   *   checking  → response → verdict badge (Clean / Suspicious / Malicious)
   *   verdict   → click again → re-check (forces fresh API call via ?force=1)
   *
   * The badge is injected directly into the cell so it travels with the cell
   * during virtual re-renders — it is NOT stored in module state.
   */
  function attachVTHandler(td, indicator) {
    td.classList.add('cell--vt-clickable');
    td.title = `${indicator} · Click to check on VirusTotal`;

    td.addEventListener('click', async e => {
      e.stopPropagation();   // prevent row-copy or other td-level handlers

      // If already showing a verdict, allow re-check by removing the badge
      const existing = td.querySelector('.vt-badge');
      const isRecheck = existing && existing.dataset.vtState === 'verdict';
      if (existing) existing.remove();

      // ── Checking state ───────────────────────────────────────────────────
      const badge = createVTBadge('checking', '…');
      td.appendChild(badge);

      let data;
      try {
        const resp = await fetch(VT_ENDPOINT, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            indicator,
            // Pass a hint to bypass cache on deliberate re-check
            ...(isRecheck ? { force: true } : {}),
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }

        data = await resp.json();
      } catch (err) {
        badge.remove();
        createVTBadge('error', 'Error', err.message, td);
        window.toastNotify?.(`VT check failed: ${err.message}`, 'error', 5000);
        return;
      }

      // ── Verdict state ─────────────────────────────────────────────────────
      badge.remove();
      const verdictBadge = createVTBadge(
        statusToVTClass(data.status),
        data.status,
        buildVTTooltip(data),
        td,
      );
      verdictBadge.dataset.vtState = 'verdict';

      // Open VT report on badge click
      verdictBadge.addEventListener('click', e => {
        e.stopPropagation();
        window.open(data.permalink, '_blank', 'noopener,noreferrer');
      });
    });
  }

  /**
   * Creates a VT badge element.
   * If `parent` is supplied the badge is appended immediately.
   */
  function createVTBadge(vtClass, label, tooltip = '', parent = null) {
    const badge = document.createElement('span');
    badge.className        = `vt-badge vt-badge--${vtClass}`;
    badge.textContent      = label;
    badge.title            = tooltip || label;
    badge.setAttribute('aria-label', `VirusTotal: ${label}`);
    if (parent) parent.appendChild(badge);
    return badge;
  }

  function statusToVTClass(status) {
    switch (status) {
      case 'Malicious':  return 'malicious';
      case 'Suspicious': return 'suspicious';
      case 'Clean':      return 'clean';
      default:           return 'unknown';
    }
  }

  function buildVTTooltip(data) {
    const cached = data.cached ? ' (cached)' : '';
    return (
      `VirusTotal: ${data.status}${cached}\n` +
      `Engines flagged: ${data.score}\n` +
      `Checked: ${data.last_checked}\n` +
      `Click to open full report`
    );
  }

  // ── Row CSV serialisation ──────────────────────────────────────────────────
  function rowToCSV(row) {
    return _columns
      .map(col => {
        const val = row[col] != null ? String(row[col]) : '';
        return /[,"\r\n]/.test(val)
          ? '"' + val.replace(/"/g, '""') + '"'
          : val;
      })
      .join(',');
  }

  function copyRowToClipboard(row, hint) {
    const original = hint.textContent;
    navigator.clipboard.writeText(rowToCSV(row))
      .then(() => {
        hint.textContent       = 'copied!';
        hint.style.color       = 'var(--success)';
        hint.style.borderColor = 'var(--success)';
        setTimeout(() => {
          hint.textContent       = original;
          hint.style.color       = '';
          hint.style.borderColor = '';
        }, 1500);
        window.toastNotify?.('Row copied', 'success', 1800);
      })
      .catch(() => {
        window.toastNotify?.('Copy failed — clipboard unavailable', 'error', 2500);
      });
  }

  // ── Semantic field colouring ───────────────────────────────────────────────
  function colorField(td, field, val) {
    if (field === STATUS_FIELD) {
      const code = parseInt(val, 10);
      if (!isNaN(code)) {
        if      (code < 300) td.dataset.status = '2xx';
        else if (code < 400) td.dataset.status = '3xx';
        else if (code < 500) td.dataset.status = '4xx';
        else                 td.dataset.status = '5xx';
      }
    }
    if (field === ACTION_FIELD) td.dataset.val = val;
  }

  // ── Column resize ──────────────────────────────────────────────────────────
  function initResize(th, e) {
    e.preventDefault();
    const startX = e.pageX;
    const startW = th.offsetWidth;
    function onMove(e) {
      const w = Math.max(60, startW + (e.pageX - startX));
      th.style.width = th.style.minWidth = w + 'px';
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Search / filter ────────────────────────────────────────────────────────
  function onSearch(e) {
    const q = e.target.value.trim().toLowerCase();
    _filtered = q
      ? _allRows.filter(row =>
          _columns.some(col =>
            row[col] != null && String(row[col]).toLowerCase().includes(q)
          )
        )
      : _allRows;
    renderRows(_filtered);
    if (tableInfo) {
      tableInfo.textContent = q
        ? `${_filtered.length.toLocaleString()} match${_filtered.length !== 1 ? 'es' : ''} · "${e.target.value}"`
        : buildInfoText(_allRows.length, _columns.length);
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  function updateToolbar(data) {
    const total = data.matched_lines ?? _allRows.length;
    if (tableInfo) tableInfo.textContent = buildInfoText(total, _columns.length);
    if (previewNotice) {
      const isPreview =
        data.preview_only ||
        (typeof data.message === 'string' &&
          data.message.toLowerCase().includes('preview'));
      if (isPreview) previewNotice.removeAttribute('hidden');
      else           previewNotice.setAttribute('hidden', '');
    }
  }

  function buildInfoText(rowCount, colCount) {
    return `${rowCount.toLocaleString()} rows · ${colCount} field${colCount !== 1 ? 's' : ''}`;
  }

  function updateRowCount(total, shown) {
    if (!rowCountLabel) return;
    rowCountLabel.textContent = total > shown
      ? `Showing first ${shown.toLocaleString()} of ${total.toLocaleString()} rows`
      : `${total.toLocaleString()} row${total !== 1 ? 's' : ''}`;
  }

})();