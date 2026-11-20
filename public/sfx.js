// 音效：全部用 Web Audio 即時合成，不需要音檔
let ctx = null, master = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('hugduck-muted') === '1'; } catch (e) {}

export function audio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { ctx = null; }
  return ctx;
}
export const out = () => master;
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('hugduck-muted', m ? '1' : '0'); } catch (e) {}
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
}

// ---------- 小工具 ----------
function env(g, t0, a, peak, hold, rel) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.setValueAtTime(peak, t0 + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + rel);
  return t0 + a + hold + rel;
}
function tone(type, f0, f1, dur, vol, when = 0, opts = {}) {
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  const end = env(g, t0, opts.attack ?? 0.005, vol, opts.hold ?? 0, dur);
  let node = o;
  if (opts.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; o.connect(f); node = f; }
  node.connect(g); g.connect(master);
  if (opts.vib) {
    const l = c.createOscillator(), lg = c.createGain();
    l.frequency.value = opts.vib[0]; lg.gain.value = opts.vib[1];
    l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(end + 0.05);
  }
  o.start(t0); o.stop(end + 0.05);
}
function noise(dur, vol, when = 0, { type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.01 } = {}) {
  const c = audio(); if (!c) return;
  const t0 = c.currentTime + when;
  const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  const end = env(g, t0, attack, vol, 0, dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(t0, Math.random() * 0.5); s.stop(end + 0.05);
}
const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// ---------- 介面 ----------
export const click = () => { tone('sine', 900, 520, 0.05, 0.18); noise(0.02, 0.05, 0, { type: 'highpass', f0: 3000 }); };
export const coin = () => { tone('square', NOTE(83), NOTE(83), 0.06, 0.08, 0, { lp: 4000 }); tone('square', NOTE(88), NOTE(88), 0.25, 0.08, 0.07, { lp: 4000 }); };
export const dingDong = () => { tone('sine', NOTE(76), NOTE(76), 0.5, 0.25, 0, { hold: 0.05 }); tone('sine', NOTE(72), NOTE(72), 0.7, 0.25, 0.32, { hold: 0.05 }); };

// ---------- 動作 ----------
export const whooshUp = () => { noise(0.45, 0.35, 0, { f0: 350, f1: 2800, q: 1.4, attack: 0.05 }); tone('sine', 300, 900, 0.35, 0.08); };
export const whooshIn = () => noise(0.5, 0.18, 0, { f0: 2400, f1: 500, q: 1.2, attack: 0.15 });
export const swish = () => noise(0.13, 0.3, 0, { type: 'highpass', f0: 1500, f1: 4000, q: 0.7, attack: 0.005 });
export const flap = () => noise(0.06, 0.16, 0, { type: 'lowpass', f0: 900, q: 0.8, attack: 0.004 });
export const boing = () => tone('sine', 160, 620, 0.32, 0.32, 0, { vib: [26, 60] });
export const zoom = () => { tone('sawtooth', 250, 1700, 0.28, 0.12, 0, { lp: 2500 }); noise(0.3, 0.2, 0, { f0: 600, f1: 3500, q: 1.5 }); };
export const poof = () => { noise(0.35, 0.35, 0, { type: 'lowpass', f0: 1800, f1: 300, q: 0.7, attack: 0.005 }); tone('sine', 220, 90, 0.25, 0.15); };
export const pop = () => { tone('sine', 380, 1400, 0.08, 0.3); noise(0.03, 0.1, 0, { type: 'highpass', f0: 2500 }); };
export const squeak = () => tone('sine', 1300, 1900, 0.09, 0.14, 0, { vib: [40, 80] });
export const sparkle = () => { for (let i = 0; i < 5; i++) tone('sine', NOTE(88 + Math.floor(Math.random() * 10)), null, 0.18, 0.07, i * 0.06); };

// 接住：軟軟的「噗」＋上升的叮叮叮
export function catchSound(level = 0) {
  tone('sine', 150, 60, 0.18, 0.4);
  noise(0.08, 0.15, 0, { type: 'lowpass', f0: 600 });
  const base = 72 + Math.min(level, 12); // 連續越多，音越高
  [0, 4, 7].forEach((n, i) => tone('triangle', NOTE(base + n), null, 0.22, 0.16, 0.05 + i * 0.07));
}
// 解鎖新花招／里程碑：小號角
export function fanfare() {
  [[72, 0], [76, 0.1], [79, 0.2], [84, 0.32]].forEach(([n, t]) => {
    tone('square', NOTE(n), null, n === 84 ? 0.5 : 0.12, 0.07, t, { lp: 3000, hold: n === 84 ? 0.15 : 0 });
    tone('triangle', NOTE(n - 12), null, 0.2, 0.08, t);
  });
}
// 沒接到：哇哇哇哇～（悲傷長號）
export function sadTrombone(when = 0) {
  [[67, 0, 0.3], [66, 0.32, 0.3], [65, 0.64, 0.3], [64, 0.96, 0.9]].forEach(([n, t, d], i) => {
    tone('sawtooth', NOTE(n - 12), null, d, 0.11, when + t, { lp: 1100, attack: 0.04, hold: d * 0.4, vib: i === 3 ? [6, 6] : null });
  });
}
export function thud() {
  tone('sine', 170, 45, 0.3, 0.7);
  noise(0.12, 0.3, 0, { type: 'lowpass', f0: 400, q: 0.5, attack: 0.002 });
}

// ---------- 掉落時的哨音（音高跟著高度往下滑） ----------
let fall = null;
export function startFall() {
  const c = audio(); if (!c || fall) return;
  const o = c.createOscillator(); o.type = 'sine';
  const lfo = c.createOscillator(), lg = c.createGain();
  lfo.frequency.value = 7; lg.gain.value = 0;
  lfo.connect(lg); lg.connect(o.frequency);
  const g = c.createGain(); g.gain.value = 0.0001;
  g.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.15);
  o.frequency.value = 1500;
  o.connect(g); g.connect(master);
  o.start(); lfo.start();
  fall = { o, g, lg, lfo };
}
// rel：離接住點的高度；wobble：左右搖擺時加顫音；silent：隱形時變小聲
export function setFall(rel, wobble = false, silent = false) {
  if (!fall || !ctx) return;
  const t = ctx.currentTime;
  const f = 450 + Math.max(0, Math.min(rel, 6)) * 180;
  fall.o.frequency.setTargetAtTime(f, t, 0.03);
  fall.lg.gain.setTargetAtTime(wobble ? 60 : 0, t, 0.05);
  fall.g.gain.setTargetAtTime(silent ? 0.012 : 0.06, t, 0.05);
}
export function stopFall() {
  if (!fall || !ctx) return;
  const { o, g, lfo } = fall;
  fall = null;
  const t = ctx.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setTargetAtTime(0.0001, t, 0.03);
  o.stop(t + 0.2); lfo.stop(t + 0.2);
}
