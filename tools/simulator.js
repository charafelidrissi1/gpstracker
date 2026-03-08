/**
 * Teltonika Device Simulator
 * Generates valid Codec 8 AVL data packets and sends them to the TCP server.
 * Simulates a vehicle moving along a route for testing.
 */

const net = require('net');

const HOST = process.env.SIM_HOST || '127.0.0.1';
const PORT = parseInt(process.env.SIM_PORT) || 5027;
const IMEI = process.env.SIM_IMEI || '352093089032178';
const INTERVAL = parseInt(process.env.SIM_INTERVAL) || 3000;

// Simulated route: loop around Vilnius (Teltonika HQ city)
const ROUTE = [
  { lat: 54.6872, lng: 25.2797, speed: 0 },
  { lat: 54.6880, lng: 25.2810, speed: 25 },
  { lat: 54.6895, lng: 25.2830, speed: 45 },
  { lat: 54.6910, lng: 25.2860, speed: 60 },
  { lat: 54.6925, lng: 25.2880, speed: 55 },
  { lat: 54.6940, lng: 25.2870, speed: 50 },
  { lat: 54.6950, lng: 25.2840, speed: 65 },
  { lat: 54.6955, lng: 25.2800, speed: 70 },
  { lat: 54.6945, lng: 25.2770, speed: 55 },
  { lat: 54.6930, lng: 25.2750, speed: 40 },
  { lat: 54.6915, lng: 25.2740, speed: 35 },
  { lat: 54.6900, lng: 25.2760, speed: 30 },
  { lat: 54.6885, lng: 25.2780, speed: 20 },
  { lat: 54.6872, lng: 25.2797, speed: 5 },
  { lat: 54.6872, lng: 25.2797, speed: 0 },
];

let routeIndex = 0;
let tripCount = 0;

function buildIMEIPacket(imei) {
  const imeiBytes = Buffer.from(imei, 'ascii');
  const buf = Buffer.alloc(2 + imeiBytes.length);
  buf.writeUInt16BE(imeiBytes.length, 0);
  imeiBytes.copy(buf, 2);
  return buf;
}

function crc16IBM(data) {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc;
}

function buildCodec8Data(lat, lng, speed, angle, altitude, satellites, fuel, odo) {
  // Build the AVL record first
  const parts = [];

  // Timestamp (8 bytes)
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(Date.now()), 0);
  parts.push(tsBuf);

  // Priority (1 byte)
  parts.push(Buffer.from([0x01]));

  // GPS Element (15 bytes): lon(4) lat(4) alt(2) angle(2) sats(1) speed(2)
  const gpsBuf = Buffer.alloc(15);
  gpsBuf.writeInt32BE(Math.round(lng * 1e7), 0);
  gpsBuf.writeInt32BE(Math.round(lat * 1e7), 4);
  gpsBuf.writeInt16BE(altitude, 8);
  gpsBuf.writeUInt16BE(angle, 10);
  gpsBuf.writeUInt8(satellites, 12);
  gpsBuf.writeUInt16BE(speed, 13);
  parts.push(gpsBuf);

  // IO Element (Codec 8)
  const ioParts = [];
  // Event IO ID (1 byte)
  ioParts.push(Buffer.from([0x00]));
  // Total IO count (1 byte): 3 from 1b, 2 from 2b, 4 from 4b = 9 properties total
  ioParts.push(Buffer.from([0x09]));

  // N1 group: 3 x 1-byte values
  ioParts.push(Buffer.from([0x03])); // count=3
  ioParts.push(Buffer.from([239, speed > 0 ? 1 : 0]));   // Ignition
  ioParts.push(Buffer.from([240, speed > 3 ? 1 : 0]));   // Movement
  ioParts.push(Buffer.from([9, fuel]));                  // Analog Input 1 (Fuel %)

  // N2 group: 2 x 2-byte values
  const n2Buf = Buffer.alloc(1 + 2 * 3);
  let o = 0;
  n2Buf.writeUInt8(2, o); o += 1;
  n2Buf.writeUInt8(66, o); o += 1;  // External Voltage
  n2Buf.writeUInt16BE(12400 + Math.floor(Math.random() * 200), o); o += 2;
  n2Buf.writeUInt8(24, o); o += 1;  // Speed IO
  n2Buf.writeUInt16BE(speed, o); o += 2;
  ioParts.push(n2Buf);

  // N4 group: 2 x 4-byte values (Odometers)
  const n4Buf = Buffer.alloc(1 + 5 * 2); // 1 byte for count, 2 items * (1 byte ID + 4 bytes value)
  let n4o = 0;
  n4Buf.writeUInt8(2, n4o); n4o += 1; // Count of 4-byte IO elements
  n4Buf.writeUInt8(16, n4o); n4o += 1; // GPS Odometer ID
  n4Buf.writeUInt32BE(Math.floor(odo), n4o); n4o += 4;
  n4Buf.writeUInt8(87, n4o); n4o += 1; // CAN Odometer ID
  n4Buf.writeUInt32BE(Math.floor(odo), n4o); n4o += 4;
  ioParts.push(n4Buf);

  // N8 group: 0 items
  ioParts.push(Buffer.from([0x00]));

  const avlRecord = Buffer.concat([...parts, ...ioParts]);

  // Build data field: codecId(1) + numData1(1) + records + numData2(1)
  const dataField = Buffer.concat([
    Buffer.from([0x08]),  // Codec 8
    Buffer.from([0x01]),  // Number of Data 1 = 1
    avlRecord,
    Buffer.from([0x01])   // Number of Data 2 = 1
  ]);

  // CRC over data field
  const crc = crc16IBM(dataField);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  // Preamble (4 bytes of 0) + Data Length (4 bytes) + Data + CRC
  const preamble = Buffer.alloc(4);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(dataField.length, 0);

  return Buffer.concat([preamble, lenBuf, dataField, crcBuf]);
}

