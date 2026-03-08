/**
 * Telematics HUD Module
 * Animated speedometer, compass, satellite display, and IO data.
 */

const HUDModule = (() => {
  let currentDevice = null;
  let maxSpeed = 0;

  // Speedometer arc math
  const ARC_START = -90;  // degrees (pointing left)
  const ARC_END = 90;     // degrees (pointing right)
  const ARC_LENGTH = 251.33; // approximate path length of the SVG arc
  const MAX_SPEED_GAUGE = 200; // km/h

  function updateSpeed(speed) {
    const speedValue = document.getElementById('speed-value');
    const speedArc = document.getElementById('speed-arc');
    const speedNeedle = document.getElementById('speed-needle');
    const speedMaxEl = document.getElementById('speed-max');

    if (!speedValue) return;

    // Animate value
    animateValue(speedValue, parseInt(speedValue.textContent) || 0, speed, 400);

    // Arc fill
    const ratio = Math.min(speed / MAX_SPEED_GAUGE, 1);
    const dashLen = ratio * ARC_LENGTH;
    speedArc.setAttribute('stroke-dasharray', `${dashLen} ${ARC_LENGTH}`);

    // Needle rotation (-90 to 90 degrees, mapped from left to right)
    const needleAngle = ARC_START + ratio * (ARC_END - ARC_START);
    speedNeedle.setAttribute('transform', `rotate(${needleAngle}, 100, 120)`);

    // Track max speed
    if (speed > maxSpeed) {
      maxSpeed = speed;
      speedMaxEl.textContent = `Max: ${maxSpeed} km/h`;
    }

    // Update map HUD
    const mapHudSpeed = document.querySelector('#map-hud-speed .map-hud-value');
    if (mapHudSpeed) mapHudSpeed.textContent = speed;
  }

  function updateHeading(angle) {
    const compassNeedle = document.getElementById('compass-needle');
    const compassValue = document.getElementById('compass-value');

    if (!compassNeedle) return;

    // Rotate the entire needle group
    compassNeedle.setAttribute('transform', `rotate(${angle}, 100, 100)`);
    // Also rotate the south needle
    const southNeedle = compassNeedle.nextElementSibling;
    if (southNeedle && southNeedle.tagName === 'polygon') {
      southNeedle.setAttribute('transform', `rotate(${angle}, 100, 100)`);
    }

    compassValue.textContent = `${angle}° ${getCardinal(angle)}`;

    // Update map HUD
    const mapHudHeading = document.querySelector('#map-hud-heading .map-hud-value');
    if (mapHudHeading) mapHudHeading.textContent = `${angle}°`;
  }

  function getCardinal(angle) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(angle / 45) % 8;
    return dirs[idx];
  }

  function updateAltitude(alt) {
    const el = document.querySelector('#hud-altitude .value');
    const bar = document.getElementById('altitude-bar');
    if (!el) return;

    el.textContent = alt;
    // Altitude bar (0-2000m range)
    const ratio = Math.min(alt / 2000, 1) * 100;
    bar.style.width = `${ratio}%`;
  }

  function updateSatellites(count) {
    const el = document.querySelector('#hud-satellites .value');
    const dotsContainer = document.getElementById('satellite-dots');
    if (!el) return;

    el.textContent = count;

    // Build satellite dots
    let html = '';
    for (let i = 0; i < 24; i++) {
      html += `<div class="sat-dot ${i < count ? 'active' : ''}"></div>`;
    }
    dotsContainer.innerHTML = html;

    // Update map HUD
    const mapHudSats = document.querySelector('#map-hud-sats .map-hud-value');
    if (mapHudSats) mapHudSats.textContent = count;
  }

  function updateIgnition(on) {
    const ring = document.querySelector('#hud-ignition .ignition-ring');
    const text = document.querySelector('#hud-ignition .ignition-text');
    if (!ring) return;

    ring.classList.toggle('on', on);
    ring.classList.toggle('off', !on);
    text.textContent = on ? 'ON' : 'OFF';
    text.style.color = on ? 'var(--accent)' : 'var(--text-muted)';
  }

  function updateBattery(voltage) {
    const el = document.querySelector('#hud-battery .value');
    const bar = document.getElementById('battery-bar');
    if (!el) return;

    // Voltage is usually in mV, convert to V
    const volts = voltage > 100 ? (voltage / 1000).toFixed(1) : voltage.toFixed(1);
    el.textContent = volts;

    // Battery bar (9V-15V range for vehicle battery)
    const v = voltage > 100 ? voltage / 1000 : voltage;
    const ratio = Math.min(Math.max((v - 9) / 6, 0), 1) * 100;
    bar.style.width = `${ratio}%`;
  }

  function updateFuel(level) {
    const el = document.querySelector('#hud-fuel .value');
    const bar = document.getElementById('fuel-bar');
    if (!el) return;

    el.textContent = Math.round(level);

    // Fuel bar (0-100%)
    const ratio = Math.min(Math.max(level, 0), 100);
    bar.style.width = `${ratio}%`;
  }

  function updateDeviceInfo(data) {
    document.getElementById('hud-imei').textContent = data.imei || '--';
    document.getElementById('hud-device-name').textContent = data.name || 'Unnamed';
    document.getElementById('hud-status').textContent = data.status || 'online';
    document.getElementById('hud-status').style.color = data.status === 'online' ? 'var(--accent)' : 'var(--text-muted)';
    document.getElementById('hud-last-update').textContent = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '--';
    document.getElementById('hud-position').textContent = data.lat && data.lng ? `${data.lat.toFixed(5)}, ${data.lng.toFixed(5)}` : '--';
  }

  function updateIOData(io) {
    const grid = document.getElementById('io-data-grid');
    if (!grid || !io) return;

    const ioNamed = io.ioNamed || {};
    const props = io.io?.properties || {};

    // Merge named and raw
    const items = {};
    for (const [key, val] of Object.entries(ioNamed)) {
      items[key] = val;
    }
    for (const [key, val] of Object.entries(props)) {
      if (!Object.values(ioNamed || {}).includes(val)) {
        items[`IO ${key}`] = val;
      }
    }

    if (Object.keys(items).length === 0) {
      grid.innerHTML = '<div class="empty-state small"><p>No IO data</p></div>';
      return;
    }

    let html = '';
    for (const [name, value] of Object.entries(items)) {
      html += `
        <div class="io-item">
           <span class="io-item-name">${name}</span>
           <span class="io-item-value">${value}</span>
        </div>
      `;
    }
    grid.innerHTML = html;
  }

  function updateFromPosition(data) {
    currentDevice = data;

    updateSpeed(data.speed || 0);
    updateHeading(data.angle || 0);
    updateAltitude(data.altitude || 0);
    updateSatellites(data.satellites || 0);

    // Extract IO values
    const io = data.io?.properties || data.ioNamed || {};
    const ignition = io['Ignition'] ?? io[239] ?? (data.speed > 0 ? 1 : 0);
    updateIgnition(!!ignition);

    const battery = io['External Voltage'] ?? io[66] ?? 0;
    if (battery) updateBattery(battery);

    const fuel = io['Analog Input 1'] ?? io[9] ?? null;
    if (fuel !== null) updateFuel(fuel);

    updateDeviceInfo(data);
    updateIOData(data);
  }

  function setDevice(deviceData) {
    currentDevice = deviceData;
    maxSpeed = 0;
    updateFromPosition(deviceData);
  }

  // Animate number change
  function animateValue(el, start, end, duration) {
    const range = end - start;
    if (range === 0) { el.textContent = end; return; }
    const startTime = performance.now();

    function step(timestamp) {
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease out cubic
      el.textContent = Math.round(start + range * eased);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  return { updateFromPosition, setDevice };
})();
