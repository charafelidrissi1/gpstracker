/**
 * GPS Tracking Platform — Main Server Entry Point
 * Boots: TCP server (Teltonika devices), HTTP API, and WebSocket server.
 */

const http = require('http');
const DB = require('./src/database');
const createAPI = require('./src/api');
const WSServer = require('./src/wsServer');
const TeltonikaServer = require('./src/tcpServer');

const HTTP_PORT = parseInt(process.env.HTTP_PORT) || 3000;

async function main() {
  // Initialize Database (async for sql.js)
  console.log('🗄️  Initializing database...');
  const db = new DB();
  await db.init();

  // Initialize WebSocket Server
  const wsServer = new WSServer();

  // Initialize HTTP API
  const app = createAPI(db);
  const httpServer = http.createServer(app);
  wsServer.attach(httpServer);

  // Initialize Teltonika TCP Server
  const tcpServer = new TeltonikaServer(db, (data) => wsServer.broadcast(data));
  tcpServer.start();

  // Start HTTP Server
  httpServer.listen(HTTP_PORT, () => {
    console.log(`\n${'='.repeat(56)}`);
    console.log(`  GPS TRACKING PLATFORM`);
    console.log(`${'='.repeat(56)}`);
    console.log(`  TCP Server  :  port ${parseInt(process.env.TCP_PORT) || 5027}`);
    console.log(`  Dashboard   :  http://localhost:${HTTP_PORT}`);
    console.log(`  WebSocket   :  ws://localhost:${HTTP_PORT}/ws`);
    console.log(`${'='.repeat(56)}\n`);
  });

  // Graceful shutdown
  const shutdown = () => { console.log('\nShutting down...'); db.close(); httpServer.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
