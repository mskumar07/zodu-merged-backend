// Live notifications to open tabs (§7.2). One hub per API instance:
// userId → Set<stream>. The LISTEN connection hands us { id, user_id, zodu_id,
// branch_id }; when that user has a stream here for that company and branch we
// batch the ids for 250 ms, load the rows, and write `event: notification`.
const config = require('../config');
const { logger } = require('../utils/logger');
const notifications = require('../services/notifications');

const BATCH_MS = 250;
const MAX_BUFFERED_BYTES = 1024 * 1024;

class SseHub {
  constructor({ heartbeatMs = config.SSE_HEARTBEAT_MS, maxPerUser = config.SSE_MAX_STREAMS_PER_USER } = {}) {
    this.heartbeatMs = heartbeatMs;
    this.maxPerUser = maxPerUser;
    this.byUser = new Map();
    this.pending = new Set();
    this.flushTimer = null;
    this.heartbeat = null;
  }

  get size() {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }

  start() {
    this.heartbeat = setInterval(() => this.broadcastRaw(': ping\n\n'), this.heartbeatMs);
    this.heartbeat.unref();
  }

  // Registers an open response. → the stream (call close() to end it).
  add({ res, userId, zoduId, branchId, expiresAt }) {
    let set = this.byUser.get(userId);
    if (!set) { set = new Set(); this.byUser.set(userId, set); }
    // At most N streams per user here: the oldest goes.
    while (set.size >= this.maxPerUser) {
      const oldest = set.values().next().value;
      this.close(oldest, { retryMs: 3000 });
    }
    const stream = { res, userId, zoduId, branchId, closed: false, expiryTimer: null };
    set.add(stream);
    // The token's lifetime is the stream's: at exp the client refreshes and reconnects.
    if (expiresAt) {
      const ms = expiresAt * 1000 - Date.now();
      stream.expiryTimer = setTimeout(() => {
        this.write(stream, 'event: reauth\ndata: {}\n\n');
        this.close(stream);
      }, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
      stream.expiryTimer.unref();
    }
    res.on('close', () => this.remove(stream));
    return stream;
  }

  remove(stream) {
    if (stream.closed) return;
    stream.closed = true;
    clearTimeout(stream.expiryTimer);
    const set = this.byUser.get(stream.userId);
    if (set) {
      set.delete(stream);
      if (!set.size) this.byUser.delete(stream.userId);
    }
  }

  close(stream, { retryMs } = {}) {
    if (stream.closed) return;
    if (retryMs) this.write(stream, `retry: ${retryMs}\n\n`);
    this.remove(stream);
    stream.res.end();
  }

  // Backpressure: a client that stopped reading is dropped (it reconnects with Last-Event-ID).
  write(stream, chunk) {
    if (stream.closed) return false;
    const ok = stream.res.write(chunk);
    if (!ok && stream.res.writableLength > MAX_BUFFERED_BYTES) {
      logger.warn('sse: dropping slow stream', { user_id: stream.userId });
      this.close(stream);
      return false;
    }
    return true;
  }

  broadcastRaw(chunk) {
    for (const set of this.byUser.values()) for (const s of [...set]) this.write(s, chunk);
  }

  sendNotification(stream, row) {
    this.write(stream, `id: ${notifications.eventId(row)}\nevent: notification\ndata: ${JSON.stringify(notifications.out(row))}\n\n`);
  }

  sendUnread(stream, count) {
    this.write(stream, `event: unread\ndata: ${JSON.stringify({ count })}\n\n`);
  }

  // From the LISTEN connection.
  onNotify(payload) {
    if (!payload?.id || !payload.user_id) return;
    const set = this.byUser.get(payload.user_id);
    if (!set) return;
    if (![...set].some((s) => s.zoduId === payload.zodu_id && s.branchId === payload.branch_id)) return;
    this.pending.add(payload.id);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), BATCH_MS);
  }

  async flush() {
    this.flushTimer = null;
    const ids = [...this.pending];
    this.pending.clear();
    if (!ids.length) return;
    try {
      const rows = await notifications.byIds(ids);
      rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      for (const row of rows) {
        const set = this.byUser.get(row.recipient_user_id);
        if (!set) continue;
        for (const s of [...set]) {
          if (s.zoduId === row.zodu_id && s.branchId === row.branch_id) this.sendNotification(s, row);
        }
      }
    } catch (err) {
      logger.error('sse: flush failed', { error: err.message });
    }
  }

  // After the LISTEN connection came back: NOTIFYs may have been lost.
  resync() {
    this.broadcastRaw('event: resync\ndata: {}\n\n');
  }

  // Graceful shutdown: tell clients to come back in 3 s, end every stream.
  closeAll() {
    clearInterval(this.heartbeat);
    clearTimeout(this.flushTimer);
    for (const set of [...this.byUser.values()]) for (const s of [...set]) this.close(s, { retryMs: 3000 });
  }
}

module.exports = { SseHub };
