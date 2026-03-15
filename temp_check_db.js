const SQL = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const dbPath = '/root/trackpulse/tracking.db';
  const filebuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(filebuffer);

  const imei = '350317170767788';
  console.log(`Checking data for IMEI: ${imei}`);

  const device = db.exec(`SELECT id, name, last_update FROM devices WHERE imei = '${imei}'`);
  console.log('Device info:', JSON.stringify(device, null, 2));

  if (device.length > 0 && device[0].values.length > 0) {
    const deviceId = device[0].values[0][0];
    const positions = db.exec(`SELECT latitude, longitude, altitude, speed, satellites, timestamp FROM positions WHERE device_id = ${deviceId} ORDER BY timestamp DESC LIMIT 5`);
    console.log('Latest positions:', JSON.stringify(positions, null, 2));
  } else {
    console.log('Device not found in database.');
  }
}

check().catch(console.error);
