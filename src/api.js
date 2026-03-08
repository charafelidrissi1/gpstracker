/**
 * REST API Server
 * Provides HTTP endpoints for the dashboard frontend.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

function createAPI(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve static frontend files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ── Device Endpoints ──

  app.get('/api/devices', (req, res) => {
    try {
      const devices = db.getAllDevices();
      const positions = db.getAllLatestPositions();

      const devicesWithPosition = devices.map(device => {
        const pos = positions.find(p => p.device_id === device.id);
        return {
          ...device,
          lastPosition: pos ? {
            lat: pos.latitude,
            lng: pos.longitude,
            speed: pos.speed,
            angle: pos.angle,
            altitude: pos.altitude,
            satellites: pos.satellites,
            timestamp: pos.timestamp,
            io_data: JSON.parse(pos.io_data || '{}')
          } : null
        };
      });

      res.json(devicesWithPosition);
    } catch (err) {
      console.error('API error (GET /devices):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/devices', (req, res) => {
    try {
      const { imei, name } = req.body;
      if (!imei) {
        return res.status(400).json({ error: 'IMEI is required' });
      }
      
      const existing = db.getDeviceByIMEI(imei);
      if (existing) {
        return res.status(409).json({ error: 'Device with this IMEI already exists' });
      }

      db.upsertDevice(imei);
      
      // If a name was provided, update it right after created
      if (name) {
        const newDevice = db.getDeviceByIMEI(imei);
        if (newDevice) {
          db.updateDeviceName(newDevice.id, name);
        }
      }
      
      const created = db.getDeviceByIMEI(imei);
      res.status(201).json(created);
    } catch (err) {
      console.error('API error (POST /devices):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/devices/:id', (req, res) => {
    try {
      const { name } = req.body;
      db.updateDeviceName(parseInt(req.params.id), name);
      const device = db.getDevice(parseInt(req.params.id));
      res.json(device);
    } catch (err) {
      console.error('API error (PUT /devices/:id):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/devices/:id', (req, res) => {
    try {
      db.deleteDevice(parseInt(req.params.id));
      res.json({ success: true, message: 'Device deleted' });
    } catch (err) {
      console.error('API error (DELETE /devices/:id):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Position Endpoints ──

  app.get('/api/devices/:id/positions', (req, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const { from, to, limit } = req.query;

      let positions;
      if (from && to) {
        positions = db.getPositionHistory(deviceId, from, to);
      } else {
        positions = db.getRecentPositions(deviceId, parseInt(limit) || 200);
      }

      positions = positions.map(p => ({
        ...p,
        io_data: JSON.parse(p.io_data || '{}')
      }));

      res.json(positions);
    } catch (err) {
      console.error('API error (GET /positions):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Trip Endpoints ──

  app.get('/api/devices/:id/trips', (req, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const { from, to, limit } = req.query;

      let trips;
      if (from && to) {
        trips = db.getTrips(deviceId, from, to);
      } else {
        trips = db.getRecentTrips(deviceId, parseInt(limit) || 50);
      }

      res.json(trips);
    } catch (err) {
      console.error('API error (GET /trips):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Analytics Endpoints ──

  app.get('/api/devices/:id/analytics', (req, res) => {
    try {
      const deviceId = parseInt(req.params.id);
      const { from, to } = req.query;

      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const defaultTo = now.toISOString();

      const analytics = db.getAnalytics(deviceId, from || defaultFrom, to || defaultTo);
      const speedHistory = db.getSpeedHistory(deviceId, from || defaultFrom, to || defaultTo);

      res.json({ ...analytics, speedHistory });
    } catch (err) {
      console.error('API error (GET /analytics):', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Fallback to index.html for SPA ──
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  return app;
}

module.exports = createAPI;
