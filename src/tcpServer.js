/**
 * Teltonika TCP Server
 * Accepts connections from Teltonika GPS devices, performs IMEI handshake,
 * parses Codec 8/8E AVL data, stores to DB, and broadcasts via WebSocket.
 */

const net = require('net');
const TeltonikaParser = require('./codec8');

const TCP_PORT = parseInt(process.env.TCP_PORT) || 5027;

class TeltonikaServer {
  constructor(db, wsBroadcast) {
    this.db = db;
    this.wsBroadcast = wsBroadcast;
    this.server = null;
    this.connections = new Map(); // socket -> { imei, device, buffer, authenticated }
    this.tripTracker = new Map(); // deviceId -> { lastPosition, lastMoving, tripId }
  }

  start() {
    this.server = net.createServer((socket) => this._handleConnection(socket));

    this.server.listen(TCP_PORT, () => {
      console.log(`📡 Teltonika TCP server listening on port ${TCP_PORT}`);
    });

    this.server.on('error', (err) => {
      console.error('TCP server error:', err.message);
    });
  }

  _handleConnection(socket) {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`🔗 New device connection from ${remoteAddr}`);

    const connState = {
      imei: null,
      device: null,
      buffer: Buffer.alloc(0),
      authenticated: false
    };

    this.connections.set(socket, connState);

    socket.on('data', (data) => {
      connState.buffer = Buffer.concat([connState.buffer, data]);
      this._processBuffer(socket, connState);
    });

    socket.on('close', () => {
      console.log(`🔌 Device disconnected: ${connState.imei || remoteAddr}`);
      if (connState.imei) {
        this.db.setDeviceOffline(connState.imei);
        this.wsBroadcast({
          type: 'device_offline',
          imei: connState.imei,
          deviceId: connState.device?.id
        });
      }
      this.connections.delete(socket);
    });

    socket.on('error', (err) => {
      console.error(`Socket error (${connState.imei || remoteAddr}):`, err.message);
      this.connections.delete(socket);
    });

