/**
 * table.js
 * Renders parsed log data into the results table.
 *
 * Dynamic columns: populated from backend `columns` or `fields` key.
 * Preview limit:   first 100 rows rendered in DOM by default.
 * Features:        sticky header, row search, copy-on-click,
 *                  column resize, semantic field colouring,
 *                  row-level CSV copy via index cell.
 *
 * Per-cell copy hover has been intentionally removed.
 * Row-level copy (click index cell) is the only copy mechanism.
 */

(() => {
  'use strict';

  const PREVIEW_ROWS = 100;
  const STATUS_FIELD = 'sc_status';
  const ACTION_FIELD = 'action';

  // ── DOM refs ────────────────────────────────────────────────────────────────
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

  // ── Public: render ──────────────────────────────────────────────────────────
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

  // ── Public: reset ────────────────────────────────────────────────────────────
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

  // ── Build header ──────────────────────────────────────────────────────────────
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

      const handle = document.createElement('div');
      handle.className = 'col-resizer';
      handle.addEventListener('mousedown', e => initResize(th, e));
      th.appendChild(handle);

      tr.appendChild(th);
    });

    tableHead.appendChild(tr);
  }

  // ── Render rows ───────────────────────────────────────────────────────────────
  function renderRows(rows) {
    tableBody.innerHTML = '';

    const limit   = Math.min(rows.length, PREVIEW_ROWS);
    const visible = rows.slice(0, limit);
    const frag    = document.createDocumentFragment();

    visible.forEach((row, idx) => {
      const tr = document.createElement('tr');

      // Index cell — clicking copies the full row as CSV
      tr.appendChild(buildIndexCell(row, idx + 1));

      // Data cells — no copy hint, just clean value display
      _columns.forEach(col => {
        const td  = document.createElement('td');
        const val = row[col] != null ? String(row[col]) : '';

        td.dataset.field = col;
        td.title         = val;          // native browser tooltip on long values

        colorField(td, col, val);
        td.appendChild(document.createTextNode(val));

        tr.appendChild(td);
      });

      frag.appendChild(tr);
    });

    tableBody.appendChild(frag);
    updateRowCount(rows.length, limit);
  }

  // ── Row index cell — row-level copy trigger ───────────────────────────────
  //
  // The index cell is the sole copy affordance in the table.
  // It reuses the existing .copy-hint element so hover appearance
  // is driven entirely by the CSS already in main.css — no new rules needed.
  //
  // Hover:  tr:hover .copy-hint rule reveals the label automatically.
  // Click:  anywhere on the cell (or on the hint itself) copies the row.

  function buildIndexCell(row, displayIndex) {
    const td = document.createElement('td');
    td.className = 'col-rownum';
    td.style.cursor = 'pointer';

    // Visible row number
    td.appendChild(document.createTextNode(displayIndex));

    // Reuse .copy-hint — revealed by existing CSS on tr:hover,
    // styled and animated identically to the former per-cell hints.
    const hint = document.createElement('span');
    hint.className   = 'copy-hint';
    hint.textContent = 'copy';
    hint.title       = 'Copy row as CSV';

    hint.addEventListener('click', e => {
      e.stopPropagation();           // prevent td click firing twice
      copyRowToClipboard(row, hint);
    });

    td.appendChild(hint);

    // Clicking anywhere on the cell also triggers the copy
    td.addEventListener('click', () => copyRowToClipboard(row, hint));

    return td;
  }

  // ── Row CSV serialisation ──────────────────────────────────────────────────
  //
  // Produces one CSV line from a row object, preserving column order.
  // RFC 4180: fields with commas, double-quotes, or newlines are quoted;
  // internal double-quotes are escaped as "".

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

  // ── Clipboard: full row ───────────────────────────────────────────────────
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

  // ── Semantic field colouring ──────────────────────────────────────────────────
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
    if (field === ACTION_FIELD) {
      td.dataset.val = val;
    }
  }

  // ── Column resize ─────────────────────────────────────────────────────────────
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

  // ── Search / filter ───────────────────────────────────────────────────────────
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

  // ── Toolbar ───────────────────────────────────────────────────────────────────
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