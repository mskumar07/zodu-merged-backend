// One dedicated connection per API instance: LISTEN ckl_notifications.
// fn_notify() calls pg_notify on insert; the payload arrives here on COMMIT.
// Reconnects with backoff (1s → 30s); after a reconnect emits 'resync' so the
// SSE hub can tell every open stream to refetch (NOTIFYs sent while we were
// away are lost).
const { EventEmitter } = require('node:events');
const { Client } = require('pg');
const { connection } = require('./pool');
const { logger } = require('../utils/logger');

const CHANNEL = 'ckl_notifications';

class NotificationListener extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.connected = false;
    this.stopped = false;
    this.backoffMs = 1000;
    this.everConnected = false;
  }

  async start() {
    this.stopped = false;
    await this.connect();
  }

  async connect() {
    if (this.stopped) return;
    const client = new Client({ ...connection(), keepAlive: true });
    this.client = client;
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL) return;
      try {
        this.emit('notification', JSON.parse(msg.payload));
      } catch (err) {
        logger.warn('listener: bad payload', { error: err.message });
      }
    });
    client.on('error', (err) => {
      logger.error('listener: connection error', { error: err.message });
      this.lost(client);
    });
    client.on('end', () => this.lost(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.connected = true;
      this.backoffMs = 1000;
      logger.info('listener: LISTEN ckl_notifications');
      if (this.everConnected) this.emit('resync');
      this.everConnected = true;
    } catch (err) {
      logger.error('listener: connect failed', { error: err.message });
      this.lost(client);
    }
  }

  lost(client) {
    if (client !== this.client) return;   // an old client ending late
    this.connected = false;
    this.client = null;
    client.removeAllListeners('end');
    client.end().catch(() => {});
    if (this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    setTimeout(() => this.connect(), wait).unref();
  }

  async stop() {
    this.stopped = true;
    this.connected = false;
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => {});
  }
}

module.exports = new NotificationListener();
module.exports.NotificationListener = NotificationListener;
