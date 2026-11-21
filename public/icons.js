// 抱抱鴨自製圖示（取代 emoji）：黑色粗描邊＋奶油白／鴨嘴橘，跟遊戲裡的鴨子同一個風格
const K = '#1b1b1b', W = '#fdfcf8', O = '#f4ad4f', Y = '#ffc35a', P = '#ff7a8a', B = '#7cc8ff', G = '#b9b2a6';
const S = `stroke="${K}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

// 小鴨頭（x, y 是頭的中心，r 是半徑，flip 讓鴨子朝左）
const duckHead = (x, y, r, flip = false) => {
  const d = flip ? -1 : 1;
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${W}" ${S}/>
    <ellipse cx="${x + d * r * 0.95}" cy="${y + r * 0.2}" rx="${r * 0.55}" ry="${r * 0.28}" fill="${O}" ${S}/>
    <circle cx="${x + d * r * 0.3}" cy="${y - r * 0.25}" r="${Math.max(1, r * 0.14)}" fill="${K}"/>`;
};

function PEAR() {
  return `<path d="M12 3c2.8 0 4.8 2.1 4.8 4.8 0 1.1-.3 2.1-.9 2.9 2.3 1.3 3.6 3.5 3.6 5.9 0 2.6-2.6 4.4-7.5 4.4s-7.5-1.8-7.5-4.4c0-2.4 1.3-4.6 3.6-5.9-.6-.8-.9-1.8-.9-2.9C7.2 5.1 9.2 3 12 3z" fill="${W}" ${S}/>
    <circle cx="10.2" cy="7.4" r="1" fill="${K}"/><circle cx="13.8" cy="7.4" r="1" fill="${K}"/>
    <path d="M9 9.7c1.6-1.1 4.4-1.1 6 0-.8 2-5.2 2-6 0z" fill="${O}" ${S}/>`;
}

