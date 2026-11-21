// 連線層：連到同一個網站的 Cloudflare Worker（雙人房間 + 排行榜）
// 在沒有伺服器的地方（例如預覽頁）會自動關閉這些功能

let serverOk = null;
export async function hasServer() {
  if (serverOk !== null) return serverOk;
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    serverOk = r.ok && (await r.json()).ok === true;
  } catch (e) { serverOk = false; }
  return serverOk;
}

// 跟遊戲原本用的「房間」介面一樣：presence(patch)、peers()、onPeers(fn)
export async function serverRoom() {
  if (!(await hasServer())) return null;
  let mine = {}, code = null, ws = null, myPid = null, list = [], pingTimer = null, closedOnPurpose = false;
  const handlers = [];
  const fire = () => handlers.forEach((h) => h({ peers: list }));

  function send() {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'presence', presence: mine }));
  }
  function disconnect() {
    closedOnPurpose = true;
    clearInterval(pingTimer);
    if (ws) { try { ws.close(); } catch (e) {} }
    ws = null; myPid = null; list = [];
  }
  function connect(c) {
    closedOnPurpose = false;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const sock = new WebSocket(`${proto}//${location.host}/api/room/${c}`);
    ws = sock;
    sock.onopen = () => {
      send();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, 25000);
    };
    sock.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === 'hello') myPid = m.pid;
      else if (m.type === 'peers' && Array.isArray(m.peers)) {
        list = m.peers.map((p) => ({ peer: p.peer, sameTab: p.peer === myPid, isMe: p.peer === myPid, presence: p.presence || {} }));
        fire();
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      clearInterval(pingTimer);
      if (!closedOnPurpose && code === c) setTimeout(() => { if (code === c && ws === sock) connect(c); }, 1200); // 斷線自動重連
    };
  }

  return {
    async presence(patch) {
      const next = { ...mine, ...patch };
      for (const k of Object.keys(next)) if (next[k] === null || next[k] === undefined) delete next[k];
      mine = next;
      const c = next.code || null;
      if (c !== code) {
        disconnect();
        code = c;
        fire();
        if (c) connect(c);
      } else send();
    },
    peers: () => list,
    onPeers(h) { handlers.push(h); setTimeout(() => h({ peers: list }), 0); return () => {}; },
  };
}

// ---------- 排行榜 ----------
export async function submitScore(mode, name, score, total) {
  const r = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, name: String(name).slice(0, 21), score: Math.floor(score), total: Math.floor(total) }),
  });
  if (!r.ok) throw new Error(r.status === 429 ? 'too fast' : 'failed');
}

export async function topScores(mode, kind) {
  if (!(await hasServer())) return null;
  const r = await fetch(`/api/scores?mode=${mode === 'duo' ? 'duo' : 'solo'}&kind=${kind === 'total' ? 'total' : 'streak'}`, { cache: 'no-store' });
  if (!r.ok) return null;
  const data = await r.json();
  return Array.isArray(data.rows) ? data.rows.map((x) => ({ name: String(x.name || '玩家'), score: Number(x.score) || 0 })) : null;
}
