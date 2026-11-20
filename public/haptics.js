// 手機震動回饋
// - Android（Chrome 等）：用 navigator.vibrate，支援長短不同的震動節奏
// - iPhone：Safari 不支援 vibrate，改用 iOS 18 以上「開關元件」的輕觸回饋（只有輕輕一下，無法調強弱）
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

export const supported = () => canVibrate || isIOS;
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

// 各種動作的震動節奏
export const tap = () => buzz(10);             // 按按鈕
export const toss = () => buzz(18);            // 拋鴨
export const hop = () => buzz(25);             // 彈跳鴨
export const dash = () => buzz([12, 30, 12]);  // 衝刺鴨
export const poof = () => buzz(15);            // 隱形／出現
export const early = () => buzz([35, 40, 15]); // 太早按
export const reopen = () => buzz(8);           // 翅膀再打開
export const caught = () => buzz([25, 35, 45]); // 接住
export const big = () => buzz([30, 50, 30, 50, 80]); // 里程碑、解鎖花招
export const miss = () => buzz([90, 70, 140]); // 摔到地上
export const ding = () => buzz([20, 60, 20]);  // 朋友加入
export const sad = () => buzz([60, 80, 60]);   // 朋友沒接到