const ICONS = {
  // 大鴨（拋鴨、網站圖示）：跟遊戲一樣的梨形正面鴨
  duck: PEAR('') ,
  // 小雞鴨（單人、再接一隻）
  chick: `<path d="M12 4.2c.4-1.4 1.8-1.9 2.4-1" fill="none" ${S}/>
    <ellipse cx="12" cy="13.5" rx="7" ry="7.5" fill="${W}" ${S}/>
    <ellipse cx="12" cy="13.8" rx="2.6" ry="1.3" fill="${O}" ${S}/>
    <circle cx="9.4" cy="11" r="1" fill="${K}"/><circle cx="14.6" cy="11" r="1" fill="${K}"/>`,
  // 兩隻抱抱鴨（雙人）：大鴨在後面抱著前面的小鴨
  duo: `<g transform="translate(5 .5) scale(.8)">${PEAR('')}</g>
    <g transform="translate(1.2 8.6) scale(.6)">${PEAR('')}</g>
    <path d="M9.5 18.2c1.6.4 3.2.1 4.6-1" fill="none" ${S}/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="${K}" stroke-width="2.6" stroke-linecap="round"/>`,
  sound: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="${Y}" ${S}/>
    <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" ${S}/>`,
  mute: `<path d="M4 9.5h3l4.5-4v13L7 14.5H4z" fill="${G}" ${S}/>
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" ${S}/>`,
  vibrate: `<rect x="8" y="3.5" width="8" height="17" rx="2" fill="${W}" ${S}/>
    <path d="M11 17.5h2" fill="none" ${S}/>
    <path d="M4.5 8.5l-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5M19.5 8.5l1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5" fill="none" ${S}/>`,
  vibrateOff: `<rect x="8" y="3.5" width="8" height="17" rx="2" fill="${G}" ${S}/>
    <path d="M11 17.5h2" fill="none" ${S}/>
    <path d="M4 4l16 16" fill="none" stroke="${K}" stroke-width="2.4" stroke-linecap="round"/>`,
  trophy: `<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z" fill="${Y}" ${S}/>
    <path d="M7.5 6H5c0 3 1 4.5 3 4.8M16.5 6H19c0 3-1 4.5-3 4.8" fill="none" ${S}/>
    <path d="M12 13.5v3M8.5 20h7l-.8-3.5h-5.4z" fill="${O}" ${S}/>
    <path d="M10.5 7.5l1 1 2-2" fill="none" stroke="${W}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  send: `<path d="M3.5 11.5L20.5 4l-5 16-4-6.5z" fill="${W}" ${S}/>
    <path d="M11.5 13.5L20.5 4" fill="none" ${S}/>`,
  unlock: `<rect x="5" y="11" width="14" height="10" rx="2.5" fill="${Y}" ${S}/>
    <path d="M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2" fill="none" ${S}/>
    <circle cx="12" cy="15.5" r="1.3" fill="${K}"/><path d="M12 16.5v2" fill="none" ${S}/>`,
  warning: `<path d="M12 3.5l9 16H3z" fill="${Y}" ${S}/>
    <path d="M12 9.5v4.5" fill="none" stroke="${K}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="12" cy="17" r="1.3" fill="${K}"/>`,
  party: `<path d="M4 20l4-11 7 7z" fill="${Y}" ${S}/>
    <path d="M6.2 14l3.8 3.8" fill="none" ${S}/>
    <path d="M14 3.5c.3 1.8-.8 2.6-.4 4.2M20.5 10c-1.8-.3-2.6.8-4.2.4" fill="none" ${S}/>
    <circle cx="18.5" cy="5.5" r="1.4" fill="${P}" ${S}/><circle cx="10.5" cy="4.5" r="1.1" fill="${B}" ${S}/><circle cx="20" cy="15.5" r="1.1" fill="${B}" ${S}/>`,
  book: `<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z" fill="${W}" ${S}/>
    <path d="M12 6.5v13" fill="none" ${S}/>
    <path d="M6.5 8.5c1.3-.1 2.5.1 3.5.6M6.5 11.5c1.3-.1 2.5.1 3.5.6M14 9.1c1-.5 2.2-.7 3.5-.6" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>`,
  star: `<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" fill="${Y}" ${S}/>`,
  // 鴨幣：金幣上有一隻很開心的鴨子
  coin: `<circle cx="12" cy="12" r="9.5" fill="#ffc94a" ${S}/>
    <circle cx="12" cy="12" r="7.3" fill="none" stroke="#e6a21f" stroke-width="1.3"/>
    <path d="M12 6.2c2.2 0 3.6 1.6 3.6 3.6 0 .8-.2 1.5-.6 2.1 1.5.9 2.3 2.3 2.3 3.6 0 1.6-2 2.4-5.3 2.4s-5.3-.8-5.3-2.4c0-1.3.8-2.7 2.3-3.6-.4-.6-.6-1.3-.6-2.1 0-2 1.4-3.6 3.6-3.6z" fill="${W}" stroke="${K}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M10 9.3q.6-.7 1.2 0M12.8 9.3q.6-.7 1.2 0" fill="none" stroke="${K}" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M10.6 10.8c.9-.5 1.9-.5 2.8 0-.3 1.1-2.5 1.1-2.8 0z" fill="${O}" stroke="${K}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M8.8 15.2c1 .5 1.8.5 2.4.2M15.2 15.2c-1 .5-1.8.5-2.4.2" fill="none" stroke="${K}" stroke-width="1.1" stroke-linecap="round"/>`,
  shop: `<path d="M4 9h16l-1 11H5z" fill="${W}" ${S}/>
    <path d="M3 9l2-4.5h14L21 9z" fill="#ff8fb1" ${S}/>
    <path d="M9 9V7.5a3 3 0 0 1 6 0V9" fill="none" ${S}/>
    <circle cx="12" cy="14.5" r="2.4" fill="#ffc94a" ${S}/>`,
  bowtie: `<path d="M12 12L4 7.5v9zM12 12l8-4.5v9z" fill="#e8524a" ${S}/><circle cx="12" cy="12" r="2" fill="#e8524a" ${S}/>`,
  scarf: `<path d="M4 8c5 3 11 3 16 0v4c-5 3-11 3-16 0z" fill="#e8524a" ${S}/><path d="M13 13.5l1.5 7 3-1-1.2-6.8" fill="#e8524a" ${S}/><path d="M14.2 17h2.6" fill="none" stroke="${W}" stroke-width="1.5"/>`,
  chef: `<path d="M8 13h8v6H8z" fill="${W}" ${S}/><path d="M8 13c-3 0-4-5 0-5 0-3 8-3 8 0 4 0 3 5 0 5z" fill="${W}" ${S}/>`,
  crown: `<path d="M4 18l-1-10 5 4 4-7 4 7 5-4-1 10z" fill="#ffc94a" ${S}/><circle cx="12" cy="14.5" r="1.4" fill="#e8524a" ${S}/>`,
  wizard: `<path d="M3 19.5h18" fill="none" stroke="#7b5cd6" stroke-width="3.2" stroke-linecap="round"/><path d="M3 19.5h18" fill="none" ${S}/><path d="M6 19L13 3l4 16z" fill="#7b5cd6" ${S}/><path d="M12 11l.7 1.4 1.5.2-1.1 1 .3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1 1.5-.2z" fill="#ffc94a"/>`,
  beanie: `<path d="M5 15a7 7 0 0 1 14 0z" fill="#5cbf6a" ${S}/><rect x="4" y="14.5" width="16" height="4" rx="1.5" fill="#fff4dc" ${S}/><circle cx="12" cy="5.5" r="2" fill="#fff4dc" ${S}/>`,
  heart: `<path d="M12 20s-7.5-4.5-7.5-10A4 4 0 0 1 12 7.5 4 4 0 0 1 19.5 10C19.5 15.5 12 20 12 20z" fill="${P}" ${S}/>`,
};

