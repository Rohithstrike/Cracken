/**
 * table.js
 * Renders parsed log data into the results table.
 *
 * Dynamic columns: populated from backend `columns` or `fields` key.
 * Preview limit:   first 100 rows rendered in DOM by default.
 * Features:        sticky header, row search, copy-on-click,
 *                  column resize, semantic field colouring.
 *
 * Panel management:
 *   renderTable() → hides #empty-state, shows #table-container
 *   resetTable()  → hides #table-container, shows #empty-state
 *
 * The actual display:none enforcement for [hidden] on flex/grid
 * elements is handled in main.css with high-specificity rules.
 */

(() => {
  'use strict';

  const PREVIEW_ROWS = 100;
  const STATUS_FIELD = 'sc_status';
  const ACTION_FIELD = 'action';

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const tableHead     = document.getElementById('table-head');
  const tableBody     = document.getElementById('table-body');
  const tableInfo     = document.getElementById('table-info');
  const tableSearch   = document.getElementById('table-search');
  const rowCountLabel = document.getElementById('row-count-label');
  const previewNotice = document.getElementById('preview-notice');
  const emptyState    = document.getElementById('empty-state');
  const tableContainer = document.getElementById('table-container');

  let _columns  = [];
  let _allRows  = [];
  let _filtered = [];

  // ── Public: render ──────────────────────────────────────────────────────────
  /**
   * Called by uploader.js after a successful API response.
   * Hides the empty state, shows the table, populates with data.
   */
  window.renderTable = function (data) {
    _columns  = data.columns || data.fields || [];
    _allRows  = Array.isArray(data.rows) ? data.rows : [];
    _filtered = _allRows;

    // Hide empty state — CSS enforces display:none on [hidden]
    // via the high-specificity rule added to main.css
    if (emptyState)     emptyState.setAttribute('hidden', '');
    if (tableContainer) {
      tableContainer.removeAttribute('hidden');
      // Trigger fade-in on next frame so the class is applied
      // after the element is visible
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
  /**
   * Called by uploader.js when the user clears the file.
   * Restores the empty state and clears all table content.
   */
  window.resetTable = function () {
    // Animate out before hiding
    if (tableContainer) {
      tableContainer.classList.remove('animate-in');
      tableContainer.setAttribute('hidden', '');
    }
    if (emptyState) {
      emptyState.removeAttribute('hidden');
      // Small delay so the DOM settles before the fade runs
      requestAnimationFrame(() => emptyState.classList.add('animate-in'));
      // Clean up the class after animation completes
      setTimeout(() => emptyState.classList.remove('animate-in'), 300);
    }

    if (tableHead)     tableHead.innerHTML   = '';
    if (tableBody)     tableBody.innerHTML   = '';
    if (tableSearch)   tableSearch.value     = '';
    if (tableInfo)     tableInfo.textContent = '';
    if (rowCountLabel) rowCountLabel.textContent = '';

    _columns = [];
    _allRows = [];
    _filtered = [];
  };

  // ── Build header ──────────────────────────────────────────────────────────────
  function buildHead(columns) {
    tableHead.innerHTML = '';
    const tr = document.createElement('tr');

    // Row number column
    const thNum = document.createElement('th');
    thNum.className   = 'col-rownum';
    thNum.textContent = '#';
    tr.appendChild(thNum);

    // One <th> per dynamic column from backend response
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

      // Row number cell
      const tdNum = document.createElement('td');
      tdNum.className   = 'col-rownum';
      tdNum.textContent = idx + 1;
      tr.appendChild(tdNum);

      // Data cells — one per dynamic column
      _columns.forEach(col => {
        const td  = document.createElement('td');
        const val = row[col] != null ? String(row[col]) : '';

        td.dataset.field = col;
        td.title         = val;

        colorField(td, col, val);
        td.appendChild(document.createTextNode(val));

        // Copy-on-click hint
        const hint = document.createElement('span');
        hint.className   = 'copy-hint';
        hint.textContent = 'copy';
        hint.addEventListener('click', e => { e.stopPropagation(); copyCell(val, hint); });
        td.appendChild(hint);

        tr.appendChild(td);
      });

      frag.appendChild(tr);
    });

    tableBody.appendChild(frag);
    updateRowCount(rows.length, limit);
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

  // ── Clipboard ─────────────────────────────────────────────────────────────────
  function copyCell(text, hint) {
    navigator.clipboard.writeText(text)
      .then(() => {
        const orig = hint.textContent;
        hint.textContent             = 'copied!';
        hint.style.color             = 'var(--success)';
        hint.style.borderColor       = 'var(--success)';
        setTimeout(() => {
          hint.textContent       = orig;
          hint.style.color       = '';
          hint.style.borderColor = '';
        }, 1500);
        window.toastNotify?.('Copied to clipboard', 'success', 1800);
      })
      .catch(() => window.toastNotify?.('Copy failed', 'error', 2500));
  }

})();