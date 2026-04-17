/**
 * uploader.js
 * File selection, step-wise loader overlay, backend fetch, result handoff.
 * Real-time backend health check with failure-tolerance (3-strike system).
 *
 * Health state mapping (only applied when NOT processing):
 *   failCount 0–1  → ONLINE   (single transient failure is ignored)
 *   failCount 2    → CHECKING (backend may be busy)
 *   failCount >= 3 → OFFLINE  (confirmed down)
 *
 * While a parse is in flight (_isProcessing = true):
 *   Status pill is locked to "Processing…" — health results are tracked
 *   internally but never written to the DOM until processing ends.
 */

(() => {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  const API_BASE        = 'http://localhost:8000';
  const API_ENDPOINT    = `${API_BASE}/api/upload`;
  const HEALTH_ENDPOINT = `${API_BASE}/health`;
  const HEALTH_INTERVAL = 8000;   // ms between health pings
  const HEALTH_TIMEOUT  = 3000;   // ms before a health request is abandoned
  const ALLOWED_EXTS    = ['.log', '.txt'];
  const MAX_SIZE_MB     = 50;

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const dropZone      = document.getElementById('drop-zone');
  const fileInput     = document.getElementById('file-input');
  const browseBtn     = document.getElementById('browse-btn');
  const fileInfoCard  = document.getElementById('file-info-card');
  const fileInfoName  = document.getElementById('file-info-name');
  const fileInfoSize  = document.getElementById('file-info-size');
  const fileClearBtn  = document.getElementById('file-clear-btn');
  const parseBtn      = document.getElementById('parse-btn');
  const errorPanel    = document.getElementById('error-panel');
  const errorTitle    = document.getElementById('error-title');
  const errorMsg      = document.getElementById('error-msg');
  const errorRetryBtn = document.getElementById('error-retry-btn');

  const statusPill      = document.getElementById('connection-status');
  const statusLabelText = document.getElementById('status-label-text');

  // ── Pagination DOM refs ───────────────────────────────────────────────────
  const paginationBar    = document.getElementById('pagination-bar');
  const pagePrevBtn      = document.getElementById('page-prev-btn');
  const pageNextBtn      = document.getElementById('page-next-btn');
  const pageIndicator    = document.getElementById('page-indicator');
  const pageTotalLabel   = document.getElementById('page-total-label');

  // ── Pagination state ──────────────────────────────────────────────────────
  //
  // currentPage  — the page currently displayed (1-based)
  // pageSize     — number of rows per page (matches backend default)
  // totalPages   — total number of pages returned by the last response
  //
  // These are reset to defaults whenever a new file is selected (clearFile)
  // so navigating pages always reflects the currently loaded file.

  let currentPage = 1;
  let pageSize    = 100;
  let totalPages  = 1;

  // Loader overlay refs — populated by createLoaderOverlay()
  let loaderOverlay = null;
  let loaderBar     = null;
  let loaderStatus  = null;
  let loaderSubtext = null;
  let loaderSteps   = null;

  let selectedFile    = null;
  let abortController = null;

  // ── Processing flag ───────────────────────────────────────────────────────
  //
  // _isProcessing = true  → a parse request is in flight.
  //   The status pill is locked to "Processing…" regardless of what the
  //   health check returns.  This prevents false "Offline" display while
  //   the backend is busy with VT enrichment (which can take 30–60 s and
  //   causes /health to respond slowly or not at all within HEALTH_TIMEOUT).
  //
  // _isProcessing = false → idle.
  //   The status pill is driven normally by the health check state machine.

  let _isProcessing = false;

  function setProcessing(active) {
    _isProcessing = active;

    if (!statusPill || !statusLabelText) return;

    if (active) {
      statusPill.classList.remove('status--offline', 'status--checking');
      statusPill.classList.add('status--processing');
      statusLabelText.textContent = 'Processing…';
      statusPill.setAttribute('aria-label', 'Backend status: processing request');
    } else {
      statusPill.classList.remove('status--processing');
      _healthState = null;   // force a fresh DOM write on next apply
      applyHealthState(resolveHealthState());
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  window.toastNotify = function (message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast--${type} entering`;
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    container.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, duration);
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Health check ──────────────────────────────────────────────────────────
  //
  // State machine (failCount drives state, not raw success/failure):
  //
  //   failCount 0–1  → 'online'    Single transient failure silently absorbed.
  //   failCount 2    → 'checking'  Backend under load — warn without panicking.
  //   failCount >= 3 → 'offline'   Three consecutive failures: confirmed down.
  //
  // applyHealthState() is a no-op while _isProcessing === true.
  // The counter still advances so we have an accurate picture the moment
  // processing finishes and the lock is released.

  let _failCount   = 0;
  let _healthState = null;   // 'online' | 'checking' | 'offline'

  function resolveHealthState() {
    if (_failCount <= 1) return 'online';
    if (_failCount === 2) return 'checking';
    return 'offline';
  }

  function applyHealthState(state) {
    if (_isProcessing) return;           // locked — processing owns the pill
    if (state === _healthState) return;  // no change — skip DOM write
    _healthState = state;

    if (!statusPill || !statusLabelText) return;

    statusPill.classList.remove('status--offline', 'status--checking');

    if (state === 'online') {
      statusLabelText.textContent = 'Online';
      statusPill.setAttribute('aria-label', 'Backend status: online');
    } else if (state === 'checking') {
      statusPill.classList.add('status--checking');
      statusLabelText.textContent = 'Checking…';
      statusPill.setAttribute('aria-label', 'Backend status: checking');
    } else {
      statusPill.classList.add('status--offline');
      statusLabelText.textContent = 'Offline';
      statusPill.setAttribute('aria-label', 'Backend status: offline');
    }
  }

  async function checkHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);

    let success = false;
    try {
      const res = await fetch(HEALTH_ENDPOINT, {
        method: 'GET',
        signal: controller.signal,
        cache:  'no-store',
      });
      success = res.ok;
    } catch (_) {
      success = false;
    } finally {
      clearTimeout(timer);
    }

    _failCount = success ? 0 : _failCount + 1;
    applyHealthState(resolveHealthState());
  }

  function startHealthCheck() {
    checkHealth();
    setInterval(checkHealth, HEALTH_INTERVAL);
  }

  // ── Loader overlay ────────────────────────────────────────────────────────
  //
  // Seven stages that accurately mirror the full backend pipeline.
  // 'vt' stays active during VirusTotal enrichment (60–90 s) and shows
  // an explanatory subtext.  'finalize' and 'done' fire after fetch resolves.

  const STEP_CONFIG = [
    { key: 'upload',   label: 'Uploading file…',           pct: 10,  subtext: '' },
    { key: 'validate', label: 'Validating file…',          pct: 22,  subtext: '' },
    { key: 'detect',   label: 'Detecting log format…',     pct: 40,  subtext: '' },
    { key: 'parse',    label: 'Parsing logs…',             pct: 60,  subtext: '' },
    {
      key:     'vt',
      label:   'VirusTotal threat check…',
      pct:     82,
      subtext: 'This may take a few minutes for large datasets.',
    },
    { key: 'finalize', label: 'Finalizing results…',       pct: 96,  subtext: '' },
    { key: 'done',     label: 'Completed',                 pct: 100, subtext: '' },
  ];

  const STEP_KEYS = STEP_CONFIG.map(s => s.key);

  const PILL_LABELS = {
    upload:   'Upload',
    validate: 'Analyze',
    detect:   'Regex',
    parse:    'Parse',
    vt:       'VT',
    finalize: 'Finalize',
  };

  function createLoaderOverlay() {
    if (document.getElementById('loader-overlay')) return;

    const contentArea = document.querySelector('.content-area')
                     || document.querySelector('main')
                     || document.body;

    if (getComputedStyle(contentArea).position === 'static') {
      contentArea.style.position = 'relative';
    }

    const pillSteps = STEP_CONFIG
      .filter(s => s.key !== 'done')
      .map((s, i, arr) => {
        const pill = `<span class="lstep" data-step="${s.key}">${PILL_LABELS[s.key]}</span>`;
        return i < arr.length - 1 ? pill + '<span class="lstep-sep">›</span>' : pill;
      })
      .join('');

    const overlay = document.createElement('div');
    overlay.id = 'loader-overlay';
    overlay.setAttribute('hidden', '');
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="loader-box">
        <div class="loader-track">
          <div class="loader-bar" id="overlay-bar"></div>
        </div>
        <p class="loader-status"  id="overlay-status">Initialising…</p>
        <p class="loader-subtext" id="overlay-subtext"></p>
        <div class="loader-steps" id="overlay-steps">${pillSteps}</div>
      </div>
    `;
    contentArea.appendChild(overlay);

    loaderOverlay = overlay;
    loaderBar     = overlay.querySelector('#overlay-bar');
    loaderStatus  = overlay.querySelector('#overlay-status');
    loaderSubtext = overlay.querySelector('#overlay-subtext');
    loaderSteps   = overlay.querySelector('#overlay-steps');
  }

  // ── Loader step control ───────────────────────────────────────────────────
  let _progressTimers = [];

  function clearProgressTimers() {
    _progressTimers.forEach(clearTimeout);
    _progressTimers = [];
  }

  function resetLoader() {
    clearProgressTimers();
    if (!loaderBar) return;
    loaderBar.style.transition  = 'none';
    loaderBar.style.width       = '0%';
    loaderStatus.textContent    = 'Initialising…';
    if (loaderSubtext) {
      loaderSubtext.textContent   = '';
      loaderSubtext.style.display = 'none';
    }
    loaderSteps?.querySelectorAll('.lstep')
      .forEach(el => el.classList.remove('active', 'done'));
    requestAnimationFrame(() => { loaderBar.style.transition = ''; });
  }

  function activateStep(key) {
    const cfg = STEP_CONFIG.find(s => s.key === key);
    if (!cfg || !loaderBar) return;

    loaderStatus.textContent = cfg.label;
    loaderBar.style.width    = Math.min(100, cfg.pct) + '%';

    if (loaderSubtext) {
      if (cfg.subtext) {
        loaderSubtext.textContent   = cfg.subtext;
        loaderSubtext.style.display = 'block';
      } else {
        loaderSubtext.textContent   = '';
        loaderSubtext.style.display = 'none';
      }
    }

    loaderSteps?.querySelectorAll('.lstep').forEach(el => {
      const sIdx = STEP_KEYS.indexOf(el.dataset.step);
      const cIdx = STEP_KEYS.indexOf(key);
      el.classList.remove('active', 'done');
      if (el.dataset.step === key) el.classList.add('active');
      else if (sIdx < cIdx)        el.classList.add('done');
    });
  }

  function showLoaderOverlay() {
    hideContentPanels();
    loaderOverlay.removeAttribute('hidden');
    loaderOverlay.classList.add('animate-in');
  }

  function hideLoaderOverlay() {
    loaderOverlay?.setAttribute('hidden', '');
    loaderOverlay?.classList.remove('animate-in');
  }

  function hideContentPanels() {
    ['empty-state', 'error-panel', 'table-container'].forEach(id => {
      document.getElementById(id)?.setAttribute('hidden', '');
    });
  }

  // ── Pre-fetch stage schedule ───────────────────────────────────────────────
  //
  // upload → validate → detect → parse → vt are all timer-driven so "VT
  // threat check…" appears BEFORE fetch resolves, covering the 60–90 s
  // VT enrichment window while the request is still open.
  //
  // 'finalize' and 'done' fire programmatically after fetch resolves.

  function schedulePreFetchSteps() {
    [
      { key: 'upload',   delay: 0    },
      { key: 'validate', delay: 200  },
      { key: 'detect',   delay: 600  },
      { key: 'parse',    delay: 1200 },
      { key: 'vt',       delay: 2000 },
    ].forEach(({ key, delay }) => {
      _progressTimers.push(setTimeout(() => activateStep(key), delay));
    });
  }

  // ── Button sync ───────────────────────────────────────────────────────────
  function setParseBtn(enabled) {
    parseBtn.disabled = !enabled;
    parseBtn.setAttribute('aria-disabled', String(!enabled));
  }

  // ── File utilities ────────────────────────────────────────────────────────
  function formatBytes(bytes) {
    if (bytes < 1024)    return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(2)} MB`;
  }

  function validateFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      window.toastNotify(`Unsupported type "${ext}". Use .log or .txt`, 'error', 4500);
      return false;
    }
    if (file.size > MAX_SIZE_MB * 1048576) {
      window.toastNotify(`File exceeds ${MAX_SIZE_MB} MB limit`, 'error', 4500);
      return false;
    }
    if (file.size === 0) {
      window.toastNotify('File is empty', 'error', 3500);
      return false;
    }
    return true;
  }

  function setFile(file) {
    if (!file || !validateFile(file)) return;
    selectedFile             = file;
    window._exportFile       = file;   // ✅ FIX 1: store reference for exporter.js
    fileInfoName.textContent = file.name;
    fileInfoSize.textContent = formatBytes(file.size);
    fileInfoCard.removeAttribute('hidden');
    setParseBtn(true);
    window.toastNotify(`Ready: ${file.name}`, 'success', 2500);
  }

  function clearFile() {
    abortController?.abort();
    abortController      = null;
    selectedFile         = null;
    window._exportFile   = null;   // ✅ FIX 1: clear alongside selectedFile
    fileInput.value      = '';
    fileInfoCard.setAttribute('hidden', '');
    setParseBtn(false);
    setProcessing(false);

    // Reset pagination state when file is cleared
    currentPage = 1;
    totalPages  = 1;
    hidePagination();

    // Reset parse toast guard so a new file upload shows the toast again
    window._parseToastShown = false;

    // Hide dashboard button and reset full dataset when file is cleared
    document.getElementById('dashboard-btn')?.setAttribute('hidden', '');
    window._fullParsedData = null;

    document.getElementById('stats-section')?.setAttribute('hidden', '');
    document.getElementById('error-panel')?.setAttribute('hidden', '');

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.setAttribute('aria-disabled', 'true');
    }

    if (typeof window.resetTable === 'function') window.resetTable();
    else showEmptyState();
  }

  function showEmptyState() {
    document.getElementById('empty-state')?.removeAttribute('hidden');
  }

  // ── Pagination helpers ────────────────────────────────────────────────────

  function updatePaginationUI() {
    // Hide pagination when there is only one page or no data
    if (!paginationBar || totalPages <= 1) {
      hidePagination();
      return;
    }

    // Show bar
    paginationBar.removeAttribute('hidden');

    // Page indicator: "Page 2 of 14"
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    }

    // Prev button — disabled on first page
    if (pagePrevBtn) {
      pagePrevBtn.disabled = currentPage <= 1;
      pagePrevBtn.setAttribute('aria-disabled', String(currentPage <= 1));
    }

    // Next button — disabled on last page
    if (pageNextBtn) {
      pageNextBtn.disabled = currentPage >= totalPages;
      pageNextBtn.setAttribute('aria-disabled', String(currentPage >= totalPages));
    }
  }

  function hidePagination() {
    paginationBar?.setAttribute('hidden', '');
  }

  // ── Dashboard helpers ─────────────────────────────────────────────────────

  function showDashboard() {
    const table = document.getElementById('table-container');
    const dashboard = document.getElementById('dashboard-panel');
    table?.setAttribute('hidden', '');
    dashboard?.removeAttribute('hidden');
    // Trigger dashboard render
    if (typeof window.renderDashboard === 'function') {
      window.renderDashboard(window._fullParsedData);
    }
  }

  function hideDashboard() {
    const table = document.getElementById('table-container');
    const dashboard = document.getElementById('dashboard-panel');
    dashboard?.setAttribute('hidden', '');
    table?.removeAttribute('hidden');
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', e => { if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop',      e => { e.preventDefault(); dropZone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) setFile(f); });
  dropZone.addEventListener('click',     e => { if (e.target !== browseBtn) fileInput.click(); });
  dropZone.addEventListener('keydown',   e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  browseBtn.addEventListener('click',    e => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change',   () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  fileClearBtn.addEventListener('click', clearFile);

  errorRetryBtn.addEventListener('click', () => {
    hideLoaderOverlay();
    document.getElementById('error-panel')?.setAttribute('hidden', '');
    showEmptyState();
  });

  parseBtn.addEventListener('click', () => {
    if (selectedFile) {
      // New parse triggered manually — always reset to page 1
      currentPage = 1;
      uploadAndParse(selectedFile);
    }
  });

  // ── Pagination button listeners ───────────────────────────────────────────
  //
  // Both buttons reuse uploadAndParse() with the updated currentPage value.
  // The loader, VT stats, error handling, and stats update all behave
  // identically to a fresh parse — no logic is duplicated.

  if (pagePrevBtn) {
    pagePrevBtn.addEventListener('click', () => {
      if (currentPage <= 1 || !selectedFile) return;
      currentPage--;
      uploadAndParse(selectedFile);
    });
  }

  if (pageNextBtn) {
    pageNextBtn.addEventListener('click', () => {
      if (currentPage >= totalPages || !selectedFile) return;
      currentPage++;
      uploadAndParse(selectedFile);
    });
  }

  // ── Dashboard button listeners ────────────────────────────────────────────

  const dashboardBtn = document.getElementById('dashboard-btn');
  dashboardBtn?.addEventListener('click', () => {
    if (!window._fullParsedData) return;
    showDashboard();
  });

  const dashboardBackBtn = document.getElementById('dashboard-back-btn');
  dashboardBackBtn?.addEventListener('click', () => {
    hideDashboard();
  });

  // ── Core upload ───────────────────────────────────────────────────────────
  async function uploadAndParse(file) {
    abortController?.abort();
    abortController = new AbortController();
    setParseBtn(false);
    setProcessing(true);
    window._parseToastShown = false;

    resetLoader();
    showLoaderOverlay();
    schedulePreFetchSteps();

    const formData = new FormData();
    formData.append('file', file);

    // Include pagination params in the request URL.
    // currentPage and pageSize are module-level state — always reflect
    // the correct page for this call (fresh parse = 1, nav = N).
    const url = `${API_ENDPOINT}?page=${currentPage}&page_size=${pageSize}`;

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body:   formData,
        signal: abortController.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        clearProgressTimers();
        setProcessing(false);
        return;
      }
      clearProgressTimers();
      setProcessing(false);
      handleError(`Cannot reach server at ${API_BASE}. Is the backend running?`);
      return;
    }

    clearProgressTimers();

    if (!response.ok) {
      let detail = `Server error ${response.status}`;
      try {
        const b = await response.json();
        detail = b.detail || b.message || detail;
      } catch (_) {}
      setProcessing(false);
      handleError(detail);
      return;
    }

    activateStep('finalize');

    let data;
    try {
      data = await response.json();
    } catch (_) {
      setProcessing(false);
      handleError('Server returned an invalid response (not JSON).');
      return;
    }

    activateStep('done');
    await sleep(480);

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
      setProcessing(false);
      handleError('No log entries were extracted. The file may use an unrecognised format or all lines were unmatched.');
      return;
    }

    // Store pagination values from response before handing off to handleSuccess.
    // data.page and data.total_pages are provided by the backend when pagination
    // is active. Fall back to defaults so single-page responses still work.
    currentPage = data.page        ?? currentPage;
    totalPages  = data.total_pages ?? 1;

    setProcessing(false);
    handleSuccess(data, file.name);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  function handleSuccess(data, filename) {
    // Store full dataset for dashboard and export — must be first so both
    // features always operate on the complete response regardless of the
    // current pagination page.
    window._fullParsedData = data;

    setParseBtn(true);
    hideLoaderOverlay();

    if (typeof window.renderTable === 'function') {
      window.renderTable(data);
    }

    updateStats(data, filename);

    // Update pagination UI after stats — totalPages is set by this point
    updatePaginationUI();

    // Show dashboard button now that data is available
    document.getElementById('dashboard-btn')?.removeAttribute('hidden');

    requestAnimationFrame(() => {
      document.getElementById('table-container')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const count = (data.matched_lines ?? data.rows?.length ?? 0).toLocaleString();
    if (!window._parseToastShown) {
      window.toastNotify(`Parsed ${count} log entries`, 'success', 3500);
      window._parseToastShown = true;
    }
  }

  // ── Stats update ──────────────────────────────────────────────────────────
  function updateStats(data, filename) {
    document.getElementById('stats-section')?.removeAttribute('hidden');

    setText('stat-total',     data.total_lines     ?? data.rows?.length ?? '—');
    setText('stat-matched',   data.matched_lines   ?? data.rows?.length ?? '—');
    setText('stat-unmatched', data.unmatched_lines ?? 0);
    setText('stat-rate',
      data.match_rate != null ? `${(data.match_rate * 100).toFixed(1)}%` : '—'
    );

    // ── VT stats ──────────────────────────────────────────────────────────
    const vtStats      = data.vt_stats ?? null;
    const vtUniqueCard = document.getElementById('stat-unique-ips')?.closest('.stat-card');
    const vtCallsCard  = document.getElementById('stat-vt-calls')?.closest('.stat-card');

    if (vtStats && typeof vtStats === 'object') {
      const uniqueIps = Number(vtStats.unique_ips);
      const apiCalls  = Number(vtStats.api_calls);

      const elUniqueIps = document.getElementById('stat-unique-ips');
      if (elUniqueIps) {
        elUniqueIps.textContent = Number.isFinite(uniqueIps) ? uniqueIps.toLocaleString() : '—';
      }

      const elVtCalls = document.getElementById('stat-vt-calls');
      if (elVtCalls) {
        elVtCalls.textContent = Number.isFinite(apiCalls) ? apiCalls.toLocaleString() : '—';
      }

      vtUniqueCard?.removeAttribute('hidden');
      vtCallsCard?.removeAttribute('hidden');
    } else {
      vtUniqueCard?.setAttribute('hidden', '');
      vtCallsCard?.setAttribute('hidden', '');
    }
    // ── end VT stats ──────────────────────────────────────────────────────

    // ── Pagination total rows label ───────────────────────────────────────
    // Update page-total-label with total_rows from response if present.
    // Falls back to matched_lines so the label is always populated.
    if (pageTotalLabel) {
      const totalRows = data.total_rows ?? data.matched_lines ?? data.rows?.length ?? 0;
      pageTotalLabel.textContent = `${Number(totalRows).toLocaleString()} total rows`;
    }
    // ── end pagination label ──────────────────────────────────────────────

    const metaTags = document.getElementById('meta-tags');
    if (metaTags) {
      metaTags.innerHTML = '';
      if (data.pattern_name) appendTag(metaTags, data.pattern_name, 'type');
      if (data.log_type)     appendTag(metaTags, data.log_type, 'type');
      if (data.pattern_source === 'ai_generated') appendTag(metaTags, 'AI generated', 'ai');
      else if (data.pattern_source)               appendTag(metaTags, data.pattern_source, 'source');
    }

    // ── Export button ─────────────────────────────────────────────────────
    //
    // exportCSV() re-uploads window._exportFile with page_size=-1 to fetch
    // ALL rows from the backend in one request — pagination is bypassed.
    // The toast is fired inside exporter.js with the real full row count.
    // ─────────────────────────────────────────────────────────────────────
    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.setAttribute('aria-disabled', 'false');

      exportBtn.onclick = () => {
        if (!window._exportFile) {
          window.toastNotify('No file available to export.', 'error', 3500);
          return;
        }
        if (typeof window.exportCSV === 'function') {
          // ✅ FIX 2: pass window._fullParsedData for filename/meta only;
          // exporter.js fetches ALL rows itself via page_size=-1.
          // ✅ FIX 3: toast is fired inside exporter.js — removed from here
          //           to prevent the duplicate toast.
          window.exportCSV(window._fullParsedData, filename);
        }
      };
    }
    // ── end export button ─────────────────────────────────────────────────
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof value === 'number' ? value.toLocaleString() : value;
  }

  function appendTag(container, text, style) {
    const s = document.createElement('span');
    s.className   = `meta-tag meta-tag--${style}`;
    s.textContent = text;
    container.appendChild(s);
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  function handleError(message) {
    clearProgressTimers();
    setProcessing(false);
    hideLoaderOverlay();
    setParseBtn(true);

    errorTitle.textContent = 'Parse failed';
    errorMsg.textContent   = message;

    hideContentPanels();
    errorPanel.removeAttribute('hidden');
    errorPanel.classList.add('animate-in');

    window.toastNotify(message, 'error', 6000);
  }

  // ── Utility ───────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Initialise ────────────────────────────────────────────────────────────
  createLoaderOverlay();
  startHealthCheck();

})();