function startSimulator() {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  TELTONIKA DEVICE SIMULATOR`);
  console.log(`${'='.repeat(50)}`);
  console.log(`  Server : ${HOST}:${PORT}`);
  console.log(`  IMEI   : ${IMEI}`);
  console.log(`  Rate   : every ${INTERVAL}ms`);
  console.log(`${'='.repeat(50)}\n`);

  const client = new net.Socket();
  let authenticated = false;
  let intervalHandle = null;

  client.connect(PORT, HOST, () => {
    console.log('Connected to TCP server');
    client.write(buildIMEIPacket(IMEI));
    console.log(`Sent IMEI: ${IMEI}`);
  });

  // Initial position and state for continuous simulation
  let LATITUDE = 54.6872;
  let LONGITUDE = 25.2797;
  let SPEED = 0; // km/h
  let HEADING = 0; // degrees
  let odoParams = { odo: 15420000 }; // Starts at 15420 km (in meters)

  client.on('data', (data) => {
    if (!authenticated) {
      if (data.readUInt8(0) === 0x01) {
        console.log('IMEI accepted by server\n');
        authenticated = true;

        intervalHandle = setInterval(() => {
          // Calculate new position based on current speed and heading
          let bearingRadians = (HEADING * Math.PI) / 180;
          let speedMps = (SPEED * 1000) / 3600; // Convert km/h to m/s
          let distanceMeters = speedMps * (INTERVAL / 1000); // Distance traveled in meters during INTERVAL

          odoParams.odo += distanceMeters; // Update odometer

          const R = 6371e3; // Earth's radius in meters
          let lat1 = (LATITUDE * Math.PI) / 180;
          let lon1 = (LONGITUDE * Math.PI) / 180;

          let lat2 = Math.asin(Math.sin(lat1) * Math.cos(distanceMeters / R) +
            Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(bearingRadians));
          let lon2 = lon1 + Math.atan2(Math.sin(bearingRadians) * Math.sin(distanceMeters / R) * Math.cos(lat1),
            Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2));

          LATITUDE = (lat2 * 180) / Math.PI;
          LONGITUDE = (lon2 * 180) / Math.PI;

          // Randomly adjust heading and speed
          HEADING = (HEADING + (Math.random() * 20 - 10)) % 360; // +/- 10 degrees
          if (HEADING < 0) HEADING += 360;

          SPEED = Math.max(0, Math.min(120, SPEED + (Math.random() * 10 - 5))); // +/- 5 km/h, max 120 km/h

          // Calculate fuel consumption based on odometer
          let fuel = Math.max(0, 85 - (odoParams.odo - 15420000) / 500 * 2); // Starts at 85%, consumes 2% every 500m after initial odo

          const payload = buildCodec8Data(
            LATITUDE,
            LONGITUDE,
            Math.floor(SPEED),
            Math.floor(HEADING),
            150, // Altitude
            Math.floor(Math.random() * 5 + 10), // Satellites
            Math.floor(fuel),
            odoParams.odo
          );

          client.write(payload);
          console.log(`Pos: (${LATITUDE.toFixed(5)}, ${LONGITUDE.toFixed(5)}) Spd: ${Math.floor(SPEED)}km/h Hdg: ${Math.floor(HEADING)}deg, Fuel: ${Math.floor(fuel)}%, Odo: ${Math.floor(odoParams.odo / 1000)}km`);

        }, INTERVAL);
      } else {
        console.log('IMEI rejected'); client.destroy();
      }
    }
  });

  client.on('close', () => { console.log('Disconnected'); if (intervalHandle) clearInterval(intervalHandle); });
  client.on('error', (e) => { console.error('Error:', e.message); if (intervalHandle) clearInterval(intervalHandle); });
}

startSimulator();
