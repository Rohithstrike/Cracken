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
      // Lock pill to neutral "Processing…" — remove all health state classes
      statusPill.classList.remove('status--offline', 'status--checking');
      statusPill.classList.add('status--processing');
      statusLabelText.textContent = 'Processing…';
      statusPill.setAttribute('aria-label', 'Backend status: processing request');
    } else {
      // Release the lock and immediately repaint with the current health state.
      // Setting _healthState to null forces applyHealthState() to do a fresh
      // DOM write even if the resolved state has not changed since last time.
      statusPill.classList.remove('status--processing');
      _healthState = null;
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
  // IMPORTANT: applyHealthState() is a no-op while _isProcessing === true.
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
    // Never touch the pill while processing — setProcessing() owns it then.
    if (_isProcessing) return;

    if (state === _healthState) return;   // no change — skip DOM write
    _healthState = state;

    if (!statusPill || !statusLabelText) return;

    statusPill.classList.remove('status--offline', 'status--checking');

    switch (state) {
      case 'online':
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

    // applyHealthState is a no-op while _isProcessing=true — safe to always call.
    applyHealthState(resolveHealthState());
  }

  function startHealthCheck() {
    checkHealth();
    setInterval(checkHealth, HEALTH_INTERVAL);
  }

  // ── Loader overlay ────────────────────────────────────────────────────────
  //
  // Seven stages that accurately mirror the full backend pipeline.
  // 'vt' is the critical addition — it stays active during the long-running
  // VirusTotal enrichment and displays an explanatory subtext line.
  //
  // Stage keys and their short pill labels:
  //   upload   → Upload
  //   validate → Validate
  //   detect   → Detect
  //   parse    → Parse
  //   vt       → VT Check
  //   finalize → Finalize
  //   done     → (no pill — completion state only)

  const STEP_CONFIG = [
    {
      key:     'upload',
      label:   'Uploading file…',
      pct:     10,
      subtext: '',
    },
    {
      key:     'validate',
      label:   'Validating file…',
      pct:     22,
      subtext: '',
    },
    {
      key:     'detect',
      label:   'Detecting log format…',
      pct:     40,
      subtext: '',
    },
    {
      key:     'parse',
      label:   'Parsing logs…',
      pct:     60,
      subtext: '',
    },
    {
      key:     'vt',
      label:   'VirusTotal threat check…',
      pct:     82,
      // Subtext shown only on this step to explain the expected delay.
      subtext: 'This may take few minutes for large datasets.',
    },
    {
      key:     'finalize',
      label:   'Finalizing results…',
      pct:     96,
      subtext: '',
    },
    {
      key:     'done',
      label:   'Completed',
      pct:     100,
      subtext: '',
    },
  ];

  const STEP_KEYS = STEP_CONFIG.map(s => s.key);

  // Short labels used in the step pill breadcrumb row (excludes 'done')
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

    // Build step pill HTML from STEP_CONFIG (exclude 'done' — it has no pill)
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

    // Main status text
    loaderStatus.textContent = cfg.label;

    // Progress bar
    loaderBar.style.width = Math.min(100, cfg.pct) + '%';

    // Subtext — only visible on steps that define one (currently only 'vt')
    if (loaderSubtext) {
      if (cfg.subtext) {
        loaderSubtext.textContent   = cfg.subtext;
        loaderSubtext.style.display = 'block';
      } else {
        loaderSubtext.textContent   = '';
        loaderSubtext.style.display = 'none';
      }
    }

    // Step pill states: done (✔) / active (🔄) / pending (○)
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
  // ALL stages up to and including 'vt' are timer-driven so the UI accurately
  // reflects the backend pipeline BEFORE fetch resolves.
  //
  // Timing rationale:
  //   upload   →    0 ms  immediate on click
  //   validate →  200 ms  fast server-side validation
  //   detect   →  600 ms  format detection
  //   parse    → 1200 ms  log parsing
  //   vt       → 2000 ms  ← KEY FIX: VT stage is shown here, well before
  //                          fetch resolves, and remains active for the full
  //                          60–90 s VT enrichment window while fetch is open.
  //
  // 'finalize' and 'done' are NOT scheduled here — they are triggered
  // programmatically from the fetch lifecycle after the response arrives,
  // so they always reflect real completion timing.

  function schedulePreFetchSteps() {
    [
      { key: 'upload',   delay: 0    },
      { key: 'validate', delay: 200  },
      { key: 'detect',   delay: 600  },
      { key: 'parse',    delay: 1200 },
      { key: 'vt',       delay: 2000 },  // ← VT activated before fetch resolves
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
    setProcessing(false);   // release processing lock if clear happens mid-parse

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

    // Lock status pill to "Processing…" before any async work begins.
    // This is the single line that fixes the false-Offline bug — the pill
    // will not change again until setProcessing(false) is called.
    setProcessing(true);

    resetLoader();
    showLoaderOverlay();

    // ── Schedule all pre-fetch stages including VT ─────────────────────────
    //
    // upload → validate → detect → parse → vt are all timer-driven.
    // This ensures "VirusTotal threat check…" appears on screen BEFORE
    // fetch resolves, accurately reflecting the backend's VT enrichment
    // step that runs during the open request window (up to 60–90 s).
    //
    // 'finalize' and 'done' are NOT scheduled here — they fire
    // programmatically once the fetch response is received.
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
      if (err.name === 'AbortError') {
        // User cancelled — release processing lock silently
        clearProgressTimers();
        setProcessing(false);
        return;
      }
      clearProgressTimers();
      setProcessing(false);
      handleError(`Cannot reach server at ${API_BASE}. Is the backend running?`);
      return;
    }

    // ── Server has responded ───────────────────────────────────────────────
    // Cancel any remaining pre-fetch timers (handles the edge case where
    // fetch resolved faster than the vt timer fired — e.g. tiny file, no
    // VT hits, or VT disabled on the backend).
    // Do NOT call activateStep('vt') here — it is already owned by the
    // timer schedule above. Proceed directly to error check or finalize.
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

    // ── Reading JSON body ──────────────────────────────────────────────────
    // Move to 'finalize' while we deserialise the response body.
    activateStep('finalize');

    let data;
    try {
      data = await response.json();
    } catch (_) {
      setProcessing(false);
      handleError('Server returned an invalid response (not JSON).');
      return;
    }

    // ── All data received ──────────────────────────────────────────────────
    activateStep('done');
    await sleep(480);   // brief pause so user can read "✅ Completed"

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
      setProcessing(false);
      handleError('No log entries were extracted. The file may use an unrecognised format or all lines were unmatched.');
      return;
    }

    // Release the processing lock before handing off — pill reverts to
    // whatever the health check state machine last resolved.
    setProcessing(false);
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
    setProcessing(false);   // always release lock on any error path
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