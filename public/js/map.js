/**
 * Map Module — Leaflet map with dark tiles, vehicle markers, and trails.
 */

const MapModule = (() => {
  let map = null;
  let currentTileLayer = null;
  let markers = {};    // deviceId -> marker
  let trails = {};     // deviceId -> polyline
  let trailCoords = {}; // deviceId -> [latlng]

  const MAP_TILES = {
    'google-streets': {
      url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attr: '&copy; Google Maps'
    },
    'google-hybrid': {
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attr: '&copy; Google Maps'
    }
  };

  // Vehicle icon SVG
  function createVehicleIcon(angle) {
    return L.divIcon({
      className: 'vehicle-marker-wrapper',
      html: `
        <div class="vehicle-marker">
          <div class="vehicle-marker-pulse"></div>
          <div class="vehicle-marker-inner" style="transform: rotate(${angle || 0}deg)">
            <svg viewBox="0 0 24 24"><path d="M12 2L4 20h16L12 2z"/></svg>
          </div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -20]
    });
  }

  function init() {
    map = L.map('map', {
      center: [54.6872, 25.2797], // Vilnius default
      zoom: 13,
      zoomControl: true,
      attributionControl: true
    });

    const savedMapTheme = localStorage.getItem('trackpulse_mapTheme') || 'google-streets';
    setTheme(savedMapTheme);

    // Fix map sizing
    setTimeout(() => map.invalidateSize(), 200);
  }

  function setTheme(theme) {
    if (!map) return;
    
    if (currentTileLayer) {
      map.removeLayer(currentTileLayer);
    }
    
    // Always fallback to google-streets if theme is invalid/missing
    const tileSpec = MAP_TILES[theme] || MAP_TILES['google-streets'];
    currentTileLayer = L.tileLayer(tileSpec.url, {
      attribution: tileSpec.attr,
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);
    
    // All popups are light now for consistency
    for (const id in markers) {
        const popup = markers[id].getPopup();
        if (popup) {
            popup.options.className = 'light-popup';
        }
    }
  }

  function updateVehicle(deviceId, data) {
    const latlng = [data.lat, data.lng];

    if (markers[deviceId]) {
      // Update existing marker
      markers[deviceId].setLatLng(latlng);
      markers[deviceId].setIcon(createVehicleIcon(data.angle));

      // Update popup
      markers[deviceId].setPopupContent(buildPopup(data));
    } else {
      // Create new marker
      const marker = L.marker(latlng, {
        icon: createVehicleIcon(data.angle)
      }).addTo(map);

      marker.bindPopup(buildPopup(data), {
        className: 'dark-popup'
      });

      markers[deviceId] = marker;

      // Create trail
      trails[deviceId] = L.polyline([], {
        color: '#00d4aa',
        weight: 3,
        opacity: 0.6,
        smoothFactor: 1
      }).addTo(map);
      trailCoords[deviceId] = [];
    }

    // Add to trail
    if (!trailCoords[deviceId]) trailCoords[deviceId] = [];
    trailCoords[deviceId].push(latlng);

    // Keep trail to last 500 points
    if (trailCoords[deviceId].length > 500) {
      trailCoords[deviceId] = trailCoords[deviceId].slice(-500);
    }

    if (trails[deviceId]) {
      trails[deviceId].setLatLngs(trailCoords[deviceId]);
    }
  }

  function buildPopup(data) {
    return `
      <div style="font-family: var(--font-sans); color: var(--text-primary); min-width: 180px;">
        <div style="font-weight: 700; font-size: 14px; margin-bottom: 8px; color: var(--accent);">
          ${data.name || data.imei || `Device ${data.deviceId}`}
        </div>
        <div style="font-size: 12px; line-height: 1.6;">
          <div style="color: var(--text-secondary);">📍 ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}</div>
          <div style="color: var(--text-secondary);">🚀 ${data.speed} km/h</div>
          <div style="color: var(--text-secondary);">🧭 ${data.angle}°</div>
          <div style="color: var(--text-secondary);">📡 ${data.satellites} sats</div>
          <div style="color: var(--text-secondary);">🏔️ ${data.altitude}m</div>
        </div>
      </div>
    `;
  }

  function focusDevice(deviceId) {
    if (markers[deviceId]) {
      const latlng = markers[deviceId].getLatLng();
      map.setView(latlng, 16, { animate: true });
      markers[deviceId].openPopup();
    }
  }

  function showHistory(positions) {
    // Clear old history layer if exists
    if (window._historyLayer) {
      map.removeLayer(window._historyLayer);
    }

    if (positions.length === 0) return;

    const latlngs = positions.map(p => [p.latitude, p.longitude]);
    window._historyLayer = L.polyline(latlngs, {
      color: '#3b82f6',
      weight: 3,
      opacity: 0.7,
      dashArray: '8 4'
    }).addTo(map);

    map.fitBounds(window._historyLayer.getBounds(), { padding: [50, 50] });
  }

  function setTrailsVisibility(visible) {
    for (const id in trails) {
      if (visible) {
        if (!map.hasLayer(trails[id])) {
          trails[id].addTo(map);
        }
      } else {
        if (map.hasLayer(trails[id])) {
          map.removeLayer(trails[id]);
        }
      }
    }
  }

  function invalidateSize() {
    if (map) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  }

  function fitAllMarkers() {
    const markerKeys = Object.keys(markers);
    if (markerKeys.length === 0) return;
    if (markerKeys.length === 1) {
      map.setView(markers[markerKeys[0]].getLatLng(), 15, { animate: true });
      return;
    }
    const group = L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds(), { padding: [50, 50], animate: true });
  }

  return { init, updateVehicle, focusDevice, showHistory, invalidateSize, setTrailsVisibility, setTheme, fitAllMarkers };
})();
