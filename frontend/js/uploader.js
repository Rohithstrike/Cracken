/**
 * uploader.js
 * File selection, step-wise loader overlay, backend fetch, result handoff.
 * Real-time backend health check with failure-tolerance (3-strike system).
 *
 * Health state mapping:
 *   failCount 0–1  → ONLINE   (single transient failure is ignored)
 *   failCount 2    → CHECKING (backend may be busy)
 *   failCount >= 3 → OFFLINE  (confirmed down)
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

  // Loader overlay refs — populated by createLoaderOverlay()
  let loaderOverlay = null;
  let loaderBar     = null;
  let loaderStatus  = null;
  let loaderSteps   = null;

  let selectedFile    = null;
  let abortController = null;

  // ── Toast ────────────────────────────────────────────────────────────────────
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

  // ── Health check ─────────────────────────────────────────────────────────────
  //
  // State machine (failCount drives state, not raw success/failure):
  //
  //   failCount 0–1  → 'online'   Single transient failure is silently absorbed.
  //                                A brief network hiccup or a backend that is
  //                                momentarily busy does not alarm the user.
  //
  //   failCount 2    → 'checking'  Two consecutive failures suggest the backend
  //                                is under load or slow — warn without panicking.
  //
  //   failCount >= 3 → 'offline'   Three consecutive failures confirm the backend
  //                                is unreachable.
  //
  // On every success failCount resets to 0 immediately.

  let _failCount   = 0;      // consecutive failed health requests
  let _healthState = null;   // last applied state: 'online' | 'checking' | 'offline'

  /**
   * Maps the current failCount to the correct UI state string.
   * This is the single source of truth for the state-transition rules.
   */
  function resolveHealthState() {
    if (_failCount <= 1) return 'online';
    if (_failCount === 2) return 'checking';
    return 'offline';
  }

  /**
   * Applies a health state to the status pill.
   * Skips all DOM work if the state has not changed — prevents flicker.
   *
   *   'online'   → green pill,  "Online",     pulse dot active
   *   'checking' → amber pill,  "Checking…",  pulse dot active
   *   'offline'  → red pill,    "Offline",    pulse dot stopped
   */
  function applyHealthState(state) {
    if (state === _healthState) return;   // nothing changed — skip DOM update
    _healthState = state;

    if (!statusPill || !statusLabelText) return;

    // Clear all state modifier classes before applying the new one
    statusPill.classList.remove('status--offline', 'status--checking');

    switch (state) {
      case 'online':
        // Default CSS variables handle the green colour — no extra class needed
        statusLabelText.textContent = 'Online';
        statusPill.setAttribute('aria-label', 'Backend status: online');
        break;

      case 'checking':
        statusPill.classList.add('status--checking');
        statusLabelText.textContent = 'Checking…';
        statusPill.setAttribute('aria-label', 'Backend status: checking');
        break;

      case 'offline':
        statusPill.classList.add('status--offline');
        statusLabelText.textContent = 'Offline';
        statusPill.setAttribute('aria-label', 'Backend status: offline');
        break;
    }
  }

  /**
   * Performs one health ping and updates _failCount accordingly.
   * Calls applyHealthState() with the resolved state after every ping.
   */
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
      // Network error or timeout — treated as failure
      success = false;
    } finally {
      clearTimeout(timer);
    }

    if (success) {
      _failCount = 0;          // reset strike counter on any successful response
    } else {
      _failCount += 1;         // increment strike counter on any failure
    }

    // Resolve and apply the state derived from the current failCount
    applyHealthState(resolveHealthState());
  }

  function startHealthCheck() {
    checkHealth();                            // run immediately on page load
    setInterval(checkHealth, HEALTH_INTERVAL);
  }

  // ── Loader overlay ────────────────────────────────────────────────────────
  function createLoaderOverlay() {
    if (document.getElementById('loader-overlay')) return;

    const contentArea = document.querySelector('.content-area')
                     || document.querySelector('main')
                     || document.body;

    if (getComputedStyle(contentArea).position === 'static') {
      contentArea.style.position = 'relative';
    }

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
        <p class="loader-status" id="overlay-status">Initialising…</p>
        <div class="loader-steps" id="overlay-steps">
          <span class="lstep" data-step="upload">Uploading</span>
          <span class="lstep-sep">›</span>
          <span class="lstep" data-step="analyze">Analyzing</span>
          <span class="lstep-sep">›</span>
          <span class="lstep" data-step="regex">Regex</span>
          <span class="lstep-sep">›</span>
          <span class="lstep" data-step="parse">Parsing</span>
        </div>
      </div>
    `;
    contentArea.appendChild(overlay);

    loaderOverlay = overlay;
    loaderBar     = overlay.querySelector('#overlay-bar');
    loaderStatus  = overlay.querySelector('#overlay-status');
    loaderSteps   = overlay.querySelector('#overlay-steps');
  }

  // ── Loader steps ──────────────────────────────────────────────────────────
  const STEP_CONFIG = [
    { key: 'upload',  label: 'Uploading file…',         pct: 15  },
    { key: 'analyze', label: 'Analyzing log structure…', pct: 42  },
    { key: 'regex',   label: 'Matching regex patterns…', pct: 64  },
    { key: 'parse',   label: 'Structuring log entries…', pct: 86  },
    { key: 'done',    label: 'Done ✓',                   pct: 100 },
  ];
  const STEP_KEYS = STEP_CONFIG.map(s => s.key);

  let _progressTimers = [];

  function clearProgressTimers() {
    _progressTimers.forEach(clearTimeout);
    _progressTimers = [];
  }

  function resetLoader() {
    clearProgressTimers();
    if (!loaderBar) return;
    loaderBar.style.transition = 'none';
    loaderBar.style.width      = '0%';
    loaderStatus.textContent   = 'Initialising…';
    loaderSteps?.querySelectorAll('.lstep').forEach(el =>
      el.classList.remove('active', 'done')
    );
    requestAnimationFrame(() => { loaderBar.style.transition = ''; });
  }

  function activateStep(key) {
    const cfg = STEP_CONFIG.find(s => s.key === key);
    if (!cfg || !loaderBar) return;
    loaderStatus.textContent = cfg.label;
    loaderBar.style.width = Math.min(100, cfg.pct) + '%';
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

  function schedulePreFetchSteps() {
    [
      { key: 'upload',  delay: 0    },
      { key: 'analyze', delay: 900  },
      { key: 'regex',   delay: 1900 },
    ].forEach(({ key, delay }) => {
      _progressTimers.push(setTimeout(() => activateStep(key), delay));
    });
  }

  // ── Button aria-disabled sync ─────────────────────────────────────────────
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
    fileInfoName.textContent = file.name;
    fileInfoSize.textContent = formatBytes(file.size);
    fileInfoCard.removeAttribute('hidden');
    setParseBtn(true);
    window.toastNotify(`Ready: ${file.name}`, 'success', 2500);
  }

  function clearFile() {
    abortController?.abort();
    abortController = null;
    selectedFile    = null;
    fileInput.value = '';
    fileInfoCard.setAttribute('hidden', '');
    setParseBtn(false);

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

  parseBtn.addEventListener('click', () => { if (selectedFile) uploadAndParse(selectedFile); });

  // ── Core upload ───────────────────────────────────────────────────────────
  async function uploadAndParse(file) {
    abortController?.abort();
    abortController = new AbortController();
    setParseBtn(false);

    resetLoader();
    showLoaderOverlay();
    schedulePreFetchSteps();

    const formData = new FormData();
    formData.append('file', file);

    let response;
    try {
      response = await fetch(API_ENDPOINT, {
        method: 'POST',
        body:   formData,
        signal: abortController.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      clearProgressTimers();
      handleError(`Cannot reach server at ${API_BASE}. Is the backend running?`);
      return;
    }

    clearProgressTimers();
    activateStep('parse');

    if (!response.ok) {
      let detail = `Server error ${response.status}`;
      try {
        const b = await response.json();
        detail = b.detail || b.message || detail;
      } catch (_) {}
      handleError(detail);
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      handleError('Server returned an invalid response (not JSON).');
      return;
    }

    activateStep('done');
    await sleep(420);

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
      handleError('No log entries were extracted. The file may use an unrecognised format or all lines were unmatched.');
      return;
    }

    handleSuccess(data, file.name);
  }

  // ── Success ───────────────────────────────────────────────────────────────
  function handleSuccess(data, filename) {
    setParseBtn(true);
    hideLoaderOverlay();

    if (typeof window.renderTable === 'function') {
      window.renderTable(data);
    }

    updateStats(data, filename);

    requestAnimationFrame(() => {
      document.getElementById('table-container')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const count = (data.matched_lines ?? data.rows?.length ?? 0).toLocaleString();
    window.toastNotify(`Parsed ${count} log entries`, 'success', 3500);
  }

  function updateStats(data, filename) {
    document.getElementById('stats-section')?.removeAttribute('hidden');

    setText('stat-total',     data.total_lines     ?? data.rows?.length ?? '—');
    setText('stat-matched',   data.matched_lines   ?? data.rows?.length ?? '—');
    setText('stat-unmatched', data.unmatched_lines ?? 0);
    setText('stat-rate',
      data.match_rate != null ? `${(data.match_rate * 100).toFixed(1)}%` : '—'
    );

    const metaTags = document.getElementById('meta-tags');
    if (metaTags) {
      metaTags.innerHTML = '';
      if (data.pattern_name) appendTag(metaTags, data.pattern_name, 'type');
      if (data.log_type)     appendTag(metaTags, data.log_type, 'type');
      if (data.pattern_source === 'ai_generated') appendTag(metaTags, 'AI generated', 'ai');
      else if (data.pattern_source)               appendTag(metaTags, data.pattern_source, 'source');
    }

    const exportBtn = document.getElementById('export-btn');
    if (exportBtn) {
      exportBtn.disabled = false;
      exportBtn.setAttribute('aria-disabled', 'false');
      exportBtn.onclick = () => {
        if (typeof window.exportCSV === 'function') window.exportCSV(data, filename);
      };
    }
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