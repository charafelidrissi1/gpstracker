const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
  const SQL = await initSqlJs();
  const dbPath = '/root/trackpulse/tracking.db';
  const filebuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(filebuffer);

  const imei = '350317170767788';
  console.log(`Checking data for IMEI: ${imei}`);

  const deviceStmt = db.prepare(`SELECT id, name, last_seen, status FROM devices WHERE imei = '${imei}'`);
  const deviceRows = [];
  while (deviceStmt.step()) {
    deviceRows.push(deviceStmt.getAsObject());
  }
  deviceStmt.free();
  console.log('Device info:', JSON.stringify(deviceRows, null, 2));

  if (deviceRows.length > 0) {
    const deviceId = deviceRows[0].id;
    const posStmt = db.prepare(`SELECT latitude, longitude, altitude, speed, satellites, timestamp FROM positions WHERE device_id = ${deviceId} ORDER BY timestamp DESC LIMIT 10`);
    const posRows = [];
    while (posStmt.step()) {
      posRows.push(posStmt.getAsObject());
    }
    posStmt.free();
    console.log('Latest positions:', JSON.stringify(posRows, null, 2));
  } else {
    console.log('Device not found in database.');
  }
}

check().catch(console.error);
