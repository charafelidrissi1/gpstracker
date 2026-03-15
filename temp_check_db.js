const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

async function check() {
  const SQL = await initSqlJs();
  const dbPath = '/root/trackpulse/tracking.db';
  const filebuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(filebuffer);

  console.log('--- ALL DEVICES ---');
  const allDevices = db.exec('SELECT * FROM devices');
  console.log(JSON.stringify(allDevices, null, 2));

  const imei = '350317170767788';
  console.log(`\n--- DATA FOR IMEI: ${imei} ---`);
  const specific = db.exec(`SELECT * FROM devices WHERE imei LIKE '%${imei.slice(-8)}%'`);
  console.log(JSON.stringify(specific, null, 2));

  if (specific.length > 0 && specific[0].values.length > 0) {
     for (const row of specific[0].values) {
        const id = row[0];
        const lastPos = db.exec(`SELECT * FROM positions WHERE device_id = ${id} ORDER BY timestamp DESC LIMIT 1`);
        console.log(`Last pos for ID ${id}:`, JSON.stringify(lastPos, null, 2));
     }
  }
}

check().catch(console.error);
