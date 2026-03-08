/**
 * Teltonika Codec 8 / 8E Protocol Parser
 * Parses AVL data packets from Teltonika GPS tracking devices.
 */

class TeltonikaParser {
  /**
   * Parse IMEI from the initial handshake buffer.
   * Format: 2 bytes (IMEI length) + IMEI string bytes
   * @param {Buffer} buffer
   * @returns {{ imei: string, bytesRead: number } | null}
   */
  static parseIMEI(buffer) {
    if (buffer.length < 2) return null;
    const imeiLength = buffer.readUInt16BE(0);
    if (buffer.length < 2 + imeiLength) return null;
    const imei = buffer.slice(2, 2 + imeiLength).toString('ascii');
    return { imei, bytesRead: 2 + imeiLength };
  }

  /**
   * Parse a full AVL data packet (Codec 8 or Codec 8 Extended).
   * @param {Buffer} buffer
   * @returns {{ packet: object, bytesRead: number } | null}
   */
  static parseAVLPacket(buffer) {
    if (buffer.length < 12) return null; // minimum: preamble(4) + length(4) + codec(1) + numData(1) + numData2(1) + crc(4) = 15

    // Preamble — 4 zero bytes
    const preamble = buffer.readUInt32BE(0);
    if (preamble !== 0x00000000) {
      return null;
    }

    // Data field length
    const dataFieldLength = buffer.readUInt32BE(4);
    const totalPacketLength = 8 + dataFieldLength + 4; // preamble + length + data + crc

    if (buffer.length < totalPacketLength) return null; // not enough data yet

    // Codec ID
    const codecId = buffer.readUInt8(8);
    const isCodec8E = codecId === 0x8E;
    const isCodec8 = codecId === 0x08;

    if (!isCodec8 && !isCodec8E) {
      console.warn(`Unknown codec ID: 0x${codecId.toString(16)}`);
      return null;
    }

    // Number of Data 1
    const numberOfData1 = buffer.readUInt8(9);

    // Parse AVL records
    let offset = 10;
    const records = [];

    for (let i = 0; i < numberOfData1; i++) {
      const result = isCodec8E
        ? TeltonikaParser._parseAVLRecord8E(buffer, offset)
        : TeltonikaParser._parseAVLRecord(buffer, offset);

      if (!result) return null;
      records.push(result.record);
      offset = result.offset;
    }

    // Number of Data 2
    const numberOfData2 = buffer.readUInt8(offset);
    offset += 1;

    if (numberOfData1 !== numberOfData2) {
      console.warn(`Data count mismatch: ${numberOfData1} vs ${numberOfData2}`);
    }

    // CRC-16 (4 bytes, but CRC value is in lower 16 bits typically)
    const receivedCrc = buffer.readUInt32BE(offset);
    offset += 4;

    // Calculate CRC over the data field (from codec ID to number of data 2)
    const crcData = buffer.slice(8, 8 + dataFieldLength);
    const calculatedCrc = TeltonikaParser.crc16IBM(crcData);

    const crcValid = receivedCrc === calculatedCrc;
    if (!crcValid) {
      console.warn(`CRC mismatch: received 0x${receivedCrc.toString(16)}, calculated 0x${calculatedCrc.toString(16)}`);
    }

    return {
      packet: {
        codecId: isCodec8E ? '8E' : '8',
        numberOfRecords: numberOfData1,
        records,
        crcValid
      },
      bytesRead: totalPacketLength
    };
  }

  /**
   * Parse a single AVL record (Codec 8).
   */
  static _parseAVLRecord(buffer, offset) {
    if (buffer.length < offset + 24) return null;

    // Timestamp — 8 bytes (ms since epoch)
    const timestampMs = Number(buffer.readBigUInt64BE(offset));
    offset += 8;

    // Priority — 1 byte
    const priority = buffer.readUInt8(offset);
    offset += 1;

    // GPS Element — 15 bytes
    const gps = TeltonikaParser._parseGPSElement(buffer, offset);
    offset += 15;

    // IO Element (Codec 8)
    const ioResult = TeltonikaParser._parseIOElement(buffer, offset, false);
    if (!ioResult) return null;

    return {
      record: {
        timestamp: new Date(timestampMs),
        timestampMs,
        priority,
        gps,
        io: ioResult.io
      },
      offset: ioResult.offset
    };
  }

  /**
   * Parse a single AVL record (Codec 8 Extended).
   */
  static _parseAVLRecord8E(buffer, offset) {
    if (buffer.length < offset + 24) return null;

    const timestampMs = Number(buffer.readBigUInt64BE(offset));
    offset += 8;

    const priority = buffer.readUInt8(offset);
    offset += 1;

    const gps = TeltonikaParser._parseGPSElement(buffer, offset);
    offset += 15;

    const ioResult = TeltonikaParser._parseIOElement(buffer, offset, true);
    if (!ioResult) return null;

    return {
      record: {
        timestamp: new Date(timestampMs),
        timestampMs,
        priority,
        gps,
        io: ioResult.io
      },
      offset: ioResult.offset
    };
  }

  /**
   * Parse GPS element — 15 bytes.
   */
  static _parseGPSElement(buffer, offset) {
    const longitude = buffer.readInt32BE(offset) / 1e7;
    const latitude = buffer.readInt32BE(offset + 4) / 1e7;
    const altitude = buffer.readInt16BE(offset + 8);
    const angle = buffer.readUInt16BE(offset + 10);
    const satellites = buffer.readUInt8(offset + 12);
    const speed = buffer.readUInt16BE(offset + 13);

    return { longitude, latitude, altitude, angle, satellites, speed };
  }

