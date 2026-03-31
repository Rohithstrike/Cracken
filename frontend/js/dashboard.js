/**
 * dashboard.js
 * SOC Log Parser — Enterprise Visualization & Analytics Engine
 *
 * Entry point: window.renderDashboard(data)
 * Consumes:    window._fullParsedData (set by uploader.js)
 *
 * Charts (Chart.js):
<<<<<<< HEAD
 *   - Timeline           (#chart-timeline)    blue   #3b82f6
 *   - Top Source IPs     (#chart-src-ips)     green  #22c55e
 *   - Top Dst Ports/IPs  (#chart-dst-ports)   amber  #f59e0b
 *   - Status Codes       (#chart-status)      red    #ef4444  (optional)
 *   - Protocol Dist.     (#chart-protocol)    purple #8b5cf6  (optional)
 *   - Top Dst IPs        (#chart-dst-ips)     cyan   #06b6d4  (new, optional)
 *   - Src Country        (#chart-src-country) pink   #ec4899  (new, optional)
 *   - Hourly Heatmap     (#chart-heatmap)     indigo #6366f1  (new, optional)
 *   - Action Dist.       (#chart-action)      orange #f97316  (new, optional)
=======
 *   - Timeline        (#chart-timeline)   blue   #3b82f6
 *   - Top Source IPs  (#chart-src-ips)    green  #22c55e
 *   - Top Dst Ports   (#chart-dst-ports)  amber  #f59e0b
 *   - Status Codes    (#chart-status)     red    #ef4444  (optional)
 *   - Protocol Dist.  (#chart-protocol)   purple #8b5cf6  (optional)
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
 *
 * Metrics:
 *   #metric-total · #metric-unique-ips · #metric-top-ip · #metric-peak-time
 *
 * Insights:
 *   #insights-list
 *
 * Performance:
 *   Single-pass data processing with Map counters.
 *   Adaptive timeline granularity based on dataset size.
 *   Safe for 1M+ rows.
 */

