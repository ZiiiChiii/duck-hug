import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeVertices } from './vendor/BufferGeometryUtils.js';
import { hasServer, serverRoom, submitScore, topScores } from './net.js';
import * as sfx from './sfx.js';
import * as hap from './haptics.js';
import { icon, setLabel, fillIcons, setFavicon } from './icons.js';
fillIcons();
setFavicon();

// ---------- 基本場景 ----------
const BG = 0xefebe4;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(BG);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c5, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(3, 6, 5);
scene.add(sun);
const back = new THREE.DirectionalLight(0xffffff, 0.6);
back.position.set(-4, 3, -5);
scene.add(back);

// 卡通三階色調
const gradient = new THREE.DataTexture(new Uint8Array([170, 225, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const mat = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
const WHITE = mat(0xfdfcf8);
const ORANGE = mat(0xf4ad4f);
const BLACK = new THREE.MeshBasicMaterial({ color: 0x1b1b1b });

// 黑色描邊（反向外殼，固定粗細，可承受非等比縮放）
const outlineMat = new THREE.ShaderMaterial({
  uniforms: { thickness: { value: 0.028 } },
  vertexShader: `
    uniform float thickness;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      mv.xyz += n * thickness * clamp(-mv.z / 6.0, 0.6, 2.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `void main(){ gl_FragColor = vec4(0.09,0.09,0.09,1.0); }`,
  side: THREE.BackSide,
});

// 描邊用平滑法線，避免方角處破洞
const outlineCache = new WeakMap();
function smoothOutline(geom) {
  if (outlineCache.has(geom)) return outlineCache.get(geom);
  const g = geom.clone();
  g.deleteAttribute('normal');
  if (g.attributes.uv) g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-4);
  m.computeVertexNormals();
  outlineCache.set(geom, m);
  return m;
}

function part(geom, material, outline = true) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geom, material));
  if (outline) g.add(new THREE.Mesh(smoothOutline(geom), outlineMat));
  return g;
}

const SPHERE = new THREE.SphereGeometry(1, 48, 32);
function blob(material, sx, sy, sz, outline = true) {
  const p = part(SPHERE, material, outline);
  p.scale.set(sx, sy, sz);
  return p;
}

// 蛋形身體（車床旋轉）
// 梨形：下面一個大圓肚子 + 上面一個小圓頭，用平滑接起來
function egg(R, H) {
  const bc = 0.39 * H, bv = 0.39 * H;          // 肚子
  const hr = 0.63 * R, hv = 0.3 * H, hc = H - hv; // 頭
  const ell = (y, rx, c, v) => { const d = (y - c) / v; return d * d >= 1 ? 0 : rx * Math.sqrt(1 - d * d); };
  const r = (y) => {
    const a = ell(y, R, bc, bv), b = ell(y, hr, hc, hv);
    if (a === 0 || b === 0) return Math.max(a, b);
    const k = 0.22 * R, h = THREE.MathUtils.clamp(0.5 + 0.5 * (a - b) / k, 0, 1);
    return b + (a - b) * h + k * h * (1 - h);
  };
  const pts = [];
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const y = (i / N) * H;
    pts.push(new THREE.Vector2(Math.max(r(y), 0.0001), y));
  }
  const geom = new THREE.LatheGeometry(pts, 72);
  geom.computeVertexNormals();
  return { geom, r };
}
const onSurface = (r, y, theta, out = 0) =>
  new THREE.Vector3(Math.sin(theta) * (r(y) + out), y, Math.cos(theta) * (r(y) + out));

// 鴨掌
function footGeom(s) {
  const sh = new THREE.Shape();
  sh.moveTo(-0.07 * s, 0);
  sh.lineTo(-0.19 * s, 0.24 * s);
  sh.quadraticCurveTo(-0.15 * s, 0.33 * s, -0.08 * s, 0.26 * s);
  sh.quadraticCurveTo(0, 0.36 * s, 0.08 * s, 0.26 * s);
  sh.quadraticCurveTo(0.15 * s, 0.33 * s, 0.19 * s, 0.24 * s);
  sh.lineTo(0.07 * s, 0);
  sh.quadraticCurveTo(0, -0.06 * s, -0.07 * s, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.035 * s, bevelEnabled: true, bevelThickness: 0.02 * s, bevelSize: 0.02 * s, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  g.center();
  return g;
}
const FOOT_LINE = new THREE.MeshBasicMaterial({ color: 0x171717, side: THREE.BackSide });
function foot(s, x, z, rotY = 0) {
  const geom = footGeom(s);
  const f = new THREE.Group();
  f.add(new THREE.Mesh(geom, ORANGE));
  const line = new THREE.Mesh(geom, FOOT_LINE);
  line.scale.set(1.09, 1.5, 1.09);
  f.add(line);
  f.position.set(x, 0.05, z + 0.14 * s);
  f.rotation.y = rotY;
  return f;
}

// 扁平翅膀：白色翼片 + 一圈黑色描邊（翅膀疊在身體上也看得出邊）
const RIM = new THREE.MeshBasicMaterial({ color: 0x171717 });
function makeWing(Lw, W, bend) {
  const sh = new THREE.Shape();
  sh.moveTo(0, W * 0.85);
  sh.bezierCurveTo(-0.22 * Lw / 0.6, W * 1.35, -0.48 * Lw / 0.6, W * 1.05, -Lw, 0.05);
  // 末端波浪（像手指）
  sh.quadraticCurveTo(-Lw - 0.065, -0.005, -Lw + 0.015, -0.045);
  sh.quadraticCurveTo(-Lw - 0.045, -0.1, -Lw + 0.055, -0.125);
  sh.quadraticCurveTo(-Lw - 0.0, -0.19, -Lw + 0.12, -0.17);
  sh.bezierCurveTo(-0.36 * Lw / 0.6, -W * 1.15, -0.16 * Lw / 0.6, -W * 1.0, 0, -W * 0.75);
  // 有厚度的翅膀：圓角＋中間鼓起來，像一塊軟軟的羽毛墊
  const depth = 0.05, bt = 0.045, bs = 0.04;
  const flat = new THREE.ExtrudeGeometry(sh, {
    depth, curveSegments: 16, steps: 1,
    bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelOffset: -bs, bevelSegments: 4,
  });
  flat.translate(0, 0, -depth / 2);
  {
    const pos = flat.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (Math.abs(z) < depth / 2) continue;
      const puff = 1 - Math.min(1, Math.abs(pos.getY(i)) / (W * 1.2));
      const tipFade = THREE.MathUtils.clamp((Lw + pos.getX(i)) / 0.15, 0.35, 1); // 指尖比較薄
      pos.setZ(i, z * (1 + 1.1 * puff * tipFade));
    }
  }
  const pts = sh.getPoints(16).map((p) => new THREE.Vector3(p.x, p.y, 0));
  const rim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.04, 12, false);
  // 中段往外拱、兩端貼著身體，像環抱
  for (const g of [flat, rim]) {
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = THREE.MathUtils.clamp(-pos.getX(i) / Lw, 0, 1.15);
      pos.setZ(i, pos.getZ(i) + bend * 4 * u * (1 - u));
    }
    g.computeVertexNormals();
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(flat, WHITE));
  grp.add(new THREE.Mesh(rim, RIM));
  return grp;
}
// 把翅膀從 root 擺向 tip，翼面朝 faceDir
function wingBetween(root, tip, W, bulge, faceDir) {
  const w = makeWing(root.distanceTo(tip), W, bulge);
  placeWing(w, root, tip, faceDir);
  return w;
}
function placeWing(w, root, tip, faceDir) {
  const x = root.clone().sub(tip).normalize();
  const z = faceDir.clone().normalize();
  z.sub(x.clone().multiplyScalar(z.dot(x))).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  w.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  w.position.copy(root);
  w.userData.baseZ = root.z;
}

// 羽毛末端的小波浪（像手指）
function fingers(material, count, size, spacing) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const b = blob(material, size, size * 0.9, size * 0.8);
    b.position.set(0, (i - (count - 1) / 2) * spacing, 0);
    g.add(b);
  }
  return g;
}

function eye(r, y, theta, size) {
  const e = new THREE.Mesh(SPHERE, BLACK);
  e.scale.set(size, size * 1.15, size * 0.6);
  e.position.copy(onSurface(r, y, theta, -0.005));
  e.lookAt(e.position.clone().multiplyScalar(2).setY(y));
  return e;
}

// 微微張開、像在笑的嘴巴
const MOUTH = mat(0x6e2f2b);
function smileBeak(r, y, k) {
  const g = new THREE.Group();
  const z0 = r(y);
  // 上嘴：嘴尖稍微翹起來
  const upper = blob(ORANGE, 0.25, 0.085, 0.19);
  upper.position.set(0, 0.07, 0.05);
  upper.rotation.x = -0.34;
  g.add(upper);
  // 嘴巴裡面（深色）
  const inside = blob(MOUTH, 0.18, 0.085, 0.13, false);
  inside.position.set(0, -0.005, 0.07);
  g.add(inside);
  // 下嘴：往下張開，形狀像微笑的弧線
  const lower = part(SPHERE, ORANGE); // 完整的形狀，從任何角度看都是實心的
  lower.scale.set(0.17, 0.065, 0.14);
  lower.position.set(0, -0.085, 0.045);
  lower.rotation.x = 0.42;
  g.add(lower);
  g.scale.setScalar(k);
  g.position.set(0, y, z0);
  return g;
}

// ---------- 大鴨鴨 ----------
function bigDuck() {
  const duck = new THREE.Group();
  const body = new THREE.Group();
  duck.add(body);
  const { geom, r } = egg(0.98, 2.3);
  body.add(part(geom, WHITE));

  body.add(eye(r, 1.86, -0.4, 0.06));
  body.add(eye(r, 1.86, 0.4, 0.06));

  body.add(smileBeak(r, 1.64, 1));
  // 另一邊翅膀貼在背側

  const tail = blob(WHITE, 0.2, 0.13, 0.16);
  tail.position.copy(onSurface(r, 0.55, Math.PI, -0.06));
  tail.rotation.x = 0.5;
  body.add(tail);

  duck.add(foot(1.15, -0.28, 0.32, 0.25));
  duck.add(foot(1.15, 0.3, 0.3, -0.2));
  // 苦惱時摸頭的翅膀（平常隱藏）
  const scratch = wingBetween(onSurface(r, 1.12, 1.3, -0.08), new THREE.Vector3(0.44, 2.06, 0.3), 0.19, 0.16, new THREE.Vector3(1, 0.25, 0.35));
  scratch.visible = false;
  scratch.userData.baseQ = scratch.quaternion.clone();
  body.add(scratch);
  duck.userData = { body, scratch };
  return duck;
}

// ---------- 小鴨鴨 ----------
function smallDuck() {
  const duck = new THREE.Group();
  const body = new THREE.Group();
  duck.add(body);
  const { geom, r } = egg(0.66, 1.55);
  body.add(part(geom, WHITE));

  const eyes = [eye(r, 1.23, -0.42, 0.048), eye(r, 1.23, 0.34, 0.048)];
  eyes.forEach((e) => body.add(e));

  const mouth = smileBeak(r, 0.98, 0.82);
  body.add(mouth);


  const tail = blob(WHITE, 0.14, 0.09, 0.12);
  tail.position.copy(onSurface(r, 0.36, Math.PI, -0.04));
  tail.rotation.x = 0.5;
  body.add(tail);

  duck.add(foot(0.85, -0.2, 0.22, 0.3));
  duck.add(foot(0.85, 0.2, 0.22, -0.15));
  duck.userData = { body, eyes, mouth };
  return duck;
}

const big = bigDuck();
big.position.set(0, 0, -0.2);
big.rotation.y = 0;
const small = smallDuck();
small.scale.setScalar(0.74); // 約大鴨的 1/2 高、1/4 大小
const SMALL_LIFT = 0.36; // 被抱起來、腳離地
small.position.set(0, SMALL_LIFT, 1.04);
small.rotation.y = 0.12;
const ducks = new THREE.Group();
ducks.add(big, small);
ducks.position.y = 0;
scene.add(ducks);

// 大鴨用翅膀把小鴨抱在胸前
// 大鴨的左右翅膀都從自己身體兩側往前伸，碰到小鴨的身體
const hugWings = [-1, 1].map((side) => {
  const w = wingBetween(
    new THREE.Vector3(side * 0.74, 1.02, 0.38),
    new THREE.Vector3(side * 0.5, 0.8, 1.25),
    0.2, 0.13,
    new THREE.Vector3(side, 0.25, 0.25)
  );
  scene.add(w);
  w.userData.side = side;
  w.userData.baseX = w.position.x;
  w.userData.baseY = w.position.y;
  w.userData.baseQ = w.quaternion.clone();
  return w;
});

// 地面柔和陰影
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(90,75,55,0.28)');
  grd.addColorStop(1, 'rgba(90,75,55,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 3.0),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, 0.002, 0.3);
  scene.add(shadow);
}

// 愛心
const heartTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 70);
  g.beginPath();
  g.moveTo(0, 38);
  g.bezierCurveTo(-60, -4, -36, -56, 0, -24);
  g.bezierCurveTo(36, -56, 60, -4, 0, 38);
  g.fillStyle = '#ff7a8a';
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#2a2a2a';
  g.stroke();
  return new THREE.CanvasTexture(c);
})();
const hearts = [];
function popHearts() {
  sfx.sparkle();
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
    s.position.set((Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6);
    s.scale.setScalar(0.001);
    s.userData = { t: -i * 0.12, vx: (Math.random() - 0.5) * 0.4 };
    scene.add(s);
    hearts.push(s);
  }
}

// ---------- 相機與操作 ----------
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0.3);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.rotateSpeed = 0.9;
controls.minDistance = 3.2;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.82;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.6;

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  return 7.2 * Math.max(1, 0.85 / aspect);
}
const dist = fitCamera();
camera.position.set(0, 1.9, dist);
const qs = new URLSearchParams(location.search);
const angleParam = qs.get('angle');
if (angleParam !== null) {
  const a = THREE.MathUtils.degToRad(+angleParam);
  const d = dist * (+qs.get('zoom') || 1);
  camera.position.set(Math.sin(a) * d, 1.9, Math.cos(a) * d);
  controls.autoRotate = false;
}
controls.update();

let idleTimer;
const hint = document.getElementById('hint');
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  clearTimeout(idleTimer);
  hint.classList.add('hide');
});
controls.addEventListener('end', () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => (controls.autoRotate = true), 4000);
});

// ---------- 呱呱聲（Web Audio 合成，不用音檔） ----------
const audio = sfx.audio;
function quack(when, pitch = 1, vol = 0.5, len = 0.17) {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520 * pitch, t0);
  osc.frequency.exponentialRampToValueAtTime(380 * pitch, t0 + len * 0.45);
  osc.frequency.exponentialRampToValueAtTime(300 * pitch, t0 + len);
  // 鴨子的「鼻音」：兩個共振峰
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass'; f1.frequency.value = 1050 * pitch; f1.Q.value = 3.5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass'; f2.frequency.value = 2500 * pitch; f2.Q.value = 5;
  const g2 = ctx.createGain(); g2.gain.value = 0.6;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
  amp.gain.setValueAtTime(vol, t0 + len * 0.55);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  osc.connect(f1); osc.connect(f2); f2.connect(g2);
  f1.connect(amp); g2.connect(amp);
  amp.connect(sfx.out());
  osc.start(t0);
  osc.stop(t0 + len + 0.02);
}
function quackQuack() {
  const v = 0.9 + Math.random() * 0.15;
  quack(0, 0.95 * v, 0.55, 0.18);      // 大鴨：呱
  quack(0.2, 0.95 * v, 0.5, 0.16);     //       呱
  quack(0.46, 1.45 * v, 0.4, 0.12);    // 小鴨：呱（比較高）
}

// 輕點 → 抱緊一下 + 呱呱
let squeeze = 0;
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => (audio(), down = { x: e.clientX, y: e.clientY, t: performance.now() }));
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  if (moved < 8 && performance.now() - down.t < 350 && (state === 'idle' || state === 'caught')) {
    squeeze = 1;
    popHearts();
    sfx.squeak();
    quackQuack();
    hap.caught();
  }
  down = null;
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
});

// ---------- 小遊戲：接住小鴨 ----------
const bubble = document.getElementById('bubble');
const actionBtn = document.getElementById('action');
const toastEl = document.getElementById('toast');
const scoreEl = document.getElementById('score');
const CATCH_Y = SMALL_LIFT;              // 被抱住時小鴨的高度
let WIN_HI = 0.8, WIN_LO = -0.45;        // 接住的時機範圍（相對 CATCH_Y），越後面越窄（已放寬）
const HOLD_Z = 1.04, GROUND_Z = 1.62;
let state = 'idle';                       // idle / toss / wait / fall / caught / miss
let stateT = 0;
let smallY = CATCH_Y, smallZ = HOLD_Z, smallX = 0, vel = 0, waitFor = 0;
let wingsClosed = true;                   // 玩家按下接住後翅膀合起來
let earlyCooldown = 0;                    // 太早按：0.1 秒後翅膀再打開，可以再按一次
let wingOpen = 0;                         // 翅膀實際張開程度（平滑）
let wingDY = 0, wingLift = 0, bigDip = 0;   // 拋鴨時翅膀的上下位置、抬起角度、大鴨蹲低
let tossVel = 0, tossReleased = false, tossFromGround = false;
let mode = 'solo';                        // solo / duo
let role = null;                          // 雙人：thrower 拋鴨的人 / catcher 接鴨的人
let resultSent = false;
let lastScore = 0;
let streak = 0, best = 0, spoke = false, landed = false;
const bestKey = () => (mode === 'duo' ? 'hugduck-best-duo' : mode === 'multi' ? 'hugduck-best-multi' : 'hugduck-best');
function loadBest() { try { best = +localStorage.getItem(bestKey()) || 0; } catch (e) { best = 0; } }
loadBest();
let speedMul = 1;
const vmax = () => Math.min(Math.min(3.0 + streak * 0.3, 6.0) * speedMul, 8); // 最快不超過 8，避免衝刺鴨快到接不到

// ---------- 掉落花招（接越多隻，解鎖越多、越常出現） ----------
// unlock：連續接住幾隻後開始出現
const TRICKS = [
  { id: 'hop',    unlock: 2,  name: '彈跳鴨！',   tip: '掉一半會往上彈' },
  { id: 'hover',  unlock: 4,  name: '飄浮鴨！',   tip: '半空中停住，再突然掉' },
  { id: 'dash',   unlock: 6,  name: '衝刺鴨！',   tip: '慢慢掉，然後突然加速' },
  { id: 'zigzag', unlock: 8,  name: '搖擺鴨！',   tip: '左右飄來飄去' },
  { id: 'vanish', unlock: 10, name: '隱形鴨！',   tip: '掉到一半消失，快到才出現' },
  { id: 'double', unlock: 12, name: '二段跳鴨！', tip: '連彈兩次' },
];
let trick = null;           // 這一輪的花招（可能組合兩個）
let trickState = {};
function pickTrick() {
  const open = TRICKS.filter((t) => streak >= t.unlock);
  // 前幾隻普通掉；之後出現花招的機率越來越高
  const chance = open.length === 0 ? 0 : Math.min(0.45 + streak * 0.04, 0.9);
  const list = [];
  if (Math.random() < chance) {
    list.push(open[Math.floor(Math.random() * open.length)]);
    // 接 14 隻以上：有機會疊兩種花招
    if (streak >= 14 && Math.random() < 0.5) {
      const others = open.filter((t) => t !== list[0] && !(list[0].id === 'hop' && t.id === 'double') && !(list[0].id === 'double' && t.id === 'hop'));
      if (others.length) list.push(others[Math.floor(Math.random() * others.length)]);
    }
  }
  trick = list;
  const r = (a, b) => a + Math.random() * (b - a);
  trickState = {
    hopAt: r(1.6, 3.0), hops: list.some((t) => t.id === 'double') ? 2 : list.some((t) => t.id === 'hop') ? 1 : 0, hopDone: 0,
    hoverAt: r(1.3, 2.6), hoverFor: r(0.35, 1.1), hoverT: 0, hovered: false,
    dashAt: r(1.2, 2.2), dashed: false,
    zigAmp: r(0.45, 0.7), zigSpeed: r(5, 8),
    vanishFrom: r(2.4, 3.0), vanishTo: r(0.8, 1.1),
  };
  // 時機範圍隨連續次數變窄
  WIN_HI = Math.max(0.8 - streak * 0.01, 0.55);
  WIN_LO = Math.min(-0.45 + streak * 0.005, -0.32);
  speedMul = 1;
}
const has = (id) => trick && trick.some((t) => t.id === id);

// ---------- 鴨子圖鑑：遇過／接住過的特殊鴨子（存在這支手機裡） ----------
const dex = { seen: [], caught: [] };
try { Object.assign(dex, JSON.parse(localStorage.getItem('hugduck-dex') || '{}')); } catch (e) {}
const saveDex = () => { try { localStorage.setItem('hugduck-dex', JSON.stringify(dex)); } catch (e) {} };
function recordSeen(list) {
  let changed = false;
  for (const t of list || []) if (!dex.seen.includes(t.id)) { dex.seen.push(t.id); changed = true; }
  if (changed) saveDex();
}
// 回傳「第一次接住」的種類（成就只出現一次）
function recordCaught(list) {
  const firsts = [];
  for (const t of list || []) {
    if (!dex.seen.includes(t.id)) dex.seen.push(t.id);
    if (!dex.caught.includes(t.id)) { dex.caught.push(t.id); firsts.push(t); }
  }
  if (firsts.length) saveDex();
  return firsts;
}

function setState(s) {
  if (s !== 'fall') sfx.stopFall();
  if (s === 'toss') { tossReleased = false; tossFromGround = state === 'miss'; }
  if (s !== 'toss') bigDip = 0;
  state = s; stateT = 0; spoke = false;
}
function setButton(text, enabled = true, ic = null) { setLabel(actionBtn, text, ic, { size: 26 }); actionBtn.disabled = !enabled; }
function updateScore() { scoreEl.textContent = `${mode === 'duo' ? '雙人合作 ' : mode === 'multi' ? '派對 ' : ''}連續接住 ${streak} 隻　最佳 ${best} 隻`; }
let toastTimer;
function toast(text, ic = null) {
  setLabel(toastEl, text, ic, { size: 30 });
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1200);
}
function say(text, pitch, rate, delay = 0) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW'; u.pitch = pitch; u.rate = rate;
    speechSynthesis.cancel();
    setTimeout(() => speechSynthesis.speak(u), delay);
  } catch (e) { /* 不支援語音就只顯示文字 */ }
}
function showBubble(text) { bubble.textContent = text; bubble.classList.add('show'); }
function hideBubble() { bubble.classList.remove('show'); }

function sob() { // 小鴨哭：嗚嗚（往下滑的高音呱）
  quack(1.4, 1.5, 0.35, 0.35);
  quack(1.85, 1.4, 0.3, 0.45);
}

function resetLooks() {
  hideBubble();
  controls.autoRotate = false;
  big.userData.scratch.visible = false;
  hugWings[1].visible = true;
  small.userData.mouth.scale.setScalar(0.82);
  earlyCooldown = 0;
  resultSent = false;
}
function startRound() {
  audio(); // 使用者按按鈕 → 解鎖聲音
  show(submitEl, false);
  resetLooks();
  setState('toss');
  setButton('接住！');
}
// 雙人：把鴨子拋給朋友
function doThrow() {
  audio();
  show(submitEl, false);
  resetLooks();
  pickTrick();
  setState('toss');
  setButton('拋出去了！', false);
}
function tryCatch() {
  if (state === 'wait' || state === 'fall') {
    if (!wingsClosed) {
      wingsClosed = true;
      const rel = smallY - CATCH_Y;
      if (state === 'fall' && rel <= WIN_HI && rel >= WIN_LO) {
        // 時機剛好 → 接住
        setState('caught');
        sfx.stopFall();
        smallY = CATCH_Y; vel = 0; small.visible = true;
        squeeze = 1;
        streak++;
        if (streak > best) { best = streak; try { localStorage.setItem(bestKey(), best); } catch (e) {} }
        updateScore();
        const firsts = recordCaught(trick);
        if (firsts.length || streak % 5 === 0) { sfx.fanfare(); hap.big(); } else { sfx.catchSound(streak); hap.caught(); }
        if (firsts.length) firsts.forEach((tr) => achieve(`成功接住${tr.name.replace('！', '')}`));
        else toast(streak >= 3 ? `接得好！連續 ${streak} 隻` : '接得好！');

        setButton('…', false);
      } else {
        toast('太早了！');
        sfx.swish(); hap.early();
        earlyCooldown = 0.1;
        setButton('…', false);
      }
    }
  }
}
// 所有按鈕：按下就有「噗」的回饋音（盡早解鎖手機的聲音）
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('button');
  if (b && !b.disabled) { audio(); sfx.click(); hap.tap(); }
}, true);
// 關掉 iPhone 的雙指縮放、連點放大（遊戲畫面本身的雙指縮放照常）
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
const muteBtn = document.getElementById('muteBtn');
const drawMute = () => { muteBtn.innerHTML = icon(sfx.isMuted() ? 'mute' : 'sound', 20); };
drawMute();
hap.setShakeTarget(renderer.domElement);
const hapBtn = document.getElementById('hapBtn');
const drawHap = () => { hapBtn.innerHTML = icon(hap.isOn() ? 'vibrate' : 'vibrateOff', 20); };
if (!hap.supported()) hapBtn.classList.add('hidden');
drawHap();
hapBtn.addEventListener('click', (e) => { e.stopPropagation(); hap.setOn(!hap.isOn()); drawHap(); if (hap.isOn()) hap.caught(); });
muteBtn.addEventListener('click', (e) => { e.stopPropagation(); audio(); sfx.setMuted(!sfx.isMuted()); drawMute(); });
actionBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const ready = state === 'idle' || state === 'caught' || state === 'miss';
  if (mode === 'solo') { if (ready) startRound(); else tryCatch(); }
  else if (role === 'thrower' && ready) { if (!players.length) { toast('房間裡還沒有其他人'); return; } doThrow(); }
  else tryCatch();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); actionBtn.click(); }
});
setButton('開始遊戲');
updateScore();

// ---------- 連線房間：雙人（2 人）＋多人派對（最多 8 人） ----------
// 拋鴨的人按「拋出鴨！」→ 隨機挑房間裡另一個人接 → 接的人（不管有沒有接住）變成下一個拋鴨的人
const menuEl = document.getElementById('menu');
const duoEl = document.getElementById('duo');
const duoMsg = document.getElementById('duoMsg');
const duoTitle = document.getElementById('duoTitle');
const lobbyEl = document.getElementById('lobby');
const startBtn = document.getElementById('startBtn');
const nameIn = document.getElementById('nameIn');
const codeIn = document.getElementById('codeIn');
const roomEl = document.getElementById('room');
const menuBtn = document.getElementById('menuBtn');
const MAX_PLAYERS = 8;
let net = null, roomCode = null, isHost = false, roomKind = 'duo', mySeq = 0;
let myPeer = null, players = [], partner = null, started = false;
let currentThrower = null, pendingTarget = null, joinedAt = 0;
const seen = {};
let lostTimer = null;
try { nameIn.value = localStorage.getItem('hugduck-name') || ''; } catch (e) {}

function show(el, on) { el.classList.toggle('hidden', !on); }
function myName() { return (nameIn.value || '').trim().slice(0, 10) || '玩家'; }
const nameOf = (peer) => (peer === myPeer ? myName() : (players.find((x) => x.peer === peer) || {}).name || '朋友');
function openMenu() {
  leaveRoom();
  mode = 'solo'; role = null; streak = 0; loadBest(); updateScore();
  resetLooks(); setState('idle'); smallY = CATCH_Y; smallZ = HOLD_Z;
  show(menuEl, true); show(duoEl, false); show(actionBtn, false); show(roomEl, false);
  show(boardEl, false); show(submitEl, false); show(document.getElementById('inviteBtn'), false);
  show(document.getElementById('dex'), false);
}
function leaveRoom() {
  if (net && roomCode) net.presence({ code: null, msg: null, name: null, host: null, kind: null }).catch(() => {});
  roomCode = null; partner = null; isHost = false; players = []; started = false;
  currentThrower = null; pendingTarget = null;
  clearTimeout(lostTimer); lostTimer = null;
}
document.getElementById('soloBtn').addEventListener('click', () => {
  mode = 'solo'; streak = 0; loadBest(); updateScore();
  show(menuEl, false); show(actionBtn, true);
  setButton('開始遊戲');
});
function openRoomPanel(kind) {
  roomKind = kind;
  setLabel(duoTitle, kind === 'multi' ? '多人派對' : '雙人連線', kind === 'multi' ? 'party' : 'duo', { size: 26 });
  show(menuEl, false); show(duoEl, true);
  show(lobbyEl, false); show(startBtn, false); show(document.getElementById('roomJoin'), true);
  duoMsg.textContent = kind === 'multi' ? '3～8 人一起玩，拋出去的鴨子會隨機飛給其中一個人！' : '';
}
document.getElementById('duoBtn').addEventListener('click', () => openRoomPanel('duo'));
document.getElementById('multiBtn').addEventListener('click', () => openRoomPanel('multi'));
document.getElementById('backBtn').addEventListener('click', openMenu);
menuBtn.addEventListener('click', openMenu);

async function getNet() {
  if (net) return net;
  duoMsg.textContent = '連線中…';
  try {
    if (await hasServer()) net = await serverRoom();
    else if (window.claude && typeof window.claude.use === 'function') net = await window.claude.use('room');
  } catch (e) { net = null; }
  if (!net) {
    duoMsg.textContent = (await hasServer())
      ? '連不上伺服器，請檢查網路後再試一次。'
      : '這個裝置目前無法連線。預覽版只能在登入同一個 claude.ai 帳號的裝置之間連線。';
    return null;
  }
  net.onPeers(onPeersChange, () => {
    duoMsg.textContent = '連線中斷了，請重新整理再試一次。';
  });
  return net;
}
function myPresence(extra = {}) { return { code: roomCode, name: myName(), host: isHost, kind: isHost ? roomKind : undefined, ...extra }; }
function sendMsg(msg) {
  if (!net) return;
  mySeq++;
  net.presence(myPresence({ msg: { ...msg, n: mySeq } })).catch(() => {});
}
async function enterRoom(code, host) {
  try { localStorage.setItem('hugduck-name', myName()); } catch (e) {}
  if (!(await getNet())) return;
  roomCode = code; isHost = host; partner = null; players = []; mySeq = 0; started = false;
  currentThrower = null; pendingTarget = null; joinedAt = Date.now();
  await net.presence(myPresence({ msg: null })).catch(() => {});
  show(document.getElementById('inviteBtn'), host);
  show(document.getElementById('roomJoin'), false);
  duoMsg.textContent = host
    ? `房間號碼：${code}\n請朋友選「${roomKind === 'multi' ? '多人派對' : '雙人連線'}」，輸入這個號碼加入。`
    : `正在加入房間 ${code}…`;
  onPeersChange({ peers: net.peers() });
}
document.getElementById('createBtn').addEventListener('click', () => {
  audio();
  enterRoom(String(Math.floor(1000 + Math.random() * 9000)), true);
});
document.getElementById('joinBtn').addEventListener('click', () => {
  audio();
  const code = (codeIn.value || '').replace(/\D/g, '');
  if (code.length !== 4) { duoMsg.textContent = '請輸入 4 位數的房間號碼'; return; }
  enterRoom(code, false);
});

// ---- 大廳（多人）：顯示誰在房間裡，房主按「開始」 ----
function drawLobby() {
  if (roomKind !== 'multi' || started) return;
  show(lobbyEl, true);
  lobbyEl.textContent = '';
  const everyone = [{ peer: myPeer, name: myName(), host: isHost }, ...players];
  for (const pl of everyone) {
    const li = document.createElement('li');
    li.innerHTML = icon(pl.host ? 'duck' : 'chick', 24);
    const nm = document.createElement('span');
    nm.textContent = pl.name + (pl.peer === myPeer ? '（你）' : '') + (pl.host ? '・房主' : '');
    li.appendChild(nm);
    lobbyEl.appendChild(li);
  }
  if (isHost) {
    show(startBtn, true);
    startBtn.disabled = players.length < 1;
    setLabel(startBtn, players.length < 1 ? '等朋友加入…' : `開始派對（${everyone.length} 人）`, 'party');
  } else {
    show(startBtn, false);
    duoMsg.textContent = `已加入房間 ${roomCode}，等房主按開始…`;
  }
}
startBtn.addEventListener('click', () => {
  if (!isHost || players.length < 1) return;
  sendMsg({ t: 'start' });
  beginGame(myPeer);
});

// 正式開始：first = 第一個拋鴨的人
function beginGame(first) {
  started = true;
  mode = roomKind; streak = 0; loadBest(); updateScore();
  show(duoEl, false); show(actionBtn, true); show(roomEl, true);
  drawRoomLine();
  resetLooks(); smallZ = HOLD_Z;
  currentThrower = first;
  if (first === myPeer) becomeThrower(roomKind === 'duo' ? `${partner ? partner.name : '朋友'} 加入了！你先拋鴨` : '你先拋鴨！');
  else becomeWaiter(`加入成功！等 ${nameOf(first)} 拋鴨`);
  sfx.dingDong(); hap.ding();
}
function becomeThrower(msg) {
  role = 'thrower'; pendingTarget = null;
  if (state === 'sent' || state === 'await') { smallY = CATCH_Y; smallZ = HOLD_Z; setState('idle'); }
  setButton('拋出鴨！', true, 'duck');
  if (msg) toast(msg);
}
function becomeWaiter(msg) {
  role = 'catcher';
  setState('await');
  setButton(roomKind === 'multi' ? '等鴨子飛來…' : '等朋友拋鴨…', false);
  if (msg) toast(msg);
}
function drawRoomLine() {
  if (roomKind === 'duo') roomEl.textContent = `房間 ${roomCode}｜你：${myName()}　朋友：${partner ? partner.name : '—'}`;
  else roomEl.textContent = `房間 ${roomCode}｜${players.length + 1} 人：${[myName(), ...players.map((x) => x.name)].join('、')}`;
}

function onPeersChange(change) {
  if (!roomCode) return;
  const me = change.peers.find((p) => p.sameTab);
  if (me) myPeer = me.peer;
  const others = change.peers.filter((p) => !p.sameTab && p.presence && p.presence.code === roomCode);
  // 加入的人跟著房主的模式（雙人／多人）
  const hostP = others.find((p) => p.presence.host);
  if (!isHost && hostP && !started) {
    const k = hostP.presence.kind === 'multi' ? 'multi' : 'duo';
    if (k !== roomKind) { roomKind = k; setLabel(duoTitle, k === 'multi' ? '多人派對' : '雙人連線', k === 'multi' ? 'party' : 'duo', { size: 26 }); }
  }
  let list = others.map((p) => ({ peer: p.peer, name: String(p.presence.name || '朋友').slice(0, 10), host: !!p.presence.host, presence: p.presence }));
  if (roomKind === 'duo') list = list.filter((x) => x.host !== isHost).slice(0, 1);
  else list = list.slice(0, MAX_PLAYERS - 1);
  const before = players.map((x) => x.peer);
  players = list.map(({ presence, ...rest }) => rest);
  for (const x of players) if (!before.includes(x.peer)) seen[x.peer] = seen[x.peer] || 0;

  if (roomKind === 'duo') {
    const p = players[0];
    if (!p) {
      if (partner && !lostTimer) lostTimer = setTimeout(() => { lostTimer = null; if (!players.length && mode === 'duo') { toast('朋友離線了'); openMenu(); } }, 3000);
    } else {
      clearTimeout(lostTimer); lostTimer = null;
      if (!partner || partner.peer !== p.peer) {
        partner = { peer: p.peer, name: p.name };
        if (!started && myPeer) beginGame(isHost ? myPeer : p.peer);
      }
    }
  } else {
    drawLobby();
    if (started) { drawRoomLine(); checkStuck(); }
  }

  // 讀每個人送來的訊息（同一則只處理一次）
  for (const x of list) {
    const msg = x.presence.msg;
    if (msg && typeof msg.n === 'number' && msg.n > (seen[x.peer] || 0)) {
      const first = !(x.peer in seenInit);
      seenInit[x.peer] = true;
      seen[x.peer] = msg.n;
      // 剛進房間時看到的是「舊訊息」，只拿來知道現在輪到誰，不重播
      if (first && Date.now() - joinedAt > 0 && msg.at && Date.now() - msg.at > 4000) { syncFromOld(msg, x.peer); continue; }
      handleMsg(msg, x.peer);
    } else if (!(x.peer in seenInit)) seenInit[x.peer] = true;
  }
}
const seenInit = {};
function syncFromOld(msg, from) {
  if (roomKind !== 'multi' || !msg) return;
  if (msg.t === 'start') { if (!started) beginGame(from); }
  else if (msg.t === 'result') { if (!started) beginGame(from); currentThrower = from; }
  else if (msg.t === 'throw') { if (!started) beginGame(from); currentThrower = msg.to || from; }
}

// 有人離開時別讓遊戲卡住
function checkStuck() {
  if (!started || roomKind !== 'multi') return;
  const alive = new Set([myPeer, ...players.map((x) => x.peer)]);
  if (state === 'sent' && pendingTarget && !alive.has(pendingTarget)) {
    becomeThrower('接鴨的人離開了，鴨子飛回來了，再拋一次！');
    return;
  }
  if (currentThrower && !alive.has(currentThrower)) {
    // 拋鴨的人離開了 → 由編號最小的人接手拋鴨
    const next = [...alive].sort()[0];
    currentThrower = next;
    if (next === myPeer && role !== 'thrower') becomeThrower('拋鴨的人離開了，換你拋！');
  }
  if (players.length === 0 && role === 'thrower') setButton('等其他人加入…', false);
  else if (role === 'thrower' && (state === 'idle' || state === 'caught' || state === 'miss') && actionBtn.disabled && stateT > 1.5) setButton('拋出鴨！', true, 'duck');
}

function sendThrow() {
  // 隨機挑一個「不是自己」的人來接
  const target = players.length ? players[Math.floor(Math.random() * players.length)] : null;
  if (!target) { becomeThrower('房間裡沒有其他人了'); return; }
  pendingTarget = target.peer;
  sendMsg({
    t: 'throw', to: target.peer, toName: target.name, at: Date.now(),
    delay: 1 + Math.random() * 2.2,          // 隨機過一段時間鴨子才出現
    trick: trick.map((x) => x.id),
    ts: trickState, hi: WIN_HI, lo: WIN_LO, streak,
  });
  setButton(`等 ${target.name} 接…`, false);
  if (roomKind === 'multi') toast(`拋給了 ${target.name}！`);
}
function sendResult(ok) { currentThrower = myPeer; sendMsg({ t: 'result', ok, streak, at: Date.now() }); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function handleMsg(msg, from) {
  if (msg.t === 'start') {
    if (!started) beginGame(from);
    return;
  }
  if (msg.t === 'throw') {
    currentThrower = from;
    const forMe = roomKind === 'duo' || !msg.to || msg.to === myPeer;
    if (!forMe) {
      // 不是丟給我：看熱鬧
      toast(`${nameOf(from)} 拋給了 ${String(msg.toName || nameOf(msg.to)).slice(0, 10)}！`);
      sfx.whooshIn();
      return;
    }
    audio();
    resetLooks();
    role = 'catcher';
    const ids = Array.isArray(msg.trick) ? msg.trick : [];
    trick = TRICKS.filter((x) => ids.includes(x.id));
    const ts = msg.ts || {};
    trickState = {
      hopAt: num(ts.hopAt, 2), hops: Math.min(num(ts.hops, 0), 2), hopDone: 0,
      hoverAt: num(ts.hoverAt, 2), hoverFor: Math.min(num(ts.hoverFor, 0.6), 1.5), hoverT: 0, hovered: false,
      dashAt: num(ts.dashAt, 1.6), dashed: false,
      zigAmp: Math.min(num(ts.zigAmp, 0.5), 0.8), zigSpeed: num(ts.zigSpeed, 6),
      vanishFrom: num(ts.vanishFrom, 2.6), vanishTo: Math.max(num(ts.vanishTo, 1), 0.7),
    };
    WIN_HI = Math.min(Math.max(num(msg.hi, 0.8), 0.5), 0.85);
    WIN_LO = Math.min(Math.max(num(msg.lo, -0.45), -0.5), -0.3);
    streak = Math.max(0, Math.floor(num(msg.streak, 0))); updateScore();
    speedMul = 1; vel = 0; smallY = 6.5; smallZ = HOLD_Z; wingsClosed = false;
    setState('wait'); waitFor = Math.min(Math.max(num(msg.delay, 1.5), 0.5), 4);
    setButton('接住！');
    toast(roomKind === 'multi' ? `${nameOf(from)} 拋給你了！` : `${nameOf(from)} 拋鴨了！`);
    sfx.whooshIn(); hap.ding();
  } else if (msg.t === 'result') {
    currentThrower = from;
    streak = Math.max(0, Math.floor(num(msg.streak, 0)));
    if (streak > best) { best = streak; try { localStorage.setItem(bestKey(), best); } catch (e) {} }
    updateScore();
    toast(msg.ok ? `${nameOf(from)} 收到鴨！` : `${nameOf(from)} 沒接到…`, msg.ok ? 'party' : null);
    if (msg.ok) { sfx.catchSound(streak); quack(0.3, 1.1, 0.35, 0.15); hap.caught(); } else { sfx.sadTrombone(0); hap.sad(); }
    pendingTarget = null;
    becomeWaiter(null);
    if (roomKind === 'duo') setButton('換你接！等朋友拋鴨…', false);
    else setButton(`換 ${nameOf(from)} 拋鴨…`, false);
  }
}

// ---------- 排行榜、登記成績、分享 ----------
const boardEl = document.getElementById('board');
const boardList = document.getElementById('boardList');
const submitEl = document.getElementById('submit');
const submitText = document.getElementById('submitText');
let boardMode = 'solo', pendingScore = 0, pendingMode = 'solo';
const gameUrl = () => location.origin + location.pathname;

async function share(text, url) {
  try {
    if (navigator.share) { await navigator.share({ title: '抱抱鴨・接住小鴨', text, url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('已複製連結，貼給朋友吧！'); }
  catch (e) { toast('請複製網址分享給朋友'); }
}
function offerSubmit(score) {
  if (score < 1 || mode === 'multi') return; // 多人派對不登記排行榜
  // 雙人模式只由沒接到的那一方登記一次，避免重複
  pendingScore = score;
  pendingMode = mode;
  const who = mode === 'duo' && partner ? `${myName()}＆${partner.name}` : myName();
  submitText.textContent = `${mode === 'duo' ? '你們' : '你'}這局連續接住 ${score} 隻！\n用「${who}」登記成績？`;
  show(submitEl, true);
}
document.getElementById('submitBtn').addEventListener('click', async () => {
  const name = pendingMode === 'duo' && partner ? `${myName()}＆${partner.name}` : myName();
  show(submitEl, false);
  if (!(await hasServer())) { toast('排行榜要放上網站後才能用'); return; }
  try { await submitScore(pendingMode, name, pendingScore); toast('登記成功！'); sfx.coin(); boardMode = pendingMode; openBoard(); }
  catch (e) { toast(e && e.message === 'too fast' ? '登記太快了，等幾秒再試' : '登記失敗，請再試一次'); }
});
document.getElementById('shareScoreBtn').addEventListener('click', () => {
  share(`我在「抱抱鴨」${pendingMode === 'duo' ? '雙人合作' : ''}連續接住了 ${pendingScore} 隻小鴨！你能接幾隻？`, gameUrl());
});
document.getElementById('skipBtn').addEventListener('click', () => show(submitEl, false));

async function openBoard() {
  show(menuEl, false); show(boardEl, true); show(actionBtn, false); show(submitEl, false); hideBubble();
  document.querySelectorAll('#board .tab').forEach((b) => b.classList.toggle('on', b.dataset.m === boardMode));
  boardList.textContent = '讀取中…';
  if (!(await hasServer())) { boardList.textContent = '排行榜要放上網站後才能用。'; return; }
  let rows = null;
  try { rows = await topScores(boardMode, 20); } catch (e) { rows = null; }
  if (!rows) { boardList.textContent = '讀不到排行榜，請稍後再試。'; return; }
  if (!rows.length) { boardList.textContent = '還沒有人登記，快來當第一名！'; return; }
  boardList.textContent = '';
  rows.forEach((r, i) => {
    const li = document.createElement('li');
    const rank = document.createElement('span'); rank.className = 'rk'; if (i < 3) rank.innerHTML = icon(['gold', 'silver', 'bronze'][i], 26); else rank.textContent = String(i + 1);
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.name;
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = `${r.score} 隻`;
    li.append(rank, nm, sc);
    boardList.appendChild(li);
  });
}
document.getElementById('boardBtn').addEventListener('click', () => { boardMode = mode === 'duo' ? 'duo' : 'solo'; openBoard(); });
document.querySelectorAll('#board .tab').forEach((b) => b.addEventListener('click', () => { boardMode = b.dataset.m; openBoard(); }));
document.getElementById('boardBack').addEventListener('click', openMenu);
document.getElementById('boardShare').addEventListener('click', () => share('來玩「抱抱鴨・接住小鴨」，看誰接得最多！', gameUrl()));
document.getElementById('inviteBtn').addEventListener('click', () => {
  if (!roomCode) return;
  share(`來跟我一起玩「抱抱鴨」！房間號碼 ${roomCode}`, `${gameUrl()}?room=${roomCode}`);
});
nameIn.addEventListener('change', () => { try { localStorage.setItem('hugduck-name', myName()); } catch (e) {} });

// ---------- 成就（閃爍一下，只出現一次） ----------
const achvEl = document.getElementById('achv');
const achvQueue = [];
let achvBusy = false;
function achieve(text) { achvQueue.push(text); if (!achvBusy) nextAchv(); }
function nextAchv() {
  const text = achvQueue.shift();
  if (!text) { achvBusy = false; return; }
  achvBusy = true;
  achvEl.innerHTML = `${icon('star', 34)}<div><small>成就解鎖</small><b></b></div>`;
  achvEl.querySelector('b').textContent = text;
  achvEl.classList.remove('show'); void achvEl.offsetWidth; achvEl.classList.add('show');
  setTimeout(() => { achvEl.classList.remove('show'); setTimeout(nextAchv, 350); }, 2900);
}

// ---------- 鴨子圖鑑頁 ----------
const dexEl = document.getElementById('dex');
const dexList = document.getElementById('dexList');
function openDex() {
  show(menuEl, false); show(dexEl, true); show(actionBtn, false); show(submitEl, false);
  dexList.textContent = '';
  const seenCount = TRICKS.filter((t) => dex.seen.includes(t.id)).length;
  document.getElementById('dexCount').textContent = `已遇過 ${seenCount} / ${TRICKS.length} 種`;
  for (const t of TRICKS) {
    const seen = dex.seen.includes(t.id), got = dex.caught.includes(t.id);
    const li = document.createElement('li');
    li.className = seen ? (got ? 'got' : 'seen') : 'unknown';
    li.innerHTML = `<span class="dx-ic">${icon('chick', 30)}</span><span class="dx-tx"><b></b><small></small></span><span class="dx-st"></span>`;
    li.querySelector('b').textContent = seen ? t.name.replace('！', '') : '？？？';
    li.querySelector('small').textContent = seen ? t.tip : '還沒遇過';
    li.querySelector('.dx-st').innerHTML = got ? `${icon('star', 18)}已接住` : seen ? '還沒接住' : '';
    dexList.appendChild(li);
  }
}
document.getElementById('dexBtn').addEventListener('click', openDex);
document.getElementById('dexBack').addEventListener('click', openMenu);

openMenu();
// 從邀請連結進來：直接打開雙人頁、填好房號
{
  const inv = new URLSearchParams(location.search).get('room');
  if (inv && /^\d{4}$/.test(inv)) {
    show(menuEl, false); show(duoEl, true);
    codeIn.value = inv;
    duoMsg.textContent = `朋友邀請你加入房間 ${inv}\n確認名字後按「加入」`;
  }
}


// 眼淚與汗滴
function dropTexture(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(32, 6);
  g.bezierCurveTo(46, 26, 52, 36, 52, 42);
  g.arc(32, 42, 20, 0, Math.PI);
  g.bezierCurveTo(12, 36, 18, 26, 32, 6);
  g.fillStyle = color; g.fill();
  g.lineWidth = 4; g.strokeStyle = '#1b1b1b'; g.stroke();
  return new THREE.CanvasTexture(c);
}
const tearTex = dropTexture('#7cc8ff');
const tears = [];
let tearClock = 0;
const tmpV = new THREE.Vector3();
function spawnTear(eyeMesh, side) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tearTex, transparent: true, depthWrite: false }));
  eyeMesh.getWorldPosition(tmpV);
  s.position.copy(tmpV).add(new THREE.Vector3(side * 0.03, -0.04, 0.08));
  s.scale.setScalar(0.11);
  s.userData = { vx: side * (0.25 + Math.random() * 0.25), vy: 0.6 + Math.random() * 0.3, life: 0 };
  scene.add(s);
  tears.push(s);
}
const sweat = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTexture('#a9dcff'), transparent: true, depthWrite: false }));
sweat.scale.setScalar(0.22);
sweat.visible = false;
scene.add(sweat);

const qTmp = new THREE.Quaternion();
const qTmp2 = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);
const xAxis = new THREE.Vector3(1, 0, 0);
const bubbleAnchor = new THREE.Vector3(0.35, 2.45, -0.2);
function updateBubble() {
  const v = bubbleAnchor.clone().project(camera);
  bubble.style.left = ((v.x + 1) / 2) * window.innerWidth + 'px';
  bubble.style.top = ((1 - v.y) / 2) * window.innerHeight + 'px';
}

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  stateT = window.__pauseT != null ? window.__pauseT : stateT + dt; // __pauseT 只給自動測試用

  squeeze = Math.max(0, squeeze - dt * 1.6);
  const sq = Math.sin(squeeze * Math.PI) * 0.12;

  // 呼吸
  const breathe = Math.sin(t * 2.2) * 0.012;
  big.userData.body.scale.set(1 + sq * 0.5 + bigDip * 0.04, 1 + breathe - sq * 0.4 - bigDip * 0.06, 1 + sq * 0.5 + bigDip * 0.04);
  small.userData.body.scale.set(1 + sq * 0.6, 1 - breathe - sq * 0.5, 1 + sq * 0.6);

  let open = 0, flail = 0, smallTilt = 0, bigTilt = 0, crying = false, troubled = false;
  let bounce = 0;

  if (state === 'toss') {            // 拋鴨：抱著 → 往下蓄力 → 往上甩 → 放手，小鴨繼續往上飛，翅膀回到預備
    const T_GRAB = tossFromGround ? 0.35 : 0, T_DIP = T_GRAB + 0.28, T_UP = T_DIP + 0.24, T_BACK = T_UP + 0.4;
    const tt = stateT;
    const ease = (x) => x * x * (3 - 2 * x);
    if (tt < T_GRAB) {                 // 從地上把小鴨抱回懷裡
      const k = ease(tt / T_GRAB);
      smallY += (CATCH_Y - smallY) * Math.min(1, dt * 10);
      smallZ += (HOLD_Z - smallZ) * Math.min(1, dt * 10);
      open = 1 - k; wingDY = 0; wingLift = 0;
    } else if (tt < T_DIP) {           // 往下蓄力
      const k = ease((tt - T_GRAB) / (T_DIP - T_GRAB));
      wingDY = -0.22 * k; wingLift = 0.25 * k; open = 0;
      smallY = CATCH_Y + wingDY; smallZ = HOLD_Z;
      bigDip = k;
    } else if (tt < T_UP) {            // 往上甩
      const k = (tt - T_DIP) / (T_UP - T_DIP);
      const e = 1 - (1 - k) * (1 - k);
      wingDY = -0.22 + 0.72 * e; wingLift = 0.25 - 0.85 * e; open = 0;
      smallY = CATCH_Y + wingDY; smallZ = HOLD_Z;
      bigDip = 1 - k * 1.6;
      tossVel = 9;
    } else {                           // 放手：小鴨繼續往上飛，翅膀慢慢回到預備位置
      if (!tossReleased) { tossReleased = true; sfx.whooshUp(); hap.toss(); }
      const k = ease(Math.min(1, (tt - T_UP) / (T_BACK - T_UP)));
      wingDY = 0.5 * (1 - k); wingLift = -0.6 * (1 - k); open = k;
      smallY += tossVel * dt; tossVel = Math.max(6, tossVel - 4 * dt);
      flail = 1; bigDip = 0;
    }
    if (smallY > 6.5 && tossReleased) {
      wingDY = 0; wingLift = 0;
      if (mode !== 'solo') { setState('sent'); sendThrow(); }
      else {
        setState('wait'); waitFor = 0.6 + Math.random() * 1.2; wingsClosed = false; vel = 0;
        pickTrick();
      }
    }
  } else if (state === 'sent' || state === 'await') { // 雙人：鴨子在朋友那邊
    smallY = 6.5; open = state === 'await' ? 1 : 0;
  } else if (state === 'wait') {     // 在天上，隨機時間後開始掉
    open = wingsClosed ? 0 : 1;
    if (stateT > waitFor) {
      setState('fall');
      sfx.startFall();
      recordSeen(trick);
    }
  } else if (state === 'fall') {
    const ts = trickState;
    let relNow = smallY - CATCH_Y;
    // 飄浮：停在半空中拍翅膀
    if (has('hover') && !ts.hovered && relNow < ts.hoverAt) {
      ts.hoverT += dt; vel = 0;
      ts.flapT = (ts.flapT || 0) + dt;
      if (ts.flapT > 0.11) { ts.flapT = 0; sfx.flap(); hap.reopen(); }
      if (ts.hoverT > ts.hoverFor) { ts.hovered = true; speedMul = 1.35; vel = vmax() * 0.8; }
    } else {
      // 衝刺：前段慢慢掉，到某個高度突然加速
      if (has('dash')) {
        if (!ts.dashed && relNow > ts.dashAt) speedMul = 0.45;
        else if (!ts.dashed) { ts.dashed = true; speedMul = 1.9; vel = vmax(); sfx.zoom(); hap.dash(); }
      }
      vel = Math.min(vel + 9 * dt, vmax());
      // 彈跳／二段跳：往上彈一下
      if (ts.hopDone < ts.hops && relNow < ts.hopAt - ts.hopDone * 0.7 && vel > 0) {
        ts.hopDone++; vel = -(3.2 + Math.random() * 1.2); sfx.boing(); hap.hop();
      }
      smallY -= vel * dt;
    }
    relNow = smallY - CATCH_Y;
    // 搖擺：左右飄，越接近大鴨越回到中間
    smallX = has('zigzag') ? Math.sin(stateT * ts.zigSpeed) * ts.zigAmp * THREE.MathUtils.clamp((relNow - 0.2) / 2.2, 0, 1) : 0;
    // 隱形：一段時間看不見
    const vis = !(has('vanish') && relNow < ts.vanishFrom && relNow > ts.vanishTo);
    if (vis !== small.visible) { if (vis) sfx.pop(); else sfx.poof(); hap.poof(); }
    small.visible = vis;
    sfx.setFall(relNow, has('zigzag') && relNow > 0.2, !vis);
    flail = 1;
    open = wingsClosed ? 0 : 1;
    const rel = smallY - CATCH_Y;
    if (rel < WIN_LO) {
      // 沒接到：往前滑落到地上
      const k = THREE.MathUtils.clamp((WIN_LO - rel) / 0.4, 0, 1);
      smallZ = HOLD_Z + (GROUND_Z - HOLD_Z) * k;
      if (!wingsClosed) { wingsClosed = true; toast('太晚了！'); setButton('…', false); }
    }
    if (smallY <= 0) {
      smallY = 0; smallZ = GROUND_Z; small.visible = true;
      setState('miss');
      lastScore = streak;
      streak = 0; updateScore();
      sfx.stopFall(); sfx.thud(); sfx.sadTrombone(0.2); sob(); hap.miss();

    }
  } else if (state === 'caught') {
    bounce = -0.16 * Math.sin(stateT * 13) * Math.exp(-stateT * 5);
    if (stateT > 0.3 && !spoke) {
      spoke = true;
      showBubble('收到鴨！');
      popHearts();
      quack(0, 0.95, 0.5, 0.14);
      say('收到鴨！', 1.7, 1.15, 180);
    }
    if (stateT > 1.0 && actionBtn.disabled) {
      if (mode !== 'solo') { if (!resultSent) { resultSent = true; sendResult(true); role = 'thrower'; } setButton('拋出鴨！', true, 'duck'); }
      else setButton('再接一隻', true, 'chick');
    }
    if (stateT > 2.4) hideBubble();
  } else if (state === 'miss') {
    crying = stateT > 0.25;
    troubled = stateT > 0.4;
    bounce = stateT < 0.5 ? 0.12 * Math.abs(Math.sin(stateT * 12)) * Math.exp(-stateT * 6) : 0;
    if (stateT > 0.9 && !spoke) {
      spoke = true;
      showBubble('抱歉鴨…');
      quack(0, 0.75, 0.4, 0.3);
      say('抱歉鴨', 0.9, 0.9, 250);
    }
    if (stateT > 1.4 && actionBtn.disabled) {
      offerSubmit(lastScore);
      if (mode !== 'solo') { if (!resultSent) { resultSent = true; sendResult(false); role = 'thrower'; } setButton('拋出鴨！', true, 'duck'); }
      else setButton('再來一次');
    }
  } else { // idle
    bounce = 0;
  }

  // 太早按的冷卻：0.1 秒後翅膀打開，可以再按
  if (earlyCooldown > 0 && (state === 'wait' || state === 'fall')) {
    earlyCooldown -= dt;
    if (earlyCooldown <= 0 && smallY - CATCH_Y >= WIN_LO) { wingsClosed = false; setButton('接住！'); sfx.flap(); }
  }

  // 小鴨位置
  const holding = state === 'idle' || state === 'caught';
  if (state !== 'fall') { smallX += (0 - smallX) * Math.min(1, dt * 8); small.visible = !(state === 'sent' || state === 'await'); }
  small.position.set(smallX, smallY + bounce + (holding ? Math.sin(t * 2.2) * 0.012 + sq * 0.5 : 0), smallZ);
  small.rotation.z = (crying ? Math.sin(t * 30) * 0.06 : Math.sin(t * 1.6) * 0.035) + flail * Math.sin(t * 22) * 0.18;
  small.rotation.x = crying ? 0.12 : 0;
  small.userData.mouth.scale.set(0.82, crying ? 0.82 * (1.25 + Math.sin(t * 9) * 0.12) : 0.82, 0.82);

  // 眼淚
  if (crying) {
    tearClock += dt;
    if (tearClock > 0.11) { tearClock = 0; spawnTear(small.userData.eyes[0], -1); spawnTear(small.userData.eyes[1], 1); }
  }
  for (let i = tears.length - 1; i >= 0; i--) {
    const d = tears[i], u = d.userData;
    u.life += dt; u.vy -= 4 * dt;
    d.position.x += u.vx * dt; d.position.y += u.vy * dt;
    d.material.opacity = Math.max(0, 1 - u.life / 0.9);
    if (u.life > 0.9 || d.position.y < 0) { scene.remove(d); d.material.dispose(); tears.splice(i, 1); }
  }

  // 大鴨：苦惱時歪頭、摸頭、冒汗
  const tilt = troubled ? -0.1 : 0;
  big.rotation.z += (tilt - big.rotation.z) * Math.min(1, dt * 6);
  const sc = big.userData.scratch;
  sc.visible = troubled;
  hugWings[1].visible = !troubled;
  if (troubled) {
    qTmp2.setFromAxisAngle(zAxis, Math.sin(t * 12) * 0.12);
    sc.quaternion.copy(sc.userData.baseQ).multiply(qTmp2);
    sweat.visible = true;
    sweat.position.set(-0.62, 2.05 + Math.sin(t * 4) * 0.03, 0.2);
  } else sweat.visible = false;

  // 翅膀
  const sad = state === 'miss' ? 0.35 : 0;
  wingOpen += (Math.max(open, sad) - wingOpen) * Math.min(1, dt * 25);
  for (const w of hugWings) {
    const o = wingOpen;
    w.position.x = w.userData.baseX - w.userData.side * sq * 0.25 + w.userData.side * o * 0.12;
    w.position.y = w.userData.baseY + wingDY;
    qTmp.setFromAxisAngle(yAxis, w.userData.side * o * 0.95);
    qTmp2.setFromAxisAngle(xAxis, wingLift);
    w.quaternion.copy(qTmp).multiply(qTmp2).multiply(w.userData.baseQ);
  }
  if (bubble.classList.contains('show')) updateBubble();

  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i];
    h.userData.t += dt;
    const k = h.userData.t;
    if (k < 0) continue;
    h.position.y += dt * 0.7;
    h.position.x += h.userData.vx * dt;
    h.scale.setScalar(Math.min(k * 3, 1) * 0.32);
    h.material.opacity = Math.max(0, 1 - k / 1.6);
    if (k > 1.6) {
      scene.remove(h);
      h.material.dispose();
      hearts.splice(i, 1);
    }
  }

  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
document.getElementById('loading').remove();
animate();

// 測試用：讓自動測試讀得到遊戲狀態
window.__duck = { get dex() { return dex; }, get state() { return state; }, get rel() { return smallY - CATCH_Y; }, get vel() { return vel; }, setStreak(n) { streak = n; updateScore(); }, get trick() { return trick && trick.map((t) => t.id); } };
