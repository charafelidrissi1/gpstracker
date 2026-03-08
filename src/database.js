/**
 * SQLite Database Layer (using sql.js — pure JavaScript)
 * Manages device, position, and trip data storage.
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class DB {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, '..', 'tracking.db');
    this.ready = false;
  }

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const buf = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(buf);
    } else {
      this.db = new SQL.Database();
    }
    this._createTables();
    this.ready = true;
    // Auto-save every 10 seconds
    this._saveInterval = setInterval(() => this._save(), 10000);
  }

  _save() {
    if (!this.db) return;
    const data = this.db.export();
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  }

  _createTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        imei TEXT UNIQUE NOT NULL,
        name TEXT DEFAULT '',
        last_seen DATETIME,
        status TEXT DEFAULT 'offline',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        timestamp DATETIME NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        altitude INTEGER DEFAULT 0,
        speed INTEGER DEFAULT 0,
        angle INTEGER DEFAULT 0,
        satellites INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        io_data TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER NOT NULL,
        start_time DATETIME NOT NULL,
        end_time DATETIME,
        start_lat REAL, start_lng REAL,
        end_lat REAL, end_lng REAL,
        distance REAL DEFAULT 0,
        max_speed INTEGER DEFAULT 0,
        avg_speed REAL DEFAULT 0,
        duration_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (device_id) REFERENCES devices(id)
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pos_dev ON positions(device_id, timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pos_ts ON positions(timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_trips ON trips(device_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_imei ON devices(imei)');
  }

  _all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  _get(sql, params = []) {
    const rows = this._all(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  _run(sql, params = []) {
    this.db.run(sql, params);
    return { lastId: this._get('SELECT last_insert_rowid() as id')?.id };
  }

  // ── Devices ──
  upsertDevice(imei) {
    const existing = this._get('SELECT * FROM devices WHERE imei = ?', [imei]);
    if (existing) {
      this._run("UPDATE devices SET last_seen = datetime('now'), status = 'online' WHERE imei = ?", [imei]);
    } else {
      this._run("INSERT INTO devices (imei, last_seen, status) VALUES (?, datetime('now'), 'online')", [imei]);
    }
    return this._get('SELECT * FROM devices WHERE imei = ?', [imei]);
  }

  getDevice(id) { return this._get('SELECT * FROM devices WHERE id = ?', [id]); }
  getDeviceByIMEI(imei) { return this._get('SELECT * FROM devices WHERE imei = ?', [imei]); }
  getAllDevices() { return this._all('SELECT * FROM devices ORDER BY last_seen DESC'); }
  updateDeviceName(id, name) { this._run('UPDATE devices SET name = ? WHERE id = ?', [name, id]); }
  setDeviceOffline(imei) { this._run("UPDATE devices SET status = 'offline' WHERE imei = ?", [imei]); }
  
  deleteDevice(id) {
    this._run('DELETE FROM positions WHERE device_id = ?', [id]);
    this._run('DELETE FROM trips WHERE device_id = ?', [id]);
    this._run('DELETE FROM devices WHERE id = ?', [id]);
  }

  // ── Positions ──
  insertPosition(deviceId, record) {
    const { timestamp, timestampMs, priority, gps, io } = record;
    this._run(
      'INSERT INTO positions (device_id, timestamp, timestamp_ms, latitude, longitude, altitude, speed, angle, satellites, priority, io_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [deviceId, timestamp.toISOString(), timestampMs, gps.latitude, gps.longitude, gps.altitude, gps.speed, gps.angle, gps.satellites, priority, JSON.stringify(io || {})]
    );
  }

  getLatestPosition(deviceId) {
    return this._get('SELECT p.*, d.imei, d.name as device_name FROM positions p JOIN devices d ON d.id = p.device_id WHERE p.device_id = ? ORDER BY p.timestamp DESC LIMIT 1', [deviceId]);
  }

  getAllLatestPositions() {
    return this._all('SELECT p.*, d.imei, d.name as device_name, d.status FROM positions p JOIN devices d ON d.id = p.device_id WHERE p.id IN (SELECT MAX(id) FROM positions GROUP BY device_id) ORDER BY d.last_seen DESC');
  }

  getPositionHistory(deviceId, from, to) {
    return this._all('SELECT * FROM positions WHERE device_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC', [deviceId, from, to]);
  }

  getRecentPositions(deviceId, limit = 200) {
    return this._all('SELECT * FROM positions WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?', [deviceId, limit]);
  }

  // ── Trips ──
  startTrip(deviceId, ts, lat, lng) {
    const r = this._run("INSERT INTO trips (device_id, start_time, start_lat, start_lng, status) VALUES (?,?,?,?,'active')", [deviceId, ts, lat, lng]);
    return r.lastId;
  }

  endTrip(tripId, endTime, endLat, endLng, distance, maxSpeed, avgSpeed, dur) {
    this._run("UPDATE trips SET end_time=?, end_lat=?, end_lng=?, distance=?, max_speed=?, avg_speed=?, duration_seconds=?, status='completed' WHERE id=?",
      [endTime, endLat, endLng, distance, maxSpeed, avgSpeed, dur, tripId]);
  }

  getActiveTrip(deviceId) { return this._get("SELECT * FROM trips WHERE device_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1", [deviceId]); }
  getTrips(deviceId, from, to) { return this._all('SELECT * FROM trips WHERE device_id = ? AND start_time BETWEEN ? AND ? ORDER BY start_time DESC', [deviceId, from, to]); }
  getRecentTrips(deviceId, limit = 50) { return this._all('SELECT * FROM trips WHERE device_id = ? ORDER BY start_time DESC LIMIT ?', [deviceId, limit]); }

  // ── Analytics ──
  getAnalytics(deviceId, from, to) {
    const positions = this.getPositionHistory(deviceId, from, to);
    if (positions.length === 0) return { totalDistance: 0, maxSpeed: 0, avgSpeed: 0, totalTime: 0, movingTime: 0, idleTime: 0, positionCount: 0 };
    let totalDistance = 0, maxSpeed = 0, speedSum = 0, movingTime = 0, idleTime = 0;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      if (p.speed > maxSpeed) maxSpeed = p.speed;
      speedSum += p.speed;
      if (i > 0) {
        const prev = positions[i - 1];
        totalDistance += DB._haversine(prev.latitude, prev.longitude, p.latitude, p.longitude);
        const dt = (new Date(p.timestamp) - new Date(prev.timestamp)) / 1000;
        if (p.speed > 2) movingTime += dt; else idleTime += dt;
      }
    }
    const totalTime = (new Date(positions[positions.length - 1].timestamp) - new Date(positions[0].timestamp)) / 1000;
    return { totalDistance: Math.round(totalDistance * 100) / 100, maxSpeed, avgSpeed: Math.round((speedSum / positions.length) * 100) / 100, totalTime: Math.round(totalTime), movingTime: Math.round(movingTime), idleTime: Math.round(idleTime), positionCount: positions.length };
  }

  getSpeedHistory(deviceId, from, to) {
    return this.getPositionHistory(deviceId, from, to).map(p => ({ timestamp: p.timestamp, speed: p.speed }));
  }

  static _haversine(lat1, lon1, lat2, lon2) {
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  close() { this._save(); clearInterval(this._saveInterval); this.db.close(); }
}

module.exports = DB;