(() => {
  'use strict';

  // ── Chart registry — destroyed before each re-render ─────────────────────
  const _charts = {};

  // ── Color palette ─────────────────────────────────────────────────────────
  const COLOR = {
<<<<<<< HEAD
    timeline:   '#3b82f6',
    spike:      '#ef4444',
    ips:        '#22c55e',
    ports:      '#f59e0b',
    status:     '#ef4444',
    protocol:   '#8b5cf6',
    dest:       '#06b6d4',
    country:    '#ec4899',
    heatmap:    '#6366f1',
    action:     '#f97316',
    dstIp:      '#06b6d4',
=======
    timeline: '#3b82f6',
    spike:    '#ef4444',
    ips:      '#22c55e',
    ports:    '#f59e0b',
    status:   '#ef4444',
    protocol: '#8b5cf6',
    dest:     '#06b6d4',
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  };

  // ── Animation duration ────────────────────────────────────────────────────
  const ANIM_DURATION = 800;

  // ── Spike detection threshold multiplier ─────────────────────────────────
<<<<<<< HEAD
  const SPIKE_SIGMA = 2.5;

  // ─────────────────────────────────────────────────────────────────────────
  // CHART EXPORT UTILITY
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * exportChart(chartKey, filename)
   *
   * Exports both CSV (label/count data) and PNG (chart image) for the
   * Chart.js instance stored under _charts[chartKey].
   * Safe no-op if chart does not exist.
   */
  function exportChart(chartKey, filename) {
    const chart = _charts[chartKey];
    if (!chart) return;

    try {
      // ── CSV export ──────────────────────────────────────────────────────
      const labels  = chart.data.labels  || [];
      const dataset = chart.data.datasets[0];
      const values  = dataset ? (dataset.data || []) : [];

      let csv = 'Label,Count\n';
      labels.forEach((label, i) => {
        const safe = String(label).includes(',') ? `"${label}"` : label;
        csv += `${safe},${values[i] ?? 0}\n`;
      });

      const csvBlob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const csvUrl  = URL.createObjectURL(csvBlob);
      const csvLink = document.createElement('a');
      csvLink.href     = csvUrl;
      csvLink.download = filename + '.csv';
      csvLink.style.display = 'none';
      document.body.appendChild(csvLink);
      csvLink.click();
      document.body.removeChild(csvLink);
      setTimeout(() => URL.revokeObjectURL(csvUrl), 10000);

      // ── PNG export ──────────────────────────────────────────────────────
      const imgData = chart.toBase64Image();
      const pngLink = document.createElement('a');
      pngLink.href     = imgData;
      pngLink.download = filename + '.png';
      pngLink.style.display = 'none';
      document.body.appendChild(pngLink);
      pngLink.click();
      document.body.removeChild(pngLink);
    } catch (err) {
      console.error('[dashboard] exportChart error:', err);
    }
  }

  /**
   * addExportButton(cardSelector, chartKey, filename)
   *
   * Injects a compact "Export" button into the top-right of a chart card
   * header. Uses existing .btn .btn-ghost classes for style consistency.
   * Idempotent — will not add a second button if called again.
   */
  function addExportButton(cardSelector, chartKey, filename) {
    const card = document.querySelector(cardSelector);
    if (!card) return;

    // Idempotency guard
    if (card.querySelector('.dash-chart-export-btn')) return;

    const header = card.querySelector('.dash-chart-header');
    if (!header) return;

    const btn = document.createElement('button');
    btn.className   = 'btn btn-ghost dash-chart-export-btn';
    btn.type        = 'button';
    btn.title       = 'Export CSV + PNG';
    btn.setAttribute('aria-label', `Export ${filename} as CSV and PNG`);
    btn.innerHTML   = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M6 1v6M6 7L3.5 4.5M6 7L8.5 4.5" stroke="currentColor" stroke-width="1.4"
              stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M1 9.5v1C1 11 1.45 11.5 2 11.5h8c.55 0 1-.5 1-1v-1"
              stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      Export
    `;
    btn.style.cssText = [
      'margin-left:auto',
      'padding:2px 8px',
      'font-size:10px',
      'height:24px',
      'flex-shrink:0',
      'width:auto',
      'gap:4px',
    ].join(';');

    btn.addEventListener('click', () => exportChart(chartKey, filename));

    // Insert at the end of the header so it sits top-right
    header.style.display     = header.style.display || 'flex';
    header.style.alignItems  = 'center';
    header.appendChild(btn);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEW CHART CARD INJECTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * ensureChartCard(id, title, subtitle)
   *
   * Creates and appends a .dash-chart-card to #dash-charts-grid if a card
   * with the given id does not already exist. Returns the canvas element.
   * Safe to call multiple times — idempotent.
   */
  function ensureChartCard(id, title, subtitle) {
    const grid = document.getElementById('dash-charts-grid');
    if (!grid) return null;

    let card = document.getElementById(id);
    if (card) {
      return card.querySelector('canvas');
    }

    card = document.createElement('div');
    card.className = 'dash-chart-card';
    card.id        = id;

    const canvasId = 'chart-' + id.replace('dash-chart-', '');

    card.innerHTML = `
      <div class="dash-chart-header">
        <span class="dash-chart-title">${title}</span>
        <span class="dash-chart-sub">${subtitle || ''}</span>
      </div>
      <div class="dash-chart-body">
        <canvas id="${canvasId}" role="img" aria-label="${title}"></canvas>
      </div>
    `;

    grid.appendChild(card);
    return card.querySelector('canvas');
  }

  // ─────────────────────────────────────────────────────────────────────────
=======
  // A bucket is a spike if its count exceeds mean + (SPIKE_SIGMA * stddev)
  const SPIKE_SIGMA = 2.5;

  // ─────────────────────────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  // PUBLIC ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────

  window.renderDashboard = function (data) {
<<<<<<< HEAD
=======
    // 1. Validate
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      console.warn('[dashboard] renderDashboard: no rows to visualise.');
      return;
    }

<<<<<<< HEAD
    showDashboardLoader();

    requestAnimationFrame(() => {
      try {
        const stats = processData(data.rows);
        renderMetrics(stats);
        renderCharts(stats);
=======
    // 2. Show loader
    showDashboardLoader();

    // Defer heavy work one frame so loader paints before processing
    requestAnimationFrame(() => {
      try {
        // 3. Process (single pass)
        const stats = processData(data.rows);

        // 4. Metrics
        renderMetrics(stats);

        // 5. Charts
        renderCharts(stats);

        // 6. Insights
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
        renderInsights(stats);
      } catch (err) {
        console.error('[dashboard] render error:', err);
      } finally {
<<<<<<< HEAD
=======
        // 7. Hide loader (always, even on error)
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
        hideDashboardLoader();
      }
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  // LOADER HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  function showDashboardLoader() {
    document.getElementById('dashboard-loader')?.removeAttribute('hidden');
    document.getElementById('dashboard-content')?.setAttribute('hidden', '');
  }

  function hideDashboardLoader() {
    document.getElementById('dashboard-loader')?.setAttribute('hidden', '');
    document.getElementById('dashboard-content')?.removeAttribute('hidden');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DATA PROCESSING  (single pass — safe for 1M+ rows)
  // ─────────────────────────────────────────────────────────────────────────

<<<<<<< HEAD
  function processData(rows) {
    const n = rows.length;

    const granularity = n < 10000 ? 'minute' : n < 100000 ? '5min' : 'hour';

    const timelineBuckets  = new Map();
    const srcIpCounts      = new Map();
    const dstIpCounts      = new Map();
    const dstPortCounts    = new Map();
    const statusCounts     = new Map();
    const protocolCounts   = new Map();
    const uniqueIps        = new Set();
    // NEW
    const srcCountryCounts = new Map();
    const hourlyBuckets    = new Map();   // hour 0–23 activity
    const actionCounts     = new Map();

    let hasTimestamp   = false;
    let hasStatus      = false;
    let hasProtocol    = false;
    let hasDstIp       = false;
    let hasSrcCountry  = false;
    let hasAction      = false;
=======
  /**
   * processData(rows) → stats object
   *
   * Single pass collecting:
   *   - timeline buckets      (adaptive granularity by row count)
   *   - src IP counts         (Map<ip, count>)
   *   - dst IP counts         (Map<ip, count>)
   *   - dst port counts       (Map<port, count>)
   *   - status counts         (Map<status, count>)
   *   - protocol counts       (Map<proto, count>)
   *   - unique IPs            (Set<ip>)
   *   - repeated patterns     (IPs with very high repeat rates)
   *
   * Post-pass:
   *   - spike detection       (z-score on timeline buckets)
   */
  function processData(rows) {
    const n = rows.length;

    // ── Adaptive granularity ──────────────────────────────────────────────
    // <10k   → per minute  (bucket to 'YYYY-MM-DD HH:MM')
    // <100k  → per 5 min   (round minutes to nearest 5)
    // >=100k → per hour    (bucket to 'YYYY-MM-DD HH')
    const granularity = n < 10000 ? 'minute' : n < 100000 ? '5min' : 'hour';

    const timelineBuckets = new Map();
    const srcIpCounts     = new Map();
    const dstIpCounts     = new Map();
    const dstPortCounts   = new Map();
    const statusCounts    = new Map();
    const protocolCounts  = new Map();
    const uniqueIps       = new Set();

    let hasTimestamp = false;
    let hasStatus    = false;
    let hasProtocol  = false;
    let hasDstIp     = false;
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d

    for (let i = 0; i < n; i++) {
      const row = rows[i];

      // ── Timestamp ────────────────────────────────────────────────────────
      const rawTs = row.timestamp ?? row.date ?? row.time ?? row.datetime ?? null;
      if (rawTs) {
        const bucket = parseBucket(rawTs, granularity);
        if (bucket) {
          hasTimestamp = true;
          timelineBuckets.set(bucket, (timelineBuckets.get(bucket) ?? 0) + 1);
        }
<<<<<<< HEAD
        // Hourly heatmap bucket (0–23)
        const hourBucket = parseHourBucket(rawTs);
        if (hourBucket !== null) {
          hourlyBuckets.set(hourBucket, (hourlyBuckets.get(hourBucket) ?? 0) + 1);
        }
=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      }

      // ── Source IP ────────────────────────────────────────────────────────
      const srcIp = row.src_ip ?? row.c_ip ?? row.client_ip ?? row.source_ip ?? null;
      if (srcIp && isValidIpLike(srcIp)) {
        uniqueIps.add(srcIp);
        srcIpCounts.set(srcIp, (srcIpCounts.get(srcIp) ?? 0) + 1);
      }

      // ── Destination IP ────────────────────────────────────────────────────
      const dstIp = row.dst_ip ?? row.destination_ip ?? row.s_ip ?? row.server_ip ?? null;
      if (dstIp && isValidIpLike(dstIp)) {
        hasDstIp = true;
        dstIpCounts.set(dstIp, (dstIpCounts.get(dstIp) ?? 0) + 1);
      }

      // ── Destination port ─────────────────────────────────────────────────
      const dstPort = row.dst_port ?? row.destination_port ?? row.s_port ?? row.dstport ?? null;
      if (dstPort != null && dstPort !== '' && dstPort !== '-') {
        const portStr = String(dstPort);
        dstPortCounts.set(portStr, (dstPortCounts.get(portStr) ?? 0) + 1);
      }

      // ── Status ───────────────────────────────────────────────────────────
      const status = row.sc_status ?? row.status ?? row.status_code ?? row.level ?? null;
      if (status != null && status !== '' && status !== '-') {
        hasStatus = true;
        statusCounts.set(String(status), (statusCounts.get(String(status)) ?? 0) + 1);
      }

      // ── Protocol ─────────────────────────────────────────────────────────
      const proto = row.protocol ?? row.proto ?? null;
      if (proto && proto !== '-') {
        hasProtocol = true;
        const protoStr = String(proto).toUpperCase();
        protocolCounts.set(protoStr, (protocolCounts.get(protoStr) ?? 0) + 1);
      }
<<<<<<< HEAD

      // ── Source Country (NEW) ─────────────────────────────────────────────
      const country = row.src_country ?? row.srccountry ?? row.country ?? row.geo_country ?? null;
      if (country && country !== '-' && country !== 'N/A' && country !== 'n/a') {
        hasSrcCountry = true;
        const cStr = String(country).trim();
        srcCountryCounts.set(cStr, (srcCountryCounts.get(cStr) ?? 0) + 1);
      }

      // ── Action / Event Type (NEW) ─────────────────────────────────────────
      const action = row.action ?? row.event_type ?? row.eventtype ?? row.type ?? null;
      if (action && action !== '-' && action !== 'N/A') {
        hasAction = true;
        const aStr = String(action).trim();
        actionCounts.set(aStr, (actionCounts.get(aStr) ?? 0) + 1);
      }
=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    }

    // ── Sort timeline chronologically ─────────────────────────────────────
    const sortedTimeline = [...timelineBuckets.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    );

<<<<<<< HEAD
    // ── Hourly heatmap — fill all 24 hours including zeros ────────────────
    const sortedHourly = Array.from({ length: 24 }, (_, h) => [
      String(h).padStart(2, '0') + ':00',
      hourlyBuckets.get(h) ?? 0,
    ]);

=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    // ── Top lists ─────────────────────────────────────────────────────────
    const top10Ips = [...srcIpCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10);

    const top10DstIps = [...dstIpCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10);

    const top10Ports = [...dstPortCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10);

<<<<<<< HEAD
    const top15Countries = [...srcCountryCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 15);

    const top10Actions = [...actionCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10);

=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    // ── Peak bucket ───────────────────────────────────────────────────────
    let peakBucket = null;
    let peakCount  = 0;
    for (const [bucket, count] of timelineBuckets) {
      if (count > peakCount) { peakCount = count; peakBucket = bucket; }
    }

    // ── Spike detection ───────────────────────────────────────────────────
    const spikeIndices = detectSpikes(sortedTimeline);

    // ── Top IP / port ─────────────────────────────────────────────────────
    const topIp        = top10Ips.length > 0   ? top10Ips[0][0]   : null;
    const topIpCount   = top10Ips.length > 0   ? top10Ips[0][1]   : 0;
    const topPort      = top10Ports.length > 0 ? top10Ports[0][0] : null;
    const topPortCount = top10Ports.length > 0 ? top10Ports[0][1] : 0;

    // ── Repeated pattern detection ────────────────────────────────────────
<<<<<<< HEAD
    const repeatedAttackers = top10Ips.filter(([, c]) => c / n > 0.15);
    const dominantIp        = repeatedAttackers.length > 0 ? repeatedAttackers[0] : null;

    const top3Share = top10Ips.slice(0, 3).reduce((sum, [, c]) => sum + c, 0);
    const top3Pct   = n > 0 ? Math.round((top3Share / n) * 100) : 0;

=======
    // Flag IPs where single IP contributes >15% of total traffic
    const repeatedAttackers = top10Ips.filter(([, c]) => c / n > 0.15);
    const dominantIp        = repeatedAttackers.length > 0 ? repeatedAttackers[0] : null;

    // Top 3 IPs combined share
    const top3Share = top10Ips.slice(0, 3).reduce((sum, [, c]) => sum + c, 0);
    const top3Pct   = n > 0 ? Math.round((top3Share / n) * 100) : 0;

    // Quiet periods — find the longest gap between events (if timeline exists)
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const quietPeriod = findQuietPeriod(sortedTimeline);

    return {
      totalEvents:      n,
      granularity,
      uniqueIpCount:    uniqueIps.size,
      topIp,
      topIpCount,
      topPort,
      topPortCount,
      peakBucket,
      peakCount,
      hasTimestamp,
      hasStatus,
      hasProtocol,
      hasDstIp,
<<<<<<< HEAD
      hasSrcCountry,
      hasAction,
      sortedTimeline,
      sortedHourly,
=======
      sortedTimeline,
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      spikeIndices,
      top10Ips,
      top10DstIps,
      top10Ports,
<<<<<<< HEAD
      top15Countries,
      top10Actions,
=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      statusCounts,
      protocolCounts,
      dominantIp,
      top3Pct,
      quietPeriod,
      repeatedAttackers,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SPIKE DETECTION
  // ─────────────────────────────────────────────────────────────────────────

<<<<<<< HEAD
=======
  /**
   * detectSpikes(sortedTimeline) → Set<index>
   *
   * Uses z-score (standard deviation) to flag buckets significantly
   * above the mean. Returns a Set of array indices that are spikes.
   * Requires at least 4 buckets to produce meaningful statistics.
   */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function detectSpikes(sortedTimeline) {
    const spikes = new Set();
    if (sortedTimeline.length < 4) return spikes;

    const values = sortedTimeline.map(([, v]) => v);
    const mean   = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stddev = Math.sqrt(variance);

    if (stddev === 0) return spikes;

    const threshold = mean + SPIKE_SIGMA * stddev;
    values.forEach((v, i) => { if (v > threshold) spikes.add(i); });

    return spikes;
  }

<<<<<<< HEAD
  function findQuietPeriod(sortedTimeline) {
    if (sortedTimeline.length < 3) return null;
    const minCount  = sortedTimeline.reduce((m, [, v]) => Math.min(m, v), Infinity);
=======
  /**
   * findQuietPeriod(sortedTimeline) → string | null
   *
   * Finds the longest consecutive run of zero-activity buckets.
   * Returns a human-readable label or null if timeline is too short.
   */
  function findQuietPeriod(sortedTimeline) {
    if (sortedTimeline.length < 3) return null;

    // Build a set of all bucket keys present
    const keys      = sortedTimeline.map(([k]) => k);
    const minCount  = sortedTimeline.reduce((m, [, v]) => Math.min(m, v), Infinity);

    // Find bucket with lowest activity
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const quietEntry = sortedTimeline.find(([, v]) => v === minCount);
    return quietEntry ? quietEntry[0] : null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────────────────────────────────

  function renderMetrics(stats) {
    setText('metric-total',      stats.totalEvents.toLocaleString());
    setText('metric-unique-ips', stats.uniqueIpCount.toLocaleString());
    setText('metric-top-ip',     stats.topIp ?? '—');
    setText('metric-peak-time',  stats.peakBucket ?? '—');
  }

  // ─────────────────────────────────────────────────────────────────────────
<<<<<<< HEAD
  // CHARTS — orchestrator
  // ─────────────────────────────────────────────────────────────────────────

  function renderCharts(stats) {
    // ── Existing charts (unchanged) ───────────────────────────────────────
=======
  // CHARTS
  // ─────────────────────────────────────────────────────────────────────────

  function renderCharts(stats) {
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    renderTimelineChart(stats);
    renderSrcIpChart(stats);
    renderDestinationChart(stats);
    if (stats.hasStatus)   renderStatusChart(stats);
    if (stats.hasProtocol) renderProtocolChart(stats);
<<<<<<< HEAD

    // ── New charts (conditional rendering) ───────────────────────────────
    if (stats.hasDstIp && stats.top10DstIps.length > 0) renderDstIpChart(stats);
    if (stats.hasSrcCountry && stats.top15Countries.length > 0) renderCountryChart(stats);
    if (stats.hasTimestamp) renderHeatmapChart(stats);
    if (stats.hasAction && stats.top10Actions.length > 0) renderActionChart(stats);

    // ── Attach export buttons AFTER charts are rendered ───────────────────
    // Export buttons are attached here (post-render) so _charts[key] exists.
    // addExportButton is idempotent — safe to call on re-render.
    setTimeout(() => {
      addExportButton('#dash-chart-timeline',  'timeline',  'soc_timeline');
      addExportButton('#dash-chart-src-ips',   'src-ips',   'soc_top_src_ips');
      addExportButton('#dash-chart-dst-ports', 'dst-ports', 'soc_destination');
      addExportButton('#dash-chart-status',    'status',    'soc_status_codes');
      addExportButton('#dash-chart-protocol',  'protocol',  'soc_protocols');
      addExportButton('#dash-chart-dst-ips',   'dst-ips',   'soc_top_dst_ips');
      addExportButton('#dash-chart-country',   'country',   'soc_src_countries');
      addExportButton('#dash-chart-heatmap',   'heatmap',   'soc_hourly_activity');
      addExportButton('#dash-chart-action',    'action',    'soc_action_types');
    }, 0);
=======
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  }

  // ── Timeline (with spike highlighting) ───────────────────────────────────
  function renderTimelineChart(stats) {
    const canvas = document.getElementById('chart-timeline');
    if (!canvas) return;

    destroyChart('timeline');
    resetCanvas(canvas);

    if (!stats.hasTimestamp || stats.sortedTimeline.length === 0) {
      showChartEmpty(canvas, 'No timestamp data available');
      return;
    }

<<<<<<< HEAD
    const labels = stats.sortedTimeline.map(([k]) => k);
    const values = stats.sortedTimeline.map(([, v]) => v);

=======
    const labels     = stats.sortedTimeline.map(([k]) => k);
    const values     = stats.sortedTimeline.map(([, v]) => v);

    // Point colours — spikes in red, normal in blue
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const pointColors = values.map((_, i) =>
      stats.spikeIndices.has(i) ? COLOR.spike : COLOR.timeline
    );
    const pointRadii = values.map((v, i) =>
      stats.spikeIndices.has(i) ? 5 : (labels.length > 200 ? 0 : 2)
    );

<<<<<<< HEAD
=======
    // Spike annotation segments — color spike region background
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const spikeSegmentPlugin = {
      id: 'spikeBackground',
      beforeDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        if (!chartArea) return;
        ctx.save();
        stats.spikeIndices.forEach(i => {
          const x     = scales.x.getPixelForValue(i);
          const width = scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0);
          ctx.fillStyle = 'rgba(239,68,68,0.08)';
          ctx.fillRect(x - width / 2, chartArea.top, width, chartArea.bottom - chartArea.top);
        });
        ctx.restore();
      },
    };

    const granLabel = { minute: 'per minute', '5min': 'per 5 min', hour: 'per hour' }[stats.granularity] ?? '';

    _charts['timeline'] = new Chart(canvas, {
      type: 'line',
      plugins: [spikeSegmentPlugin],
      data: {
        labels,
        datasets: [{
<<<<<<< HEAD
          label:                `Events (${granLabel})`,
          data:                 values,
          borderColor:          COLOR.timeline,
          backgroundColor:      hexAlpha(COLOR.timeline, 0.12),
          borderWidth:          1.8,
          pointRadius:          pointRadii,
          pointBackgroundColor: pointColors,
          pointBorderColor:     pointColors,
          fill:                 true,
          tension:              0.35,
=======
          label:           `Events (${granLabel})`,
          data:            values,
          borderColor:     COLOR.timeline,
          backgroundColor: hexAlpha(COLOR.timeline, 0.12),
          borderWidth:     1.8,
          pointRadius:     pointRadii,
          pointBackgroundColor: pointColors,
          pointBorderColor:     pointColors,
          fill:            true,
          tension:         0.35,
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
        }],
      },
      options: {
        animation:   { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive:  true,
        maintainAspectRatio: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              title: items => items[0].label,
              label: item => {
                const isSpike = stats.spikeIndices.has(item.dataIndex);
                return ` ${item.formattedValue} events${isSpike ? '  ⚠ spike' : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 14, color: '#64748b', maxRotation: 40, font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  }

  // ── Top Source IPs ─────────────────────────────────────────────────────────
  function renderSrcIpChart(stats) {
    const canvas = document.getElementById('chart-src-ips');
    if (!canvas) return;

    destroyChart('src-ips');
    resetCanvas(canvas);

    if (stats.top10Ips.length === 0) {
      showChartEmpty(canvas, 'No source IP data available');
      return;
    }

    const labels  = stats.top10Ips.map(([ip]) => ip);
    const values  = stats.top10Ips.map(([, n]) => n);
    const maxVal  = values[0] ?? 1;

<<<<<<< HEAD
    // High-frequency badge injection (top 3 IPs if they dominate)
    const headerEl = document.querySelector('#dash-chart-src-ips .dash-chart-header');
    if (headerEl && !headerEl.querySelector('.dash-high-freq-badge')) {
      const topShare = values.slice(0, 3).reduce((s, v) => s + v, 0);
      if (stats.totalEvents > 0 && (topShare / stats.totalEvents) > 0.4) {
        const badge = document.createElement('span');
        badge.className = 'dash-high-freq-badge';
        badge.textContent = '⚠ HIGH TRAFFIC';
        badge.style.cssText = [
          'font-size:9px',
          'font-weight:700',
          'color:#ef4444',
          'background:rgba(239,68,68,0.12)',
          'border:1px solid rgba(239,68,68,0.30)',
          'border-radius:4px',
          'padding:2px 6px',
          'letter-spacing:0.5px',
          'margin-left:8px',
          'white-space:nowrap',
        ].join(';');
        const titleEl = headerEl.querySelector('.dash-chart-title');
        if (titleEl) titleEl.after(badge);
      }
    }

=======
    // Dominant attacker gets a brighter color
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const bgColors = values.map((v, i) =>
      i === 0 ? hexAlpha(COLOR.ips, 0.90) : hexAlpha(COLOR.ips, 0.45 + (v / maxVal) * 0.35)
    );
    const borderColors = values.map((_, i) =>
      i === 0 ? COLOR.ips : hexAlpha(COLOR.ips, 0.55)
    );

    _charts['src-ips'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          backgroundColor: bgColors,
          borderColor:     borderColors,
          borderWidth:     1,
          borderRadius:    3,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive: true,
        maintainAspectRatio: true,
        indexAxis:  'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const pct = stats.totalEvents > 0
                  ? ((item.raw / stats.totalEvents) * 100).toFixed(1)
                  : '0';
                return ` ${item.formattedValue} events (${pct}% of total)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono, monospace', size: 10 },
            },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ── Destination Analysis (IP or Port fallback) ────────────────────────────
  function renderDestinationChart(stats) {
    const canvas = document.getElementById('chart-dst-ports');
    if (!canvas) return;

    destroyChart('dst-ports');
    resetCanvas(canvas);

<<<<<<< HEAD
    const useDstIp = stats.hasDstIp && stats.top10DstIps.length > 0;
    const usePort  = !useDstIp && stats.top10Ports.length > 0;
=======
    // Prefer dst IP if available, otherwise fall back to dst port
    const useDstIp  = stats.hasDstIp && stats.top10DstIps.length > 0;
    const usePort   = !useDstIp && stats.top10Ports.length > 0;
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d

    if (!useDstIp && !usePort) {
      showChartEmpty(canvas, 'No destination data available');
      return;
    }

    const entries = useDstIp ? stats.top10DstIps : stats.top10Ports;
    const values  = entries.map(([, v]) => v);

<<<<<<< HEAD
    // Smart title detection
=======
    // ── Smart title detection (NEW — surgical addition only) ─────────────
    //
    // When falling back to dst_port values, the field may actually contain
    // IP addresses (e.g. VPN logs where s_port maps to a remote IP string).
    // Detect this at runtime and update the chart card title accordingly
    // so the UI always reflects what the data actually contains.
    //
    // isLikelyIP: a value is treated as IP-like if it is a string containing
    // a dot — this safely covers IPv4 ("1.2.3.4") and avoids false positives
    // on plain integer port strings ("443", "8080").

>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    function isLikelyIP(value) {
      return typeof value === 'string' && value.includes('.');
    }

    if (!useDstIp) {
<<<<<<< HEAD
      const portValues  = entries.map(([k]) => k);
      const isIPDataset = portValues.some(v => isLikelyIP(v));
=======
      // Only run detection when using the dst_port fallback path.
      // When useDstIp is true the title is always "Top Destination IPs"
      // (already set in the HTML card), so no update is needed there.
      const portValues = entries.map(([k]) => k);
      const isIPDataset = portValues.some(v => isLikelyIP(v));

>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      const titleEl = document.querySelector('#dash-chart-dst-ports .dash-chart-title');
      if (titleEl) {
        titleEl.textContent = isIPDataset
          ? 'Top Destination IPs'
          : 'Top Destination Ports';
      }
    }
<<<<<<< HEAD

    const labels = entries.map(([k]) => useDstIp ? k : `Port ${k}`);
=======
    // ── end smart title detection ─────────────────────────────────────────

    const labels  = entries.map(([k]) => useDstIp ? k : `Port ${k}`);
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d

    _charts['dst-ports'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           useDstIp ? 'Connections to IP' : 'Connections to Port',
          data:            values,
          backgroundColor: hexAlpha(COLOR.dest, 0.70),
          borderColor:     COLOR.dest,
          borderWidth:     1,
          borderRadius:    3,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive: true,
        maintainAspectRatio: true,
        indexAxis:  'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono, monospace', size: 10 },
            },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ── Status / Severity Distribution ───────────────────────────────────────
  function renderStatusChart(stats) {
    const canvas = document.getElementById('chart-status');
    if (!canvas) return;

    destroyChart('status');
    resetCanvas(canvas);

    const entries = [...stats.statusCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 12);

    if (entries.length === 0) {
      showChartEmpty(canvas, 'No status data available');
      return;
    }

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);

<<<<<<< HEAD
=======
    // Semantic coloring for HTTP status ranges
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const bgColors = labels.map((label, i) => {
      const code = parseInt(label, 10);
      if (code >= 200 && code < 300) return hexAlpha('#22c55e', 0.72);
      if (code >= 300 && code < 400) return hexAlpha('#3a8fe8', 0.72);
      if (code >= 400 && code < 500) return hexAlpha('#e09318', 0.72);
      if (code >= 500)               return hexAlpha('#ef4444', 0.72);
<<<<<<< HEAD
=======
      // Non-HTTP (severity levels etc)
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      const severityMap = {
        'error': hexAlpha('#ef4444', 0.80),
        'warn':  hexAlpha('#e09318', 0.80),
        'info':  hexAlpha('#3a8fe8', 0.80),
        'debug': hexAlpha('#8b5cf6', 0.60),
      };
      return severityMap[label.toLowerCase()] ?? hexAlpha(COLOR.status, 0.55 + (i % 5) * 0.07);
    });

    _charts['status'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
<<<<<<< HEAD
          data:             values,
          backgroundColor:  bgColors,
          borderColor:      'rgba(15,18,25,0.8)',
          borderWidth:      2,
=======
          data:            values,
          backgroundColor: bgColors,
          borderColor:     'rgba(15,18,25,0.8)',
          borderWidth:     2,
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
          hoverBorderColor: 'rgba(255,255,255,0.15)',
          hoverBorderWidth: 2,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, animateRotate: true, animateScale: true },
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
<<<<<<< HEAD
            labels: { color: '#94a3b8', boxWidth: 10, boxHeight: 10, borderRadius: 3, padding: 10, font: { size: 11 } },
=======
            labels: {
              color: '#94a3b8',
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              padding: 10,
              font: { size: 11 },
            },
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
          },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const total = values.reduce((s, v) => s + v, 0);
                const pct   = total > 0 ? ((item.raw / total) * 100).toFixed(1) : '0';
                return ` ${item.label}: ${item.formattedValue} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ── Protocol Distribution ─────────────────────────────────────────────────
  function renderProtocolChart(stats) {
    const canvas = document.getElementById('chart-protocol');
    if (!canvas) return;

    destroyChart('protocol');
    resetCanvas(canvas);

<<<<<<< HEAD
    const entries = [...stats.protocolCounts.entries()].sort((a, b) => b[1] - a[1]);
=======
    const entries = [...stats.protocolCounts.entries()]
      .sort((a, b) => b[1] - a[1]);
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d

    if (entries.length === 0) {
      showChartEmpty(canvas, 'No protocol data available');
      return;
    }

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);

<<<<<<< HEAD
=======
    // Protocol-specific colors
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    const protoColorMap = {
      TCP:   hexAlpha('#8b5cf6', 0.82),
      UDP:   hexAlpha('#06b6d4', 0.82),
      ICMP:  hexAlpha('#f59e0b', 0.82),
      HTTP:  hexAlpha('#22c55e', 0.82),
      HTTPS: hexAlpha('#3b82f6', 0.82),
      DNS:   hexAlpha('#ec4899', 0.82),
    };

    const bgColors = labels.map((l, i) =>
      protoColorMap[l] ?? hexAlpha(COLOR.protocol, 0.48 + (i % 5) * 0.09)
    );

    _charts['protocol'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:             values,
          backgroundColor:  bgColors,
          borderColor:      'rgba(15,18,25,0.8)',
          borderWidth:      2,
          hoverBorderColor: 'rgba(255,255,255,0.15)',
          hoverBorderWidth: 2,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, animateRotate: true, animateScale: true },
        responsive: true,
        maintainAspectRatio: true,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
<<<<<<< HEAD
            labels: { color: '#94a3b8', boxWidth: 10, boxHeight: 10, borderRadius: 3, padding: 10, font: { size: 11 } },
=======
            labels: {
              color: '#94a3b8',
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              padding: 10,
              font: { size: 11 },
            },
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
          },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const total = values.reduce((s, v) => s + v, 0);
                const pct   = total > 0 ? ((item.raw / total) * 100).toFixed(1) : '0';
                return ` ${item.label}: ${item.formattedValue} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
<<<<<<< HEAD
  // NEW CHARTS
  // ─────────────────────────────────────────────────────────────────────────

  // ── Top Destination IPs (NEW) ─────────────────────────────────────────────
  function renderDstIpChart(stats) {
    const canvas = ensureChartCard('dash-chart-dst-ips', 'Top Destination IPs', 'Top 10');
    if (!canvas) return;

    destroyChart('dst-ips');
    resetCanvas(canvas);

    if (stats.top10DstIps.length === 0) {
      showChartEmpty(canvas, 'No destination IP data available');
      return;
    }

    const labels = stats.top10DstIps.map(([ip]) => ip);
    const values = stats.top10DstIps.map(([, v]) => v);
    const maxVal = values[0] ?? 1;

    const bgColors = values.map((v, i) =>
      i === 0 ? hexAlpha(COLOR.dstIp, 0.90) : hexAlpha(COLOR.dstIp, 0.42 + (v / maxVal) * 0.35)
    );

    _charts['dst-ips'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Connections',
          data:            values,
          backgroundColor: bgColors,
          borderColor:     COLOR.dstIp,
          borderWidth:     1,
          borderRadius:    3,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive: true,
        maintainAspectRatio: true,
        indexAxis:  'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const pct = stats.totalEvents > 0
                  ? ((item.raw / stats.totalEvents) * 100).toFixed(1)
                  : '0';
                return ` ${item.formattedValue} connections (${pct}% of total)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono, monospace', size: 10 },
            },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ── Source Country Distribution (NEW) ─────────────────────────────────────
  function renderCountryChart(stats) {
    const canvas = ensureChartCard('dash-chart-country', 'Source Country Distribution', `${stats.top15Countries.length} countries`);
    if (!canvas) return;

    destroyChart('country');
    resetCanvas(canvas);

    if (stats.top15Countries.length === 0) {
      showChartEmpty(canvas, 'No country data available');
      return;
    }

    const labels = stats.top15Countries.map(([c]) => c);
    const values = stats.top15Countries.map(([, v]) => v);

    // Generate distinct colors across the pink/rose/fuchsia spectrum
    const bgColors = labels.map((_, i) =>
      hexAlpha(COLOR.country, 0.45 + (i % 10) * 0.04)
    );

    _charts['country'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:             values,
          backgroundColor:  bgColors,
          borderColor:      'rgba(15,18,25,0.8)',
          borderWidth:      2,
          hoverBorderColor: 'rgba(255,255,255,0.15)',
          hoverBorderWidth: 2,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, animateRotate: true, animateScale: true },
        responsive: true,
        maintainAspectRatio: true,
        cutout: '55%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', boxWidth: 10, boxHeight: 10, borderRadius: 3, padding: 8, font: { size: 10 } },
          },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const total = values.reduce((s, v) => s + v, 0);
                const pct   = total > 0 ? ((item.raw / total) * 100).toFixed(1) : '0';
                return ` ${item.label}: ${item.formattedValue} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ── Hourly Activity Heatmap (NEW) ─────────────────────────────────────────
  function renderHeatmapChart(stats) {
    const canvas = ensureChartCard('dash-chart-heatmap', 'Hourly Activity Pattern', '24-hour distribution');
    if (!canvas) return;

    destroyChart('heatmap');
    resetCanvas(canvas);

    if (!stats.sortedHourly || stats.sortedHourly.length === 0) {
      showChartEmpty(canvas, 'No hourly data available');
      return;
    }

    const labels = stats.sortedHourly.map(([h]) => h);
    const values = stats.sortedHourly.map(([, v]) => v);
    const maxVal = Math.max(...values, 1);

    // Colour intensity based on activity level
    const bgColors = values.map(v => {
      const intensity = v / maxVal;
      if (intensity > 0.8) return hexAlpha(COLOR.spike,   0.85);
      if (intensity > 0.5) return hexAlpha(COLOR.heatmap, 0.80);
      if (intensity > 0.2) return hexAlpha(COLOR.heatmap, 0.50);
      return hexAlpha(COLOR.heatmap, 0.20);
    });

    _charts['heatmap'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          backgroundColor: bgColors,
          borderColor:     hexAlpha(COLOR.heatmap, 0.60),
          borderWidth:     1,
          borderRadius:    2,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              title: items => `Hour: ${items[0].label}`,
              label: item => ` ${item.formattedValue} events`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0 },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
        },
      },
    });
  }

  // ── Action / Event Type Distribution (NEW) ────────────────────────────────
  function renderActionChart(stats) {
    const canvas = ensureChartCard('dash-chart-action', 'Action / Event Type', 'Top 10');
    if (!canvas) return;

    destroyChart('action');
    resetCanvas(canvas);

    if (stats.top10Actions.length === 0) {
      showChartEmpty(canvas, 'No action data available');
      return;
    }

    const labels = stats.top10Actions.map(([a]) => a);
    const values = stats.top10Actions.map(([, v]) => v);
    const maxVal = values[0] ?? 1;

    const bgColors = values.map((v, i) =>
      i === 0 ? hexAlpha(COLOR.action, 0.90) : hexAlpha(COLOR.action, 0.42 + (v / maxVal) * 0.35)
    );

    _charts['action'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          backgroundColor: bgColors,
          borderColor:     COLOR.action,
          borderWidth:     1,
          borderRadius:    3,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION, easing: 'easeInOutQuart' },
        responsive: true,
        maintainAspectRatio: true,
        indexAxis:  'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(15,18,25,0.92)',
            borderColor:     'rgba(255,255,255,0.08)',
            borderWidth:     1,
            titleColor:      '#94a3b8',
            bodyColor:       '#e2e8f0',
            padding:         10,
            callbacks: {
              label: item => {
                const pct = stats.totalEvents > 0
                  ? ((item.raw / stats.totalEvents) * 100).toFixed(1)
                  : '0';
                return ` ${item.formattedValue} events (${pct}% of total)`;
              },
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#64748b', font: { size: 10 } },
            grid:  { color: 'rgba(255,255,255,0.04)' },
          },
          y: {
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono, monospace', size: 10 },
            },
            grid: { display: false },
          },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SMART INSIGHTS PANEL
  // ─────────────────────────────────────────────────────────────────────────

=======
  // SMART INSIGHTS PANEL
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * renderInsights(stats)
   *
   * Generates dynamic, data-driven SOC insights.
   * Each insight has a severity tag: info / warning / critical
   */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function renderInsights(stats) {
    const list = document.getElementById('insights-list');
    if (!list) return;

<<<<<<< HEAD
    const items = [];

=======
    // Each item: { text, severity }
    // severity: 'info' | 'warning' | 'critical'
    const items = [];

    // ── Summary ───────────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    items.push({
      text:     `Analyzed ${stats.totalEvents.toLocaleString()} log events across ${stats.uniqueIpCount.toLocaleString()} unique source IP${stats.uniqueIpCount !== 1 ? 's' : ''}.`,
      severity: 'info',
    });

<<<<<<< HEAD
=======
    // ── Top attacker ──────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.topIp) {
      const pct = stats.totalEvents > 0
        ? ((stats.topIpCount / stats.totalEvents) * 100).toFixed(1)
        : '0';
      items.push({
        text:     `Most active IP: ${stats.topIp} — ${stats.topIpCount.toLocaleString()} events (${pct}% of total traffic).`,
        severity: parseFloat(pct) > 30 ? 'critical' : parseFloat(pct) > 15 ? 'warning' : 'info',
      });
    }

<<<<<<< HEAD
=======
    // ── Dominant IP (single source flooding) ──────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.dominantIp) {
      const [ip, count] = stats.dominantIp;
      const pct = ((count / stats.totalEvents) * 100).toFixed(1);
      items.push({
        text:     `Single IP dominating traffic: ${ip} responsible for ${pct}% of all events — potential flood or scan.`,
        severity: 'critical',
      });
    }

<<<<<<< HEAD
=======
    // ── Top 3 concentration ───────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.top10Ips.length >= 3 && stats.top3Pct > 0) {
      items.push({
        text:     `Top 3 source IPs account for ${stats.top3Pct}% of total traffic — ${stats.top3Pct > 50 ? 'highly concentrated source pattern' : 'moderate source distribution'}.`,
        severity: stats.top3Pct > 50 ? 'warning' : 'info',
      });
    }

<<<<<<< HEAD
=======
    // ── Peak activity ─────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.peakBucket) {
      items.push({
        text:     `Peak traffic observed at ${stats.peakBucket} with ${stats.peakCount.toLocaleString()} events${stats.granularity === 'hour' ? ' (hourly bucket)' : stats.granularity === '5min' ? ' (5-min bucket)' : ''}.`,
        severity: 'info',
      });
    }

<<<<<<< HEAD
=======
    // ── Traffic spikes ────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.spikeIndices.size > 0) {
      const spikeTimes = [...stats.spikeIndices]
        .slice(0, 3)
        .map(i => stats.sortedTimeline[i]?.[0])
        .filter(Boolean);
      items.push({
        text:     `Traffic spike${stats.spikeIndices.size > 1 ? 's' : ''} detected at: ${spikeTimes.join(', ')}${stats.spikeIndices.size > 3 ? ` +${stats.spikeIndices.size - 3} more` : ''} — events exceeded ${SPIKE_SIGMA}σ above mean.`,
        severity: 'warning',
      });
    }

<<<<<<< HEAD
=======
    // ── Quiet period ──────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.quietPeriod && stats.hasTimestamp) {
      items.push({
        text:     `Lowest activity period: ${stats.quietPeriod} — potential maintenance window or off-hours gap.`,
        severity: 'info',
      });
    }

<<<<<<< HEAD
=======
    // ── Destination ───────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (stats.topPort) {
      items.push({
        text:     `Most targeted port: ${stats.topPort} with ${stats.topPortCount.toLocaleString()} connection${stats.topPortCount !== 1 ? 's' : ''}.`,
        severity: ['22', '23', '3389', '445', '21'].includes(stats.topPort) ? 'warning' : 'info',
      });
    }

    if (stats.hasDstIp && stats.top10DstIps.length > 0) {
      const [topDst, topDstCount] = stats.top10DstIps[0];
      items.push({
        text:     `Most targeted destination IP: ${topDst} — received ${topDstCount.toLocaleString()} connection${topDstCount !== 1 ? 's' : ''}.`,
        severity: 'info',
      });
    }

<<<<<<< HEAD
    // ── Country insight (NEW) ─────────────────────────────────────────────
    if (stats.hasSrcCountry && stats.top15Countries.length > 0) {
      const [topCountry, topCountryCount] = stats.top15Countries[0];
      const pct = stats.totalEvents > 0
        ? ((topCountryCount / stats.totalEvents) * 100).toFixed(1)
        : '0';
      items.push({
        text:     `Top source country: ${topCountry} — ${topCountryCount.toLocaleString()} events (${pct}% of traffic). ${stats.top15Countries.length} countries observed in total.`,
        severity: parseFloat(pct) > 60 ? 'warning' : 'info',
      });
    }

    // ── Action insight (NEW) ──────────────────────────────────────────────
    if (stats.hasAction && stats.top10Actions.length > 0) {
      const [topAction, topActionCount] = stats.top10Actions[0];
      const pct = stats.totalEvents > 0
        ? ((topActionCount / stats.totalEvents) * 100).toFixed(1)
        : '0';
      items.push({
        text:     `Dominant action type: "${topAction}" — ${topActionCount.toLocaleString()} events (${pct}%). ${stats.top10Actions.length} distinct action${stats.top10Actions.length !== 1 ? 's' : ''} detected.`,
        severity: ['deny', 'block', 'drop', 'reject', 'failed', 'error'].includes(topAction.toLowerCase()) ? 'warning' : 'info',
      });
    }

    if (stats.hasStatus && stats.statusCounts.size > 0) {
      const totalStatus = [...stats.statusCounts.values()].reduce((s, v) => s + v, 0);
      const clientErrors = [...stats.statusCounts.entries()]
        .filter(([k]) => { const c = parseInt(k, 10); return c >= 400 && c < 500; })
        .reduce((s, [, v]) => s + v, 0);
      const serverErrors = [...stats.statusCounts.entries()]
        .filter(([k]) => parseInt(k, 10) >= 500)
        .reduce((s, [, v]) => s + v, 0);
=======
    // ── Status code anomalies ─────────────────────────────────────────────
    if (stats.hasStatus && stats.statusCounts.size > 0) {
      const totalStatus = [...stats.statusCounts.values()].reduce((s, v) => s + v, 0);

      // Count 4xx errors
      const clientErrors = [...stats.statusCounts.entries()]
        .filter(([k]) => { const c = parseInt(k, 10); return c >= 400 && c < 500; })
        .reduce((s, [, v]) => s + v, 0);

      // Count 5xx errors
      const serverErrors = [...stats.statusCounts.entries()]
        .filter(([k]) => parseInt(k, 10) >= 500)
        .reduce((s, [, v]) => s + v, 0);

>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      const errorPct = totalStatus > 0
        ? (((clientErrors + serverErrors) / totalStatus) * 100).toFixed(1)
        : '0';

      if (clientErrors + serverErrors > 0) {
        items.push({
          text:     `${errorPct}% error rate — ${clientErrors.toLocaleString()} client errors (4xx) and ${serverErrors.toLocaleString()} server errors (5xx) detected.`,
          severity: parseFloat(errorPct) > 20 ? 'critical' : parseFloat(errorPct) > 5 ? 'warning' : 'info',
        });
      } else {
        const topStatus = [...stats.statusCounts.entries()].sort((a, b) => b[1] - a[1])[0];
        items.push({
          text:     `Most frequent status: ${topStatus[0]} (${topStatus[1].toLocaleString()} occurrences — ${((topStatus[1] / totalStatus) * 100).toFixed(1)}% of responses).`,
          severity: 'info',
        });
      }
    }

<<<<<<< HEAD
    if (stats.hasProtocol && stats.protocolCounts.size > 0) {
      const sorted     = [...stats.protocolCounts.entries()].sort((a, b) => b[1] - a[1]);
      const topProto   = sorted[0];
      const totalProto = sorted.reduce((s, [, v]) => s + v, 0);
      const domPct     = totalProto > 0
=======
    // ── Protocol insight ──────────────────────────────────────────────────
    if (stats.hasProtocol && stats.protocolCounts.size > 0) {
      const sorted    = [...stats.protocolCounts.entries()].sort((a, b) => b[1] - a[1]);
      const topProto  = sorted[0];
      const totalProto = sorted.reduce((s, [, v]) => s + v, 0);
      const domPct    = totalProto > 0
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
        ? ((topProto[1] / totalProto) * 100).toFixed(1)
        : '0';
      items.push({
        text:     `Dominant protocol: ${topProto[0]} (${domPct}% of traffic). ${sorted.length} protocol${sorted.length !== 1 ? 's' : ''} observed in total.`,
        severity: 'info',
      });
    }

<<<<<<< HEAD
=======
    // ── No timestamp warning ──────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    if (!stats.hasTimestamp) {
      items.push({
        text:     'No timestamp fields detected — timeline chart and temporal analysis unavailable.',
        severity: 'warning',
      });
    }

<<<<<<< HEAD
=======
    // ── Render ────────────────────────────────────────────────────────────
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
    list.innerHTML = '';
    for (const { text, severity } of items) {
      const li = document.createElement('li');
      li.setAttribute('data-severity', severity);

<<<<<<< HEAD
      const badge = document.createElement('span');
      badge.className   = `insight-badge insight-badge--${severity}`;
      badge.textContent = severity.toUpperCase();

      const textNode = document.createElement('span');
      textNode.className   = 'insight-text';
=======
      // Severity badge
      const badge = document.createElement('span');
      badge.className = `insight-badge insight-badge--${severity}`;
      badge.textContent = severity.toUpperCase();

      const textNode = document.createElement('span');
      textNode.className = 'insight-text';
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
      textNode.textContent = text;

      li.appendChild(badge);
      li.appendChild(textNode);
      list.appendChild(li);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

<<<<<<< HEAD
=======
  /**
   * parseBucket(rawTs, granularity) → string or null
   *
   * Handles:
   *   - ISO 8601 / MySQL-style datetime strings
   *   - Unix timestamps (seconds or ms)
   *
   * Granularity:
   *   'minute' → 'YYYY-MM-DD HH:MM'
   *   '5min'   → 'YYYY-MM-DD HH:M0' (rounded to nearest 5)
   *   'hour'   → 'YYYY-MM-DD HH'
   */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function parseBucket(rawTs, granularity = 'minute') {
    if (rawTs == null || rawTs === '' || rawTs === '-') return null;

    let d;
    if (typeof rawTs === 'number') {
      d = new Date(rawTs > 1e10 ? rawTs : rawTs * 1000);
    } else {
      const s = String(rawTs).trim();
      d = new Date(s);
      if (isNaN(d.getTime())) d = new Date(s.replace(' ', 'T'));
    }

    if (isNaN(d.getTime())) return null;

    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = d.getMinutes();

    if (granularity === 'hour')  return `${yyyy}-${mm}-${dd} ${hh}`;
    if (granularity === '5min')  return `${yyyy}-${mm}-${dd} ${hh}:${String(Math.floor(min / 5) * 5).padStart(2, '0')}`;
    return `${yyyy}-${mm}-${dd} ${hh}:${String(min).padStart(2, '0')}`;
  }

  /**
<<<<<<< HEAD
   * parseHourBucket(rawTs) → hour integer (0–23) or null
   * Used for the 24-hour activity heatmap.
   */
  function parseHourBucket(rawTs) {
    if (rawTs == null || rawTs === '' || rawTs === '-') return null;
    let d;
    if (typeof rawTs === 'number') {
      d = new Date(rawTs > 1e10 ? rawTs : rawTs * 1000);
    } else {
      const s = String(rawTs).trim();
      d = new Date(s);
      if (isNaN(d.getTime())) d = new Date(s.replace(' ', 'T'));
    }
    if (isNaN(d.getTime())) return null;
    return d.getHours();
  }

=======
   * isValidIpLike(val) — rejects placeholder / null-like values.
   */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function isValidIpLike(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    if (s === '' || s === '-' || s === 'n/a' || s === 'none' ||
        s === 'null' || s === 'unknown' || s === '0.0.0.0') return false;
    return true;
  }

<<<<<<< HEAD
=======
  /** Destroy a Chart.js instance by key if it exists. */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function destroyChart(key) {
    if (_charts[key]) {
      _charts[key].destroy();
      delete _charts[key];
    }
  }

<<<<<<< HEAD
=======
  /**
   * resetCanvas(canvas) — re-shows canvas and removes any previous
   * empty-state message so re-renders start clean.
   */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function resetCanvas(canvas) {
    canvas.style.display = '';
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    const msg = wrapper.querySelector('.chart-empty-msg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  }

<<<<<<< HEAD
=======
  /** Show a plain-text empty state message inside a canvas wrapper. */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function showChartEmpty(canvas, message) {
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    canvas.style.display = 'none';
    let msg = wrapper.querySelector('.chart-empty-msg');
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'chart-empty-msg';
      msg.style.cssText = [
        'color:#475569',
        'font-size:12px',
        'text-align:center',
        'padding:2rem 1rem',
        'margin:0',
        'font-family:JetBrains Mono,monospace',
        'letter-spacing:0.2px',
      ].join(';');
      wrapper.appendChild(msg);
    }
    msg.textContent = message;
    msg.style.display = 'block';
  }

<<<<<<< HEAD
=======
  /** Safe DOM text setter — no-op if element not found. */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

<<<<<<< HEAD
=======
  /** hexAlpha('#rrggbb', alpha) → 'rgba(r,g,b,a)' */
>>>>>>> a971a96c01ed6eb08b07a233b9a913ec88e27d4d
  function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
  }

})();