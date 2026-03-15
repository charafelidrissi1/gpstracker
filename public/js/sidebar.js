/**
 * Sidebar Module — Device list management.
 */
const SidebarModule = (() => {
  let devices = [];
  let selectedId = null;
  let searchQuery = '';

  function render() {
    const list = document.getElementById('device-list');
    if (!list) return;
    if (devices.length === 0) {
      list.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><p>No devices connected</p><p class="hint">Start the simulator or connect a Teltonika device</p></div>`;
      return;
    }

    let filtered = devices;
    if (searchQuery) {
      filtered = devices.filter(d => {
        const name = (d.name || '').toLowerCase();
        const imei = (d.imei || '').toLowerCase();
        const idStr = String(d.id);
        return name.includes(searchQuery) || imei.includes(searchQuery) || idStr.includes(searchQuery);
      });
    }

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No devices found</p><p class="hint">Try a different search term</p></div>`;
      return;
    }

      return `<div class="device-card ${isSelected ? 'selected' : ''}" data-device-id="${d.id}" onclick="SidebarModule.select(${d.id})">
        <div class="device-card-header">
          <div class="device-card-header-main">
            <span class="device-card-dot ${statusClass}"></span>
            <span class="device-card-name">${d.name || d.imei || 'Device ' + d.id}</span>
          </div>
          <div class="device-card-actions">
            <button class="btn-edit-device" onclick="event.stopPropagation(); SidebarModule.renameDevice(${d.id})" title="Edit Name">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="btn-delete-device" onclick="event.stopPropagation(); SidebarModule.deleteDevice(${d.id})" title="Delete Device">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="device-card-details">
          <div class="device-card-detail"><span class="label">Speed</span><span class="val">${pos?.speed ?? '--'} km/h</span></div>
          <div class="device-card-detail"><span class="label">Sats</span><span class="val">${pos?.satellites ?? '--'}</span></div>
          <div class="device-card-detail"><span class="label">IMEI</span><span class="val">${d.imei?.slice(-8) || '--'}</span></div>
          <div class="device-card-detail"><span class="label">Updated</span><span class="val">${pos?.timestamp ? new Date(pos.timestamp).toLocaleTimeString() : '--'}</span></div>
        </div>
      </div>`;
    }).join('');
  }

  function setDevices(devList) {
    devices = devList;
    render();
    document.getElementById('device-count').querySelector('span').textContent = `${devices.length} device${devices.length !== 1 ? 's' : ''}`;
    // Populate analysis select
    const sel = document.getElementById('analysis-device');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">Select a device</option>' + devices.map(d => `<option value="${d.id}" ${String(d.id) === cur ? 'selected' : ''}>${d.name || d.imei || 'Device ' + d.id}</option>`).join('');
    }
  }

  function updateDevice(data) {
    const idx = devices.findIndex(d => d.id === data.deviceId);
    if (idx >= 0) {
      devices[idx].lastPosition = { lat: data.lat, lng: data.lng, speed: data.speed, angle: data.angle, altitude: data.altitude, satellites: data.satellites, timestamp: data.timestamp };
      devices[idx].status = 'online';
    } else {
      devices.push({ id: data.deviceId, imei: data.imei, name: data.name, status: 'online', lastPosition: { lat: data.lat, lng: data.lng, speed: data.speed, angle: data.angle, altitude: data.altitude, satellites: data.satellites, timestamp: data.timestamp } });
    }
    render();
    if (data.deviceId === selectedId || (selectedId === null && devices.length === 1)) {
      if (selectedId === null) selectedId = data.deviceId;
      HUDModule.updateFromPosition(data);
    }
  }

  function select(id) {
    selectedId = id;
    render();
    const device = devices.find(d => d.id === id);
    if (device) {
      MapModule.focusDevice(id);
      if (device.lastPosition) {
        HUDModule.updateFromPosition({ ...device.lastPosition, imei: device.imei, name: device.name, status: device.status, deviceId: id });
      }
    }
  }

  function markOffline(deviceId) {
    const d = devices.find(x => x.id === deviceId);
    if (d) { d.status = 'offline'; render(); }
  }

  function getSelected() { return selectedId; }

  async function renameDevice(id) {
    const device = devices.find(d => d.id === id);
    if (!device) return;
    
    const newName = window.prompt(`Enter a new name for ${device.imei}:`, device.name || '');
    if (newName === null || newName.trim() === '') return;

    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() })
      });
      if (!res.ok) throw new Error('Failed to rename device');
      
      const updatedDevice = await res.json();
      
      // Update local state
      device.name = updatedDevice.name;
      render();
      
      // If selected, refresh HUD
      if (selectedId === id) {
          HUDModule.updateFromPosition({ ...device.lastPosition, imei: device.imei, name: device.name, status: device.status, deviceId: id });
      }
      
      // Update analysis select
      setDevices(devices);
      
    } catch (err) {
      alert(`Error renaming device: ${err.message}`);
    }
  }

  async function deleteDevice(id) {
    const device = devices.find(d => d.id === id);
    if (!device) return;

    const confirm = window.confirm(`Are you sure you want to completely delete device: ${device.name || device.imei}? All history will be lost.`);
    if (!confirm) return;

    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'DELETE'
      });
      
      if (!res.ok) throw new Error('Failed to delete device');

      // Update local state
      devices = devices.filter(d => d.id !== id);
      
      if (selectedId === id) {
        selectedId = null;
        // Optionally select first available device
        if (devices.length > 0) {
          select(devices[0].id);
        }
      }
      
      setDevices(devices); // Re-render everything
      
    } catch (err) {
      alert(`Error deleting device: ${err.message}`);
    }
  }

  // Event Listeners
  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('device-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        render();
      });
    }

    const btn = document.getElementById('sidebar-toggle');
    const sb = document.getElementById('sidebar');
    if (btn && sb) {
      btn.addEventListener('click', () => {
        sb.classList.toggle('collapsed');
        // Let CSS transition finish before redrawing the map
        setTimeout(() => {
          if (typeof MapModule !== 'undefined') MapModule.invalidateSize();
        }, 400); 
      });
    }
  });

  return { setDevices, updateDevice, select, markOffline, getSelected, renameDevice, deleteDevice, render };
})();
