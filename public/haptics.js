// 手機震動回饋＋畫面晃動
// - Android（Chrome 等）：用 navigator.vibrate，支援長短不同的震動節奏
// - iPhone：Safari 不讓網頁震動。舊的「開關元件」輕觸技巧只在 iOS 17.4～26.4 有效（26.5 起被蘋果關掉），
//   所以 iPhone 主要靠「畫面晃動」來補手感
// - 畫面晃動：所有裝置都有，跟震動開關一起開關
let on = true;
try { on = localStorage.getItem('hugduck-haptic') !== '0'; } catch (e) {}

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let iosLabel = null;

function iosTap() {
  try {
    if (!iosLabel) {
      iosLabel = document.createElement('label');
      iosLabel.setAttribute('aria-hidden', 'true');
      iosLabel.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.tabIndex = -1;
      iosLabel.appendChild(input);
      document.body.appendChild(iosLabel);
    }
    iosLabel.click();
  } catch (e) { /* 不支援就算了 */ }
}

export const supported = () => true; // 畫面晃動每台都有
export const isOn = () => on;
export function setOn(v) {
  on = v;
  try { localStorage.setItem('hugduck-haptic', v ? '1' : '0'); } catch (e) {}
}

// pattern：毫秒數，或 [震, 停, 震, ...]
export function buzz(pattern) {
  if (!on) return;
  if (canVibrate) {
    try { navigator.vibrate(pattern); } catch (e) {}
  } else if (isIOS) {
    // iPhone 只能「輕敲」：依節奏裡的震動次數敲幾下
    const p = Array.isArray(pattern) ? pattern : [pattern];
    let t = 0;
    for (let i = 0; i < p.length; i++) {
      if (i % 2 === 0) setTimeout(iosTap, t);
      t += p[i];
    }
  }
}

// ---------- 畫面晃動 ----------
let target = null, shakeAmp = 0, shakeEnd = 0, shakeDur = 1, raf = 0;
export function setShakeTarget(el) { target = el; }
export function shake(px, dur) {
  if (!on || !target) return;
  const now = performance.now();
  if (px >= shakeAmp * Math.max(0, (shakeEnd - now) / shakeDur)) { shakeAmp = px; shakeDur = dur * 1000; shakeEnd = now + shakeDur; }
  if (!raf) raf = requestAnimationFrame(step);
}
function step() {
  const left = shakeEnd - performance.now();
  if (left <= 0 || !target) { if (target) target.style.transform = ''; raf = 0; shakeAmp = 0; return; }
  const a = shakeAmp * (left / shakeDur);
  target.style.transform = `translate(${(Math.random() * 2 - 1) * a}px, ${(Math.random() * 2 - 1) * a}px)`;
  raf = requestAnimationFrame(step);
}

// 各種動作的震動節奏（＋畫面晃動）
export const tap = () => buzz(10);                                      // 按按鈕
export const toss = () => { buzz(18); shake(3, 0.15); };                // 拋鴨
export const hop = () => { buzz(25); shake(3, 0.15); };                 // 彈跳鴨
export const dash = () => { buzz([12, 30, 12]); shake(4, 0.25); };      // 衝刺鴨
export const poof = () => { buzz(15); shake(2, 0.12); };                // 隱形／出現
export const early = () => { buzz([35, 40, 15]); shake(5, 0.18); };     // 太早按
export const reopen = () => buzz(8);                                    // 翅膀再打開
export const caught = () => { buzz([25, 35, 45]); shake(7, 0.25); };    // 接住
export const big = () => { buzz([30, 50, 30, 50, 80]); shake(10, 0.4); }; // 里程碑、解鎖花招
export const miss = () => { buzz([90, 70, 140]); shake(16, 0.5); };     // 摔到地上
export const ding = () => buzz([20, 60, 20]);                           // 朋友加入
export const sad = () => { buzz([60, 80, 60]); shake(5, 0.25); };       // 朋友沒接到