// 夥伴小鴨的小配件（商城預覽用）
const ACC = {
  bow: `<path d="M12 5L8.5 3v4zM12 5l3.5-2v4z" fill="#ff8fb1" ${S}/>`,
  cap: `<path d="M6 9a6 6 0 0 1 12 0z" fill="#5aa9e6" ${S}/><path d="M12 9h7" fill="none" stroke="#5aa9e6" stroke-width="2.6" stroke-linecap="round"/>`,
  shades: `<rect x="7" y="9.8" width="4.2" height="2.6" rx="1" fill="#2b2b2b"/><rect x="12.8" y="9.8" width="4.2" height="2.6" rx="1" fill="#2b2b2b"/><path d="M11 11h2" stroke="#2b2b2b" stroke-width="1.2"/>`,
  leaf: `<path d="M12 6c1-3 4-3.5 5-2.5-1 2.5-3 3-5 2.5z" fill="#5cbf6a" ${S}/>`,
};

// 獎牌：1 金、2 銀、3 銅
function medal(n) {
  const c = ['#ffc94a', '#d9dde3', '#e0a370'][n - 1];
  return `<path d="M8 3l2.5 6M16 3l-2.5 6" fill="none" stroke="${n === 1 ? P : n === 2 ? B : '#a7d97a'}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="12" cy="15" r="6" fill="${c}" ${S}/>
    <text x="12" y="18.2" text-anchor="middle" font-size="8.5" font-weight="900" font-family="-apple-system,'PingFang TC',sans-serif" fill="${K}">${n}</text>`;
}

export function icon(name, size = 22) {
  if (name.startsWith('chick-')) {
    const col = '#' + name.slice(6, 12);
    const extra = name.slice(13);
    const body = ICONS.chick.replace(`fill="${W}"`, `fill="${col}"`) + (ACC[extra] || '');
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  const body = name === 'gold' ? medal(1) : name === 'silver' ? medal(2) : name === 'bronze' ? medal(3) : ICONS[name];
  if (!body) return '';
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

// 文字跟圖示一起放進元素（文字一律當純文字處理，名字之類的不會被當成 HTML）
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function setLabel(el, text, name, { after = false, size = 22 } = {}) {
  const ic = name ? icon(name, size) : '';
  el.innerHTML = after ? `${esc(text)}${ic}` : `${ic}${esc(text)}`;
}

// 把頁面上所有 <span data-ic="名稱"></span> 換成圖示
export function fillIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = icon(el.dataset.ic, +(el.dataset.size || 22)); });
}

// 網站分頁圖示
export function setFavicon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${ICONS.duck}</svg>`;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