    // Timeout: 5 minutes of inactivity
    socket.setTimeout(300000);
    socket.on('timeout', () => {
      console.log(`⏰ Connection timeout: ${connState.imei || remoteAddr}`);
      socket.end();
    });
  }

  _processBuffer(socket, state) {
    // Step 1: IMEI Handshake
    if (!state.authenticated) {
      const imeiResult = TeltonikaParser.parseIMEI(state.buffer);
      if (!imeiResult) return; // wait for more data

      state.imei = imeiResult.imei;
      state.buffer = state.buffer.slice(imeiResult.bytesRead);

      // Register/update device in DB
      state.device = this.db.upsertDevice(state.imei);
      state.authenticated = true;

      console.log(`✅ Device authenticated: IMEI ${state.imei} (ID: ${state.device.id})`);

      // Accept connection
      const response = Buffer.alloc(1);
      response.writeUInt8(0x01, 0);
      socket.write(response);

      this.wsBroadcast({
        type: 'device_online',
        imei: state.imei,
        deviceId: state.device.id,
        name: state.device.name
      });
    }

    // Step 2: Parse AVL data packets
    while (state.buffer.length > 0 && state.authenticated) {
      const result = TeltonikaParser.parseAVLPacket(state.buffer);
      if (!result) break; // incomplete packet, wait for more data

      const { packet, bytesRead } = result;
      state.buffer = state.buffer.slice(bytesRead);

      console.log(`📦 Received ${packet.numberOfRecords} records from ${state.imei} (Codec ${packet.codecId})`);

      // Acknowledge with number of records
      const ack = Buffer.alloc(4);
      ack.writeUInt32BE(packet.numberOfRecords, 0);
      socket.write(ack);

      // Process each record
      for (const record of packet.records) {
        this._processRecord(state.device, record);
      }
    }
  }

  _processRecord(device, record) {
    // Skip invalid GPS data (0,0 means no fix)
    if (record.gps.latitude === 0 && record.gps.longitude === 0) {
      console.log(`⚠️ Skipping record with no GPS fix for ${device.imei}`);
      return;
    }

    // Store position
    this.db.insertPosition(device.id, record);

    // Trip detection
    this._detectTrip(device, record);

    // Build broadcast message
    const positionData = {
      type: 'position',
      deviceId: device.id,
      imei: device.imei,
      name: device.name,
      timestamp: record.timestamp.toISOString(),
      lat: record.gps.latitude,
      lng: record.gps.longitude,
      altitude: record.gps.altitude,
      speed: record.gps.speed,
      angle: record.gps.angle,
      satellites: record.gps.satellites,
      io: record.io || {}
    };

    // Add human-readable IO names
    if (record.io && record.io.properties) {
      const namedIO = {};
      for (const [id, value] of Object.entries(record.io.properties)) {
        namedIO[TeltonikaParser.getIOName(parseInt(id))] = value;
      }
      positionData.ioNamed = namedIO;
    }

    this.wsBroadcast(positionData);
  }

  _detectTrip(device, record) {
    const key = device.id;
    let tracker = this.tripTracker.get(key) || {
      lastPosition: null,
      lastMovingTime: null,
      tripId: null,
      speedSum: 0,
      speedCount: 0,
      maxSpeed: 0,
      distance: 0
    };

    const isMoving = record.gps.speed > 3; // km/h threshold
    const now = record.timestamp.toISOString();

    if (isMoving && !tracker.tripId) {
      // Start new trip
      const activeTrip = this.db.getActiveTrip(device.id);
      if (!activeTrip) {
        const tripId = this.db.startTrip(device.id, now, record.gps.latitude, record.gps.longitude);
        tracker.tripId = tripId;
        tracker.speedSum = 0;
        tracker.speedCount = 0;
        tracker.maxSpeed = 0;
        tracker.distance = 0;
        console.log(`🚗 Trip started for ${device.imei} (Trip ID: ${tripId})`);
      } else {
        tracker.tripId = activeTrip.id;
      }
    }

    if (tracker.tripId) {
      tracker.speedSum += record.gps.speed;
      tracker.speedCount++;
      if (record.gps.speed > tracker.maxSpeed) tracker.maxSpeed = record.gps.speed;

      if (tracker.lastPosition) {
        const dist = DB_haversine(
          tracker.lastPosition.lat, tracker.lastPosition.lng,
          record.gps.latitude, record.gps.longitude
        );
        tracker.distance += dist;
      }

      // End trip if idle for 2+ minutes
      if (!isMoving) {
        if (!tracker.idleStart) {
          tracker.idleStart = record.timestamp;
        } else {
          const idleDuration = (record.timestamp - tracker.idleStart) / 1000;
          if (idleDuration > 120) {
            const trip = this.db.getActiveTrip(device.id);
            if (trip) {
              const durationSeconds = Math.round((new Date(now) - new Date(trip.start_time)) / 1000);
              const avgSpeed = tracker.speedCount > 0 ? Math.round((tracker.speedSum / tracker.speedCount) * 100) / 100 : 0;
              this.db.endTrip(
                trip.id, now,
                record.gps.latitude, record.gps.longitude,
                Math.round(tracker.distance * 100) / 100,
                tracker.maxSpeed, avgSpeed, durationSeconds
              );
              console.log(`🏁 Trip ended for ${device.imei} (Trip ID: ${trip.id}, ${tracker.distance.toFixed(2)} km)`);
              tracker.tripId = null;
              tracker.idleStart = null;
            }
          }
        }
      } else {
        tracker.idleStart = null;
      }
    }

    tracker.lastPosition = { lat: record.gps.latitude, lng: record.gps.longitude };
    tracker.lastMovingTime = isMoving ? record.timestamp : tracker.lastMovingTime;
    this.tripTracker.set(key, tracker);
  }

  getConnectionCount() {
    return this.connections.size;
  }
}

// Haversine distance helper (km)
function DB_haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = TeltonikaServer;
