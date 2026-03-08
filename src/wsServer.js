/**
 * WebSocket Server
 * Broadcasts real-time position updates to all connected dashboard clients.
 */

const WebSocket = require('ws');

class WSServer {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * Attach WebSocket server to an existing HTTP server.
   */
  attach(httpServer) {
    this.wss = new WebSocket.Server({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const clientAddr = req.socket.remoteAddress;
      console.log(`🌐 Dashboard client connected: ${clientAddr}`);
      this.clients.add(ws);

      ws.on('close', () => {
        console.log(`🌐 Dashboard client disconnected: ${clientAddr}`);
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error(`WebSocket error (${clientAddr}):`, err.message);
        this.clients.delete(ws);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'GPS Tracking Platform — WebSocket connected',
        timestamp: new Date().toISOString()
      }));
    });

    console.log('🌐 WebSocket server attached (path: /ws)');
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(data) {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }
}

module.exports = WSServer;
