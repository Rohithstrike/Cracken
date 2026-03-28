/**
 * dashboard.js
 * SOC Log Parser — Visualization & Analytics Engine
 *
 * Entry point: window.renderDashboard(data)
 * Consumes:    window._fullParsedData (set by uploader.js)
 *
 * Charts (Chart.js):
 *   - Timeline        (#chart-timeline)   blue   #3b82f6
 *   - Top Source IPs  (#chart-src-ips)    green  #22c55e
 *   - Top Dst Ports   (#chart-dst-ports)  amber  #f59e0b
 *   - Status Codes    (#chart-status)     red    #ef4444  (optional)
 *   - Protocol Dist.  (#chart-protocol)   purple #8b5cf6  (optional)
 *
 * Metrics:
 *   #metric-total · #metric-unique-ips · #metric-top-ip · #metric-peak-time
 *
 * Insights:
 *   #insights-list
 *
 * Performance:
 *   Single-pass data processing with Map counters.
 *   Safe for 100 k+ rows.
 */

(() => {
  'use strict';

  // ── Chart registry — destroyed before each re-render ─────────────────────
  const _charts = {};

  // ── Color palette (strict per spec) ──────────────────────────────────────
  const COLOR = {
    timeline: '#3b82f6',
    ips:      '#22c55e',
    ports:    '#f59e0b',
    status:   '#ef4444',
    protocol: '#8b5cf6',
  };

  // ── Chart.js shared defaults ──────────────────────────────────────────────
  const ANIM_DURATION = 800;

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC ENTRY POINT
  // ─────────────────────────────────────────────────────────────────────────

  window.renderDashboard = function (data) {
    // 1. Validate
    if (!data || !Array.isArray(data.rows) || data.rows.length === 0) {
      console.warn('[dashboard] renderDashboard: no rows to visualise.');
      return;
    }

    // 2. Show loader
    showDashboardLoader();

    // Defer heavy work one frame so the loader paints before processing
    requestAnimationFrame(() => {
      try {
        // 3. Process
        const stats = processData(data.rows);

        // 4. Metrics
        renderMetrics(stats);

        // 5. Charts
        renderCharts(stats);

        // 6. Insights
        renderInsights(stats);
      } catch (err) {
        console.error('[dashboard] render error:', err);
      } finally {
        // 7. Hide loader (always, even on error)
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
  // DATA PROCESSING  (single pass)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * processData(rows) → stats object
   *
   * Single pass over all rows collecting:
   *   - timeline buckets  (Map<bucketKey, count>)
   *   - src IP counts     (Map<ip, count>)
   *   - dst port counts   (Map<port, count>)
   *   - status counts     (Map<status, count>)
   *   - protocol counts   (Map<proto, count>)
   *   - unique IPs        (Set<ip>)
   */
  function processData(rows) {
    const timelineBuckets = new Map();  // 'YYYY-MM-DD HH:MM' → count
    const srcIpCounts     = new Map();
    const dstPortCounts   = new Map();
    const statusCounts    = new Map();
    const protocolCounts  = new Map();
    const uniqueIps       = new Set();

    let hasTimestamp = false;
    let hasStatus    = false;
    let hasProtocol  = false;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      // ── Timestamp bucketing ──────────────────────────────────────────────
      const rawTs = row.timestamp ?? row.date ?? row.time ?? row.datetime ?? null;
      if (rawTs) {
        const bucket = parseBucket(rawTs);
        if (bucket) {
          hasTimestamp = true;
          timelineBuckets.set(bucket, (timelineBuckets.get(bucket) ?? 0) + 1);
        }
      }

      // ── Source IP ────────────────────────────────────────────────────────
      const srcIp = row.src_ip ?? row.c_ip ?? row.client_ip ?? row.source_ip ?? null;
      if (srcIp && isValidIpLike(srcIp)) {
        uniqueIps.add(srcIp);
        srcIpCounts.set(srcIp, (srcIpCounts.get(srcIp) ?? 0) + 1);
      }

      // ── Destination port ─────────────────────────────────────────────────
      const dstPort = row.dst_port ?? row.destination_port ?? row.s_port ?? row.dstport ?? null;
      if (dstPort != null && dstPort !== '' && dstPort !== '-') {
        const portStr = String(dstPort);
        dstPortCounts.set(portStr, (dstPortCounts.get(portStr) ?? 0) + 1);
      }

      // ── Status code ──────────────────────────────────────────────────────
      const status = row.sc_status ?? row.status ?? row.status_code ?? null;
      if (status != null && status !== '' && status !== '-') {
        hasStatus = true;
        const statusStr = String(status);
        statusCounts.set(statusStr, (statusCounts.get(statusStr) ?? 0) + 1);
      }

      // ── Protocol ─────────────────────────────────────────────────────────
      const proto = row.protocol ?? row.proto ?? null;
      if (proto && proto !== '-') {
        hasProtocol = true;
        const protoStr = String(proto).toUpperCase();
        protocolCounts.set(protoStr, (protocolCounts.get(protoStr) ?? 0) + 1);
      }
    }

    // ── Sort timeline by key (chronological) ─────────────────────────────
    const sortedTimeline = [...timelineBuckets.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
    );

    // ── Top 10 source IPs ─────────────────────────────────────────────────
    const top10Ips = [...srcIpCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // ── Top 10 destination ports ──────────────────────────────────────────
    const top10Ports = [...dstPortCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // ── Peak time bucket ──────────────────────────────────────────────────
    let peakBucket = null;
    let peakCount  = 0;
    for (const [bucket, count] of timelineBuckets) {
      if (count > peakCount) {
        peakCount  = count;
        peakBucket = bucket;
      }
    }

    // ── Top source IP ─────────────────────────────────────────────────────
    const topIp      = top10Ips.length > 0 ? top10Ips[0][0] : null;
    const topIpCount = top10Ips.length > 0 ? top10Ips[0][1] : 0;

    // ── Top port ─────────────────────────────────────────────────────────
    const topPort      = top10Ports.length > 0 ? top10Ports[0][0] : null;
    const topPortCount = top10Ports.length > 0 ? top10Ports[0][1] : 0;

    return {
      totalEvents:    rows.length,
      uniqueIpCount:  uniqueIps.size,
      topIp,
      topIpCount,
      topPort,
      topPortCount,
      peakBucket,
      peakCount,
      hasTimestamp,
      hasStatus,
      hasProtocol,
      sortedTimeline,
      top10Ips,
      top10Ports,
      statusCounts,
      protocolCounts,
    };
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
  // CHARTS
  // ─────────────────────────────────────────────────────────────────────────

  function renderCharts(stats) {
    renderTimelineChart(stats);
    renderSrcIpChart(stats);
    renderDstPortChart(stats);

    if (stats.hasStatus)   renderStatusChart(stats);
    if (stats.hasProtocol) renderProtocolChart(stats);
  }

  // ── Timeline ──────────────────────────────────────────────────────────────
  function renderTimelineChart(stats) {
    const canvas = document.getElementById('chart-timeline');
    if (!canvas) return;

    destroyChart('timeline');

    if (!stats.hasTimestamp || stats.sortedTimeline.length === 0) {
      showChartEmpty(canvas, 'No timestamp data available');
      return;
    }

    const labels = stats.sortedTimeline.map(([k]) => k);
    const values = stats.sortedTimeline.map(([, v]) => v);

    _charts['timeline'] = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          borderColor:     COLOR.timeline,
          backgroundColor: hexAlpha(COLOR.timeline, 0.15),
          borderWidth:     2,
          pointRadius:     labels.length > 200 ? 0 : 2,
          fill:            true,
          tension:         0.3,
        }],
      },
      options: {
        animation:   { duration: ANIM_DURATION },
        responsive:  true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: items => items[0].label } },
        },
        scales: {
          x: {
            ticks: {
              maxTicksLimit: 12,
              color: '#94a3b8',
              maxRotation: 45,
            },
            grid: { color: '#1e293b' },
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#94a3b8' },
            grid: { color: '#1e293b' },
          },
        },
      },
    });
  }

  // ── Top Source IPs ────────────────────────────────────────────────────────
  function renderSrcIpChart(stats) {
    const canvas = document.getElementById('chart-src-ips');
    if (!canvas) return;

    destroyChart('src-ips');

    if (stats.top10Ips.length === 0) {
      showChartEmpty(canvas, 'No source IP data available');
      return;
    }

    const labels = stats.top10Ips.map(([ip]) => ip);
    const values = stats.top10Ips.map(([, n]) => n);

    _charts['src-ips'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          backgroundColor: hexAlpha(COLOR.ips, 0.75),
          borderColor:     COLOR.ips,
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION },
        responsive: true,
        indexAxis:  'y',
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#94a3b8' },
            grid:  { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono, monospace', size: 11 } },
            grid:  { display: false },
          },
        },
      },
    });
  }

  // ── Top Destination Ports ─────────────────────────────────────────────────
  function renderDstPortChart(stats) {
    const canvas = document.getElementById('chart-dst-ports');
    if (!canvas) return;

    destroyChart('dst-ports');

    if (stats.top10Ports.length === 0) {
      showChartEmpty(canvas, 'No destination port data available');
      return;
    }

    const labels = stats.top10Ports.map(([port]) => `Port ${port}`);
    const values = stats.top10Ports.map(([, n]) => n);

    _charts['dst-ports'] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Events',
          data:            values,
          backgroundColor: hexAlpha(COLOR.ports, 0.75),
          borderColor:     COLOR.ports,
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION },
        responsive: true,
        indexAxis:  'y',
        plugins: { legend: { display: false } },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#94a3b8' },
            grid:  { color: '#1e293b' },
          },
          y: {
            ticks: { color: '#94a3b8' },
            grid:  { display: false },
          },
        },
      },
    });
  }

  // ── Status Code Distribution ──────────────────────────────────────────────
  function renderStatusChart(stats) {
    const canvas = document.getElementById('chart-status');
    if (!canvas) return;

    destroyChart('status');

    const entries = [...stats.statusCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    if (entries.length === 0) {
      showChartEmpty(canvas, 'No status code data available');
      return;
    }

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);

    _charts['status'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:            values,
          backgroundColor: labels.map((_, i) => hexAlpha(COLOR.status, 0.55 + (i % 5) * 0.08)),
          borderColor:     labels.map(() => COLOR.status),
          borderWidth:     1,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION },
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } },
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

    const entries = [...stats.protocolCounts.entries()]
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      showChartEmpty(canvas, 'No protocol data available');
      return;
    }

    const labels = entries.map(([k]) => k);
    const values = entries.map(([, v]) => v);

    _charts['protocol'] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:            values,
          backgroundColor: labels.map((_, i) => hexAlpha(COLOR.protocol, 0.50 + (i % 5) * 0.08)),
          borderColor:     labels.map(() => COLOR.protocol),
          borderWidth:     1,
        }],
      },
      options: {
        animation:  { duration: ANIM_DURATION },
        responsive: true,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', boxWidth: 12, font: { size: 11 } },
          },
        },
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INSIGHTS
  // ─────────────────────────────────────────────────────────────────────────

  function renderInsights(stats) {
    const list = document.getElementById('insights-list');
    if (!list) return;

    const items = [];

    // Total events
    items.push(`Total of ${stats.totalEvents.toLocaleString()} log events processed.`);

    // Unique IPs
    if (stats.uniqueIpCount > 0) {
      items.push(`${stats.uniqueIpCount.toLocaleString()} unique source IP${stats.uniqueIpCount !== 1 ? 's' : ''} observed.`);
    }

    // Top source IP
    if (stats.topIp) {
      items.push(`Top source IP: ${stats.topIp} with ${stats.topIpCount.toLocaleString()} event${stats.topIpCount !== 1 ? 's' : ''}.`);
    }

    // Peak activity
    if (stats.peakBucket) {
      items.push(`Peak activity observed at ${stats.peakBucket} (${stats.peakCount.toLocaleString()} event${stats.peakCount !== 1 ? 's' : ''}).`);
    }

    // Most targeted port
    if (stats.topPort) {
      items.push(`Most targeted port: ${stats.topPort} with ${stats.topPortCount.toLocaleString()} connection${stats.topPortCount !== 1 ? 's' : ''}.`);
    }

    // Status code insight
    if (stats.hasStatus && stats.statusCounts.size > 0) {
      const topStatus = [...stats.statusCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      items.push(`Most frequent status code: ${topStatus[0]} (${topStatus[1].toLocaleString()} occurrence${topStatus[1] !== 1 ? 's' : ''}).`);
    }

    // Protocol insight
    if (stats.hasProtocol && stats.protocolCounts.size > 0) {
      const topProto = [...stats.protocolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      items.push(`Dominant protocol: ${topProto[0]} (${topProto[1].toLocaleString()} event${topProto[1] !== 1 ? 's' : ''}).`);
    }

    // No timestamp warning
    if (!stats.hasTimestamp) {
      items.push('No timestamp fields detected — timeline chart unavailable.');
    }

    // Render
    list.innerHTML = '';
    for (const text of items) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UTILITIES
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * parseBucket(rawTs) → 'YYYY-MM-DD HH:MM' string or null
   *
   * Handles:
   *   - ISO 8601 strings
   *   - 'YYYY-MM-DD HH:MM:SS' strings
   *   - Unix timestamps (seconds or ms)
   *
   * Buckets at minute granularity. Falls back to hour if > 10 k unique
   * minutes would be produced (handled by caller label pruning via Chart.js
   * maxTicksLimit — no need to re-bucket here).
   */
  function parseBucket(rawTs) {
    if (rawTs == null || rawTs === '' || rawTs === '-') return null;

    let d;

    if (typeof rawTs === 'number') {
      // Unix seconds vs ms heuristic
      d = new Date(rawTs > 1e10 ? rawTs : rawTs * 1000);
    } else {
      const s = String(rawTs).trim();
      // Try native parse first (covers ISO 8601)
      d = new Date(s);
      if (isNaN(d.getTime())) {
        // Try replacing space separator for MySQL-style datetimes
        d = new Date(s.replace(' ', 'T'));
      }
    }

    if (isNaN(d.getTime())) return null;

    // Format: 'YYYY-MM-DD HH:MM'
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const hh   = String(d.getHours()).padStart(2, '0');
    const min  = String(d.getMinutes()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  /**
   * isValidIpLike(val) → bool
   * Accepts IPv4, IPv6, and hostname-like strings.
   * Rejects empty, '-', 'N/A', 'unknown', etc.
   */
  function isValidIpLike(val) {
    if (!val) return false;
    const s = String(val).trim().toLowerCase();
    if (s === '' || s === '-' || s === 'n/a' || s === 'none' ||
        s === 'null' || s === 'unknown' || s === '0.0.0.0') return false;
    return true;
  }

  /** Destroy a Chart.js instance by key if it exists. */
  function destroyChart(key) {
    if (_charts[key]) {
      _charts[key].destroy();
      delete _charts[key];
    }
  }

  /** Show a plain-text empty state message inside a canvas wrapper. */
  function showChartEmpty(canvas, message) {
    const wrapper = canvas.parentElement;
    if (!wrapper) return;
    // Hide canvas, show text
    canvas.style.display = 'none';
    let msg = wrapper.querySelector('.chart-empty-msg');
    if (!msg) {
      msg = document.createElement('p');
      msg.className = 'chart-empty-msg';
      msg.style.cssText = 'color:#64748b;font-size:0.8rem;text-align:center;padding:1rem 0;margin:0;';
      wrapper.appendChild(msg);
    }
    msg.textContent = message;
    msg.style.display = 'block';
  }

  /**
   * setText(id, value) — safe DOM text setter.
   * No-op if element does not exist.
   */
  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /**
   * hexAlpha(hex, alpha) → rgba string
   * Converts '#rrggbb' + alpha [0–1] → 'rgba(r,g,b,a)'
   */
  function hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
  }

})();