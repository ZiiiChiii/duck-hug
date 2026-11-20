// 抱抱鴨 Cloudflare Worker
// - 網頁檔案（public/）
// - /api/room/{4位數房號}：雙人連線（WebSocket，Durable Object「Room」）
// - /api/scores：排行榜（Durable Object「Board」，內建 SQLite）
import { DurableObject } from 'cloudflare:workers';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === '/api/ping') return json({ ok: true });

    if (path.startsWith('/api/room/')) {
      const code = path.slice('/api/room/'.length);
      if (!/^\d{4}$/.test(code)) return json({ error: 'bad room code' }, 400);
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }

    if (path === '/api/scores') {
      const board = env.BOARD.get(env.BOARD.idFromName('main'));
      if (req.method === 'GET') {
        const mode = url.searchParams.get('mode') === 'duo' ? 'duo' : 'solo';
        return json({ rows: await board.top(mode, 20) });
      }
      if (req.method === 'POST') {
        let body;
        try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
        const mode = body.mode === 'duo' ? 'duo' : body.mode === 'solo' ? 'solo' : null;
        const name = String(body.name || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 21);
        const score = Number(body.score);
        if (!mode || !name || !Number.isInteger(score) || score < 1 || score > 500) return json({ error: 'invalid' }, 400);
        const ip = req.headers.get('cf-connecting-ip') || 'unknown';
        const ok = await board.add(mode, name, score, ip);
        return ok ? json({ ok: true }) : json({ error: 'too fast' }, 429);
      }
      return json({ error: 'method' }, 405);
    }

    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};

// ---------- 雙人房間：每個房號一個 ----------
// 每位玩家送自己的狀態（presence），房間把所有人的狀態廣播給大家
export class Room extends DurableObject {
  async fetch(req) {
    const open = this.ctx.getWebSockets();
    if (open.length >= 6) return json({ error: 'room full' }, 429);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const pid = 'p' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid, presence: {} });
    server.send(JSON.stringify({ type: 'hello', pid }));
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(exclude) {
    const sockets = this.ctx.getWebSockets().filter((ws) => ws !== exclude);
    const peers = [];
    for (const ws of sockets) {
      const a = ws.deserializeAttachment();
      if (a) peers.push({ peer: a.pid, presence: a.presence || {} });
    }
    const msg = JSON.stringify({ type: 'peers', peers });
    for (const ws of sockets) { try { ws.send(msg); } catch { /* 已斷線 */ } }
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 3000) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (m.type === 'ping') { ws.send('{"type":"pong"}'); return; }
    if (m.type === 'presence' && m.presence && typeof m.presence === 'object' && !Array.isArray(m.presence)) {
      const presence = m.presence;
      if (JSON.stringify(presence).length > 1800) return;
      const a = ws.deserializeAttachment() || {};
      a.presence = presence;
      ws.serializeAttachment(a);
      this.broadcast();
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch { /* ignore */ }
    this.broadcast(ws);
  }

  async webSocketError(ws) {
    this.broadcast(ws);
  }
}

// ---------- 排行榜 ----------
export class Board extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, name TEXT NOT NULL, score INTEGER NOT NULL, ts INTEGER NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS scores_mode_score ON scores (mode, score)');
    sql.exec('CREATE TABLE IF NOT EXISTS limits (ip TEXT PRIMARY KEY, ts INTEGER NOT NULL)');
  }

  top(mode, n) {
    return this.ctx.storage.sql
      .exec('SELECT name, score, ts FROM scores WHERE mode = ? ORDER BY score DESC, ts ASC LIMIT ?', mode, n)
      .toArray();
  }

  add(mode, name, score, ip) {
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    const last = sql.exec('SELECT ts FROM limits WHERE ip = ?', ip).toArray()[0];
    if (last && now - last.ts < 5000) return false; // 同一個網路 5 秒內只能登記一次
    sql.exec('INSERT OR REPLACE INTO limits (ip, ts) VALUES (?, ?)', ip, now);
    sql.exec('INSERT INTO scores (mode, name, score, ts) VALUES (?, ?, ?, ?)', mode, name, score, now);
    // 每個模式只保留前 300 名
    sql.exec('DELETE FROM scores WHERE mode = ? AND id NOT IN (SELECT id FROM scores WHERE mode = ? ORDER BY score DESC, ts ASC LIMIT 300)', mode, mode);
    sql.exec('DELETE FROM limits WHERE ts < ?', now - 3600_000);
    return true;
  }
}
