/**
 * Analysis Module — Charts, stats, and trip history.
 */
const AnalysisModule = (() => {
  let speedChart = null;
  let altitudeChart = null;
  let currentTrips = [];

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15,15,35,0.9)',
        titleColor: '#00d4aa',
        bodyColor: '#e8e8f0',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10
      }
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.4)', maxTicksLimit: 12 } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.4)' }, beginAtZero: true }
    }
  };

  function initCharts() {
    const sCtx = document.getElementById('speed-chart');
    const aCtx = document.getElementById('altitude-chart');
    if (sCtx && !speedChart) {
      speedChart = new Chart(sCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.1)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
        options: chartOpts
      });
    }
    if (aCtx && !altitudeChart) {
      altitudeChart = new Chart(aCtx, {
        type: 'line',
        data: { labels: [], datasets: [{ data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
        options: chartOpts
      });
    }
    
    // Bind Export/Print Buttons
    document.getElementById('btn-export-excel')?.addEventListener('click', exportExcel);
    document.getElementById('btn-export-pdf')?.addEventListener('click', exportPDF);
  }

  function updateStats(a) {
    document.getElementById('stat-distance').textContent = a.totalDistance?.toFixed(2) || '--';
    document.getElementById('stat-max-speed').textContent = a.maxSpeed || '--';
    document.getElementById('stat-avg-speed').textContent = a.avgSpeed?.toFixed(1) || '--';
    document.getElementById('stat-moving-time').textContent = fmtDur(a.movingTime);
    document.getElementById('stat-idle-time').textContent = fmtDur(a.idleTime);
    document.getElementById('stat-positions').textContent = a.positionCount || '--';
  }

  function updateSpeedChart(hist) {
    if (!speedChart || !hist) return;
    speedChart.data.labels = hist.map(p => new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    speedChart.data.datasets[0].data = hist.map(p => p.speed);
    speedChart.update('none');
  }

  function updateAltitudeChart(pos) {
    if (!altitudeChart || !pos) return;
    altitudeChart.data.labels = pos.map(p => new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    altitudeChart.data.datasets[0].data = pos.map(p => p.altitude);
    altitudeChart.update('none');
  }

  function updateTrips(trips) {
    currentTrips = trips || [];
    const tbody = document.getElementById('trips-tbody');
    if (!tbody) return;
    if (currentTrips.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No trips found</td></tr>'; return; }
    tbody.innerHTML = trips.map(t => `<tr>
      <td>${fmtDT(t.start_time)}</td>
      <td>${t.end_time ? fmtDT(t.end_time) : '<span style="color:var(--accent)">Active</span>'}</td>
      <td>${fmtDur(t.duration_seconds)}</td>
      <td>${t.distance?.toFixed(2) || '--'} km</td>
      <td>${t.max_speed || '--'} km/h</td>
      <td>${t.avg_speed?.toFixed(1) || '--'} km/h</td>
      <td><button class="btn-primary btn-small" onclick="AnalysisModule.viewTrip(${t.id},${t.device_id})">View</button></td>
    </tr>`).join('');
  }

  async function viewTrip(tripId, deviceId) {
    try {
      const trips = await fetch(`/api/devices/${deviceId}/trips`).then(r => r.json());
      const trip = trips.find(t => t.id === tripId);
      if (trip?.start_time && trip?.end_time) {
        const pos = await fetch(`/api/devices/${deviceId}/positions?from=${trip.start_time}&to=${trip.end_time}`).then(r => r.json());
        MapModule.showHistory(pos);
        document.querySelector('[data-panel="map"]').click();
      }
    } catch (e) { console.error('Error viewing trip:', e); }
  }

  async function loadData(deviceId, from, to) {
    try {
      const [analytics, positions, trips] = await Promise.all([
        fetch(`/api/devices/${deviceId}/analytics?from=${from}&to=${to}`).then(r => r.json()),
        fetch(`/api/devices/${deviceId}/positions?from=${from}&to=${to}`).then(r => r.json()),
        fetch(`/api/devices/${deviceId}/trips?from=${from}&to=${to}`).then(r => r.json())
      ]);
      updateStats(analytics);
      updateSpeedChart(analytics.speedHistory);
      updateAltitudeChart(positions);
      updateTrips(trips);
    } catch (e) { console.error('Error loading analysis:', e); }
  }

  function fmtDur(s) {
    if (!s) return '--';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
  }

  function fmtDT(dt) {
    if (!dt) return '--';
    return new Date(dt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function exportExcel() {
    if (currentTrips.length === 0) {
      alert("No trips to export for this device in the selected time range.");
      return;
    }

    const headers = ['Start Time', 'End Time', 'Duration', 'Distance (km)', 'Max Speed (km/h)', 'Avg Speed (km/h)'];
    const rows = currentTrips.map(t => [
      new Date(t.start_time).toLocaleString(),
      t.end_time ? new Date(t.end_time).toLocaleString() : 'Active',
      fmtDur(t.duration_seconds).replace(/,/g, ''),
      parseFloat(t.distance?.toFixed(2) || '0'),
      t.max_speed || 0,
      parseFloat(t.avg_speed?.toFixed(1) || '0')
    ]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trips");
    XLSX.writeFile(wb, `trip_report_${Date.now()}.xlsx`);
  }

  function exportPDF() {
    if (currentTrips.length === 0) {
      alert("No trips to export for this device in the selected time range.");
      return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text("GPS Tracker - Trip Report", 14, 20);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 28);
    
    const headers = [['Start Time', 'End Time', 'Duration', 'Distance (km)', 'Max Speed (km/h)', 'Avg Speed (km/h)']];
    const rows = currentTrips.map(t => [
      new Date(t.start_time).toLocaleString(),
      t.end_time ? new Date(t.end_time).toLocaleString() : 'Active',
      fmtDur(t.duration_seconds),
      (t.distance?.toFixed(2) || '0'),
      (t.max_speed || 0),
      (t.avg_speed?.toFixed(1) || '0')
    ]);

    doc.autoTable({
      head: headers,
      body: rows,
      startY: 35,
      theme: 'striped',
      headStyles: { fillColor: [0, 212, 170], textColor: [25, 25, 40] }
    });

    doc.save(`trip_report_${Date.now()}.pdf`);
  }

  return { initCharts, loadData, updateStats, updateSpeedChart, updateAltitudeChart, updateTrips, viewTrip };
})();
