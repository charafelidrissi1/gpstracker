/**
 * Teltonika Codec 8 Parser — Unit Tests
 * Tests the parser against known reference data.
 */

const TeltonikaParser = require('../src/codec8');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (got ${actual}, expected ~${expected})`);
}

// ═══════════════════════════════════════════
// Test 1: IMEI Parsing
// ═══════════════════════════════════════════
console.log('\n📋 Test 1: IMEI Parsing');

const imei = '352093089032178';
const imeiBuffer = Buffer.alloc(2 + imei.length);
imeiBuffer.writeUInt16BE(imei.length, 0);
imeiBuffer.write(imei, 2, 'ascii');

const imeiResult = TeltonikaParser.parseIMEI(imeiBuffer);
assert(imeiResult !== null, 'IMEI parsed successfully');
assert(imeiResult.imei === imei, `IMEI value correct: ${imeiResult.imei}`);
assert(imeiResult.bytesRead === 2 + imei.length, `Bytes read: ${imeiResult.bytesRead}`);

// Incomplete IMEI
const incompleteIMEI = Buffer.from([0x00]);
assert(TeltonikaParser.parseIMEI(incompleteIMEI) === null, 'Incomplete IMEI returns null');

// ═══════════════════════════════════════════
// Test 2: CRC-16 IBM
// ═══════════════════════════════════════════
console.log('\n📋 Test 2: CRC-16/IBM');

// Test with known data
const testData = Buffer.from('123456789', 'ascii');
const crc = TeltonikaParser.crc16IBM(testData);
assert(crc === 0xBB3D, `CRC of "123456789" = 0x${crc.toString(16).toUpperCase()} (expected 0xBB3D)`);

// ═══════════════════════════════════════════
// Test 3: Codec 8 Packet Parsing
// ═══════════════════════════════════════════
console.log('\n📋 Test 3: Codec 8 Packet — Synthetic');

// Build a synthetic Codec 8 packet
function buildTestPacket() {
  const timestamp = BigInt(1609459200000); // 2021-01-01 00:00:00 UTC
  const priority = 1;
  const lon = Math.round(25.2797 * 1e7); // Vilnius
  const lat = Math.round(54.6872 * 1e7);
  const altitude = 150;
  const angle = 90;
  const satellites = 10;
  const speed = 55;

  // Build record
  const record = Buffer.alloc(8 + 1 + 15); // timestamp + priority + gps
  let off = 0;
  record.writeBigUInt64BE(timestamp, off); off += 8;
  record.writeUInt8(priority, off); off += 1;
  record.writeInt32BE(lon, off); off += 4;
  record.writeInt32BE(lat, off); off += 4;
  record.writeInt16BE(altitude, off); off += 2;
  record.writeUInt16BE(angle, off); off += 2;
  record.writeUInt8(satellites, off); off += 1;
  record.writeUInt16BE(speed, off); off += 2;

  // Minimal IO element
  const io = Buffer.from([
    0x00,       // Event IO ID
    0x00,       // Total IO count
    0x00,       // N1 count
    0x00,       // N2 count
    0x00,       // N4 count
    0x00        // N8 count
  ]);

  // Data content: codec ID + num records + record + io + num records 2
  const codecId = Buffer.from([0x08]);
  const numData = Buffer.from([0x01]);
  const dataContent = Buffer.concat([codecId, numData, record, io, numData]);

  // CRC
  const crc = TeltonikaParser.crc16IBM(dataContent);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  // Preamble + length
  const preamble = Buffer.alloc(4);
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(dataContent.length, 0);

  return {
    packet: Buffer.concat([preamble, lengthBuf, dataContent, crcBuf]),
    expected: { lat: lat / 1e7, lon: lon / 1e7, altitude, angle, satellites, speed }
  };
}

const test = buildTestPacket();
const result = TeltonikaParser.parseAVLPacket(test.packet);

assert(result !== null, 'Packet parsed successfully');
assert(result.packet.codecId === '8', `Codec ID: ${result.packet.codecId}`);
assert(result.packet.numberOfRecords === 1, `Record count: ${result.packet.numberOfRecords}`);
assert(result.packet.crcValid === true, 'CRC validation passed');

const rec = result.packet.records[0];
assertClose(rec.gps.longitude, test.expected.lon, 0.0001, 'Longitude');
assertClose(rec.gps.latitude, test.expected.lat, 0.0001, 'Latitude');
assert(rec.gps.altitude === test.expected.altitude, `Altitude: ${rec.gps.altitude}`);
assert(rec.gps.angle === test.expected.angle, `Angle: ${rec.gps.angle}`);
assert(rec.gps.satellites === test.expected.satellites, `Satellites: ${rec.gps.satellites}`);
assert(rec.gps.speed === test.expected.speed, `Speed: ${rec.gps.speed}`);

// ═══════════════════════════════════════════
// Test 4: IO Name Lookup
// ═══════════════════════════════════════════
console.log('\n📋 Test 4: IO Name Lookup');

assert(TeltonikaParser.getIOName(239) === 'Ignition', 'IO 239 = Ignition');
assert(TeltonikaParser.getIOName(66) === 'External Voltage', 'IO 66 = External Voltage');
assert(TeltonikaParser.getIOName(240) === 'Movement', 'IO 240 = Movement');
assert(TeltonikaParser.getIOName(9999) === 'IO_9999', 'Unknown IO returns IO_9999');

// ═══════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
