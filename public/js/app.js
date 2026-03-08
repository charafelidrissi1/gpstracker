/**
 * App Orchestrator — Initializes all modules, WebSocket, and panel switching.
 */
(function () {
  // Panel navigation
  const navBtns = document.querySelectorAll('.nav-btn');
  const panels = document.querySelectorAll('.panel');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.panel;
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      panels.forEach(p => {
        p.classList.toggle('active', p.id === `panel-${target}`);
      });
      if (target === 'map') MapModule.invalidateSize();
      if (target === 'analysis') AnalysisModule.initCharts();
    });
  });

  // Init map
  MapModule.init();

  // Init analysis charts (lazy — on panel switch)

  // WebSocket connection
  let ws = null;
  let reconnectTimer = null;

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWSStatus('connected', 'Connected');
      clearTimeout(reconnectTimer);
      loadDevices();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (e) { /* ignore */ }
    };

    ws.onclose = () => {
      setWSStatus('disconnected', 'Disconnected');
      reconnectTimer = setTimeout(connectWS, 3000);
    };

    ws.onerror = () => {
      setWSStatus('error', 'Error');
    };
  }

  function setWSStatus(state, text) {
    const dot = document.querySelector('#ws-status .status-dot');
    const label = document.querySelector('#ws-status .status-text');
    dot.className = 'status-dot';
    if (state === 'connected') dot.classList.add('connected');
    else if (state === 'error') dot.classList.add('error');
    label.textContent = text;
  }

  function handleMessage(data) {
    switch (data.type) {
      case 'position':
        MapModule.updateVehicle(data.deviceId, data);
        SidebarModule.updateDevice(data);
        break;
      case 'device_online':
        loadDevices();
        break;
      case 'device_offline':
        SidebarModule.markOffline(data.deviceId);
        break;
    }
  }

  async function loadDevices() {
    try {
      const devices = await fetch('/api/devices').then(r => r.json());
      SidebarModule.setDevices(devices);
      devices.forEach(d => {
        if (d.lastPosition) {
          MapModule.updateVehicle(d.id, { ...d.lastPosition, deviceId: d.id, imei: d.imei, name: d.name });
        }
      });
      // Auto-fit map to show all devices
      MapModule.fitAllMarkers();
    } catch (e) { console.error('Failed to load devices:', e); }
  }

  // Analysis: load button
  document.getElementById('analysis-load')?.addEventListener('click', () => {
    const deviceId = document.getElementById('analysis-device').value;
    const from = document.getElementById('analysis-from').value;
    const to = document.getElementById('analysis-to').value;
    if (!deviceId) { alert('Please select a device'); return; }
    const fromISO = from ? new Date(from).toISOString() : new Date(Date.now() - 86400000).toISOString();
    const toISO = to ? new Date(to).toISOString() : new Date().toISOString();
    AnalysisModule.loadData(deviceId, fromISO, toISO);
  });

  // Set default date range
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const fmtLocal = d => d.toISOString().slice(0, 16);
  const fromEl = document.getElementById('analysis-from');
  const toEl = document.getElementById('analysis-to');
  if (fromEl) fromEl.value = fmtLocal(yesterday);
  if (toEl) toEl.value = fmtLocal(now);

  // ── Settings Logic ──
  const settings = {
    showTrails: localStorage.getItem('trackpulse_showTrails') !== 'false',
    mapTheme: localStorage.getItem('trackpulse_mapTheme') || 'carto-dark'
  };

  // Init settings UI
  document.getElementById('setting-show-trails').checked = settings.showTrails;
  const themeSelect = document.getElementById('setting-map-theme');
  if (themeSelect) themeSelect.value = settings.mapTheme;
  
  // Apply initial settings to map
  MapModule.setTrailsVisibility(settings.showTrails);
  MapModule.setTheme(settings.mapTheme);

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const showTrails = document.getElementById('setting-show-trails').checked;
    const mapTheme = document.getElementById('setting-map-theme').value;

    localStorage.setItem('trackpulse_showTrails', showTrails);
    localStorage.setItem('trackpulse_mapTheme', mapTheme);

    // Apply settings
    MapModule.setTrailsVisibility(showTrails);
    MapModule.setTheme(mapTheme);
    
    const msg = document.getElementById('settings-message');
    msg.textContent = 'Settings saved successfully';
    msg.className = 'form-message success';
    setTimeout(() => msg.style.display = 'none', 3000);
  });

  // ── Add Device Logic ──
  document.getElementById('btn-add-device')?.addEventListener('click', async () => {
    const imeiInput = document.getElementById('new-device-imei');
    const nameInput = document.getElementById('new-device-name');
    const msg = document.getElementById('add-device-message');
    
    const imei = imeiInput.value.trim();
    const name = nameInput.value.trim();

    if (!imei) {
      msg.textContent = 'IMEI is required';
      msg.className = 'form-message error';
      return;
    }

    try {
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ imei, name })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add device');
      }

      const newDevice = await res.json();
      
      msg.textContent = `Device added successfully! (ID: ${newDevice.id})`;
      msg.className = 'form-message success';
      
      imeiInput.value = '';
      nameInput.value = '';

      // Reload device list
      loadDevices();
      
      setTimeout(() => msg.style.display = 'none', 3000);
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-message error';
    }
  });

  // Start WebSocket
  connectWS();
})();