  /**
   * Parse IO element.
   * @param {boolean} extended — if true, IO IDs and counts are 2 bytes (Codec 8E)
   */
  static _parseIOElement(buffer, offset, extended) {
    const idSize = extended ? 2 : 1;
    const countSize = extended ? 2 : 1;

    const readId = (buf, off) => extended ? buf.readUInt16BE(off) : buf.readUInt8(off);
    const readCount = (buf, off) => extended ? buf.readUInt16BE(off) : buf.readUInt8(off);

    if (buffer.length < offset + idSize + countSize) return null;

    // Event IO ID
    const eventIOId = readId(buffer, offset);
    offset += idSize;

    // Total IO count
    const totalIO = readCount(buffer, offset);
    offset += countSize;

    const io = {};

    // 1-byte IO values
    const result1 = TeltonikaParser._parseIOGroup(buffer, offset, 1, idSize, countSize, readId, readCount);
    if (!result1) return null;
    Object.assign(io, result1.values);
    offset = result1.offset;

    // 2-byte IO values
    const result2 = TeltonikaParser._parseIOGroup(buffer, offset, 2, idSize, countSize, readId, readCount);
    if (!result2) return null;
    Object.assign(io, result2.values);
    offset = result2.offset;

    // 4-byte IO values
    const result4 = TeltonikaParser._parseIOGroup(buffer, offset, 4, idSize, countSize, readId, readCount);
    if (!result4) return null;
    Object.assign(io, result4.values);
    offset = result4.offset;

    // 8-byte IO values
    const result8 = TeltonikaParser._parseIOGroup(buffer, offset, 8, idSize, countSize, readId, readCount);
    if (!result8) return null;
    Object.assign(io, result8.values);
    offset = result8.offset;

    // Codec 8E: variable-length IO values (NX)
    if (extended) {
      const nxResult = TeltonikaParser._parseIOGroupVariable(buffer, offset, idSize, countSize, readId, readCount);
      if (!nxResult) return null;
      Object.assign(io, nxResult.values);
      offset = nxResult.offset;
    }

    return { io: { eventIOId, totalIO, properties: io }, offset };
  }

  /**
   * Parse a group of fixed-size IO values.
   */
  static _parseIOGroup(buffer, offset, valueSize, idSize, countSize, readId, readCount) {
    if (buffer.length < offset + countSize) return null;
    const count = readCount(buffer, offset);
    offset += countSize;

    const values = {};
    for (let i = 0; i < count; i++) {
      if (buffer.length < offset + idSize + valueSize) return null;
      const id = readId(buffer, offset);
      offset += idSize;

      let value;
      switch (valueSize) {
        case 1: value = buffer.readUInt8(offset); break;
        case 2: value = buffer.readUInt16BE(offset); break;
        case 4: value = buffer.readUInt32BE(offset); break;
        case 8: value = Number(buffer.readBigUInt64BE(offset)); break;
      }
      offset += valueSize;
      values[id] = value;
    }

    return { values, offset };
  }

  /**
   * Parse variable-length IO values (Codec 8E NX group).
   */
  static _parseIOGroupVariable(buffer, offset, idSize, countSize, readId, readCount) {
    if (buffer.length < offset + countSize) return null;
    const count = readCount(buffer, offset);
    offset += countSize;

    const values = {};
    for (let i = 0; i < count; i++) {
      if (buffer.length < offset + idSize + 2) return null;
      const id = readId(buffer, offset);
      offset += idSize;
      const len = buffer.readUInt16BE(offset);
      offset += 2;
      if (buffer.length < offset + len) return null;
      values[id] = buffer.slice(offset, offset + len).toString('hex');
      offset += len;
    }

    return { values, offset };
  }

  /**
   * CRC-16/IBM (aka CRC-16/ARC) — polynomial 0xA001 (reflected 0x8005).
   * @param {Buffer} data
   * @returns {number}
   */
  static crc16IBM(data) {
    let crc = 0x0000;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        if (crc & 1) {
          crc = (crc >> 1) ^ 0xA001;
        } else {
          crc >>= 1;
        }
      }
    }
    return crc;
  }

  /**
   * Well-known Teltonika IO element IDs for human-readable names.
   */
  static IO_NAMES = {
    1: 'Digital Input 1',
    2: 'Digital Input 2',
    3: 'Digital Input 3',
    4: 'Digital Input 4',
    9: 'Analog Input 1',
    10: 'SD Status',
    11: 'ICCID1',
    12: 'Fuel Used GPS',
    13: 'Fuel Rate GPS',
    16: 'Total Odometer',
    17: 'Axis X',
    18: 'Axis Y',
    19: 'Axis Z',
    21: 'GSM Signal',
    24: 'Speed',
    25: 'Current Profile',
    66: 'External Voltage',
    67: 'Battery Voltage',
    68: 'Battery Current',
    69: 'GNSS Status',
    72: 'Dallas Temperature 1',
    73: 'Dallas Temperature 2',
    74: 'Dallas Temperature 3',
    75: 'Dallas Temperature 4',
    78: 'iButton',
    80: 'Data Mode',
    113: 'Battery Level',
    182: 'HDOP',
    199: 'Trip Odometer',
    200: 'Sleep Mode',
    205: 'GSM Cell ID',
    206: 'GSM Area Code',
    239: 'Ignition',
    240: 'Movement',
    241: 'Operator Code',
    253: 'Green Driving Type',
    254: 'Green Driving Value',
    255: 'Overspeeding',
    256: 'VIN',
    281: 'DOUT 1',
    282: 'DOUT 2',
    283: 'DOUT 3',
    284: 'DOUT 4',
    303: 'Instant Movement',
    390: 'Unplug Detection'
  };

  /**
   * Get human-readable name for an IO element ID.
   */
  static getIOName(id) {
    return TeltonikaParser.IO_NAMES[id] || `IO_${id}`;
  }
}

module.exports = TeltonikaParser;
