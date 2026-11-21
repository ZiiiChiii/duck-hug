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
// 地面以下的東西都不畫 → 換衣間可以從地面冒出來、沉回去
renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.001)];
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
    #include <clipping_planes_pars_vertex>
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vec3 n = normalize(normalMatrix * normal);
      mv.xyz += n * thickness * clamp(-mv.z / 6.0, 0.6, 2.0);
      vec4 mvPosition = mv;
      #include <clipping_planes_vertex>
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    #include <clipping_planes_pars_fragment>
    void main(){
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(0.09,0.09,0.09,1.0);
    }`,
  clipping: true,
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

  // 臉（眼睛＋嘴巴）放在一個「頭」的中心，之後可以轉向看小鴨
  const HEAD_C = new THREE.Vector3(0, 1.61, 0);
  const face = new THREE.Group();
  face.position.copy(HEAD_C);
  body.add(face);
  const feats = [];
  const addFeat = (o) => { o.position.sub(HEAD_C); face.add(o); feats.push({ o, p0: o.position.clone(), q0: o.quaternion.clone() }); };
  addFeat(eye(r, 1.86, -0.4, 0.06));
  addFeat(eye(r, 1.86, 0.4, 0.06));

  addFeat(smileBeak(r, 1.64, 1));
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
  duck.userData = { body, scratch, r, face, feats };
  return duck;
}

// ---------- 小鴨鴨 ----------
function smallDuck(bodyMat = WHITE) {
  const duck = new THREE.Group();
  const body = new THREE.Group();
  duck.add(body);
  const { geom, r } = egg(0.66, 1.55);
  body.add(part(geom, bodyMat));

  const eyes = [eye(r, 1.23, -0.42, 0.048), eye(r, 1.23, 0.34, 0.048)];
  eyes.forEach((e) => body.add(e));

  const mouth = smileBeak(r, 0.98, 0.82);
  body.add(mouth);


  const tail = blob(bodyMat, 0.14, 0.09, 0.12);
  tail.position.copy(onSurface(r, 0.36, Math.PI, -0.04));
  tail.rotation.x = 0.5;
  body.add(tail);

  duck.add(foot(0.85, -0.2, 0.22, 0.3));
  duck.add(foot(0.85, 0.2, 0.22, -0.15));
  duck.userData = { body, eyes, mouth, r };
  return duck;
}

const big = bigDuck();
big.position.set(0, 0, -0.2);
big.rotation.y = 0;
let small = smallDuck(); // 會被換成買來的夥伴小鴨，所以用 let
small.scale.setScalar(0.74); // 約大鴨的 1/2 高、1/4 大小
const SMALL_LIFT = 0.36; // 被抱起來、腳離地
small.position.set(0, SMALL_LIFT, 1.04);
small.rotation.y = 0.12;
const ducks = new THREE.Group();
ducks.add(big, small);
ducks.position.y = 0;
// pairRoot：大鴨＋懷裡的小鴨＋翅膀，一起走去換衣間
const pairRoot = new THREE.Group();
pairRoot.add(ducks);
scene.add(pairRoot);

// 大鴨用翅膀把小鴨抱在胸前
// 大鴨的左右翅膀都從自己身體兩側往前伸，碰到小鴨的身體
const hugWings = [-1, 1].map((side) => {
  const w = wingBetween(
    new THREE.Vector3(side * 0.74, 1.02, 0.38),
    new THREE.Vector3(side * 0.5, 0.8, 1.25),
    0.2, 0.13,
    new THREE.Vector3(side, 0.25, 0.25)
  );
  pairRoot.add(w);
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

// ---------- 鴨商城：造型、夥伴小鴨、換衣間（3D 部分） ----------
const M = {
  red: mat(0xe8524a), gold: mat(0xffc94a), purple: mat(0x7b5cd6), green: mat(0x5cbf6a),
  blue: mat(0x5aa9e6), pink: mat(0xff8fb1), dark: mat(0x2b2b2b), wood: mat(0xe9c79a), cream: mat(0xfff4dc),
  yellowBody: mat(0xffe27a), pinkBody: mat(0xffd0dc), blueBody: mat(0xcfe8ff), greenBody: mat(0xd8f0c8), greyBody: mat(0xc9c4bd),
};
const CONE = new THREE.ConeGeometry(1, 1, 24);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 28);
const BOX = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
function shape(geom, m, sx, sy, sz, outline = true) { const p = part(geom, m, outline); p.scale.set(sx, sy, sz); return p; }

// 大鴨造型（掛在大鴨身體上，跟著呼吸、被擠扁）
const BR = big.userData.r;
const DM_SANTA = { red: mat(0xd8342c), white: mat(0xffffff) };
const OUTFITS = {
  bowtie: () => {
    const g = new THREE.Group();
    const y = 1.22, z = BR(y) + 0.02;
    for (const sx of [-1, 1]) {
      const c = shape(CONE, M.red, 0.13, 0.22, 0.07);
      c.rotation.z = sx * Math.PI / 2; c.position.set(sx * 0.12, y, z);
      g.add(c);
    }
    const k = blob(M.red, 0.065, 0.065, 0.05); k.position.set(0, y, z + 0.02); g.add(k);
    return g;
  },
  scarf: () => {
    const g = new THREE.Group();
    const y = 1.2, rr = BR(y);
    const ring = part(new THREE.TorusGeometry(rr * 0.97, 0.1, 14, 48), M.red);
    ring.rotation.x = Math.PI / 2; ring.position.y = y; g.add(ring);
    const tail = shape(BOX, M.red, 0.2, 0.55, 0.08); tail.position.set(0.35, y - 0.3, rr * 0.92); tail.rotation.z = 0.15; g.add(tail);
    for (const yy of [-0.12, -0.32]) { const st = shape(BOX, M.cream, 0.21, 0.06, 0.085, false); st.position.set(0.35 + yy * -0.15, y - 0.3 + yy + 0.2, rr * 0.92 + 0.003); st.rotation.z = 0.15; g.add(st); }
    return g;
  },
  chef: () => {
    const g = new THREE.Group();
    const band = shape(CYL, WHITE, 0.4, 0.3, 0.4); band.position.y = 2.22; g.add(band);
    for (const [x, z] of [[-0.18, 0], [0.18, 0], [0, 0.16], [0, -0.16], [0, 0]]) {
      const puff = blob(WHITE, 0.26, 0.22, 0.26); puff.position.set(x, 2.5, z); g.add(puff);
    }
    return g;
  },
  crown: () => {
    const g = new THREE.Group();
    const ring = shape(new THREE.CylinderGeometry(1, 1.05, 1, 28, 1, true), M.gold, 0.36, 0.2, 0.36);
    ring.position.y = 2.2; g.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = shape(CONE, M.gold, 0.085, 0.2, 0.085); sp.position.set(Math.sin(a) * 0.34, 2.38, Math.cos(a) * 0.34); g.add(sp);
      const gem = blob(i % 2 ? M.blue : M.red, 0.04, 0.04, 0.04, false); gem.position.set(Math.sin(a) * 0.37, 2.2, Math.cos(a) * 0.37); g.add(gem);
    }
    return g;
  },
  wizard: () => {
    const g = new THREE.Group();
    const brim = shape(CYL, M.purple, 0.62, 0.05, 0.62); brim.position.y = 2.17; g.add(brim);
    const hat = shape(CONE, M.purple, 0.42, 0.95, 0.42); hat.position.y = 2.66; hat.rotation.z = -0.12; g.add(hat);
    const star = blob(M.gold, 0.07, 0.07, 0.05); star.position.set(0.1, 2.6, 0.33); g.add(star);
    const tip = blob(M.gold, 0.06, 0.06, 0.06); tip.position.set(0.12, 3.12, 0); g.add(tip);
    return g;
  },
  santa: () => {
    const g = new THREE.Group();
    const fur = part(new THREE.TorusGeometry(0.42, 0.1, 14, 40), DM_SANTA.white); fur.rotation.x = Math.PI / 2; fur.position.y = 2.12; g.add(fur);
    // 紅色帽身：往一邊垂下來
    const pts = [];
    for (let i = 0; i <= 10; i++) { const k = i / 10; pts.push(new THREE.Vector3(0.38 * k * k, 2.15 + 0.85 * Math.sin(k * Math.PI * 0.55), 0)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 30, 1, 20, false);
    const pos = tube.attributes.position;
    for (let i = 0; i <= 30; i++) {
      const k = i / 30, c = curve.getPointAt(k), rr = 0.4 * (1 - k) + 0.04;
      for (let j = 0; j <= 20; j++) { const idx = i * 21 + j; const v = new THREE.Vector3().fromBufferAttribute(pos, idx).sub(c).normalize().multiplyScalar(rr).add(c); pos.setXYZ(idx, v.x, v.y, v.z); }
    }
    tube.computeVertexNormals();
    g.add(part(tube, DM_SANTA.red));
    const pom = blob(DM_SANTA.white, 0.13, 0.13, 0.13); pom.position.copy(curve.getPointAt(1)); g.add(pom);
    return g;
  },
  beanie: () => {
    const g = new THREE.Group();
    const cap = blob(M.green, 0.5, 0.33, 0.5); cap.position.y = 2.12; g.add(cap);
    const cuff = part(new THREE.TorusGeometry(0.47, 0.07, 12, 40), M.cream); cuff.rotation.x = Math.PI / 2; cuff.position.y = 2.02; g.add(cuff);
    const pom = blob(M.cream, 0.13, 0.13, 0.13); pom.position.y = 2.5; g.add(pom);
    return g;
  },
};
let outfitObj = null;
function wearOutfit(id) {
  if (outfitObj) { big.userData.body.remove(outfitObj); outfitObj = null; }
  if (id && OUTFITS[id]) { outfitObj = OUTFITS[id](); big.userData.body.add(outfitObj); }
}

// 夥伴小鴨（買了就站在大鴨後面）
const BUDDIES = {
  yellow: () => smallDuck(M.yellowBody),
  pink: () => { const d = smallDuck(M.pinkBody); const r = d.userData.r;
    for (const sx of [-1, 1]) { const b = blob(M.pink, 0.11, 0.08, 0.06); b.position.set(sx * 0.11, 1.5, 0.12); b.rotation.z = sx * 0.5; d.userData.body.add(b); }
    const k = blob(M.pink, 0.05, 0.05, 0.05); k.position.set(0, 1.5, 0.14); d.userData.body.add(k); return d; },
  blue: () => { const d = smallDuck(M.blueBody);
    const cap = blob(M.blue, 0.42, 0.24, 0.42); cap.position.set(0, 1.42, 0); d.userData.body.add(cap);
    const brim = shape(CYL, M.blue, 0.26, 0.03, 0.2); brim.position.set(0, 1.36, 0.38); d.userData.body.add(brim); return d; },
  cool: () => { const d = smallDuck(WHITE); const r = d.userData.r;
    for (const th of [-0.42, 0.34]) { const gl = shape(BOX, M.dark, 0.2, 0.12, 0.05, false); gl.position.copy(onSurface(r, 1.23, th, 0.03)); gl.lookAt(gl.position.clone().multiplyScalar(2).setY(1.23)); d.userData.body.add(gl); }
    const br = shape(BOX, M.dark, 0.18, 0.025, 0.03, false); br.position.copy(onSurface(r, 1.25, -0.04, 0.035)); d.userData.body.add(br); return d; },
  leaf: () => { const d = smallDuck(M.greenBody);
    const lf = blob(M.green, 0.16, 0.05, 0.08); lf.position.set(0.05, 1.6, 0); lf.rotation.z = 0.5; d.userData.body.add(lf);
    const stem = shape(CYL, M.green, 0.015, 0.1, 0.015, false); stem.position.set(0, 1.56, 0); d.userData.body.add(stem); return d; },
  grey: () => smallDuck(M.greyBody),
  white: () => smallDuck(WHITE), // 原本那隻小白鴨
  xmas: () => { const d = smallDuck(M.yellowBody); const body = d.userData.body, r = d.userData.r;
    const fur = part(new THREE.TorusGeometry(0.3, 0.07, 12, 32), DM_SANTA.white); fur.rotation.x = Math.PI / 2; fur.position.y = 1.43; body.add(fur);
    const cap = shape(CONE, DM_SANTA.red, 0.3, 0.5, 0.3); cap.position.set(0.04, 1.7, 0); cap.rotation.z = -0.35; body.add(cap);
    const pom = blob(DM_SANTA.white, 0.08, 0.08, 0.08); pom.position.set(0.15, 1.93, 0); body.add(pom);
    const scarf = part(new THREE.TorusGeometry(r(0.85) * 0.98, 0.06, 10, 32), M.green); scarf.rotation.x = Math.PI / 2; scarf.position.y = 0.85; body.add(scarf);
    return d; },
};
// 每隻小鴨都有自己固定的位置（被抱走時位置空著，回來時站回原位）
const BUDDY_SLOTS = [[-1.45, -0.55], [-1.05, -1.55], [-2.05, -1.3], [-0.75, -2.55], [-2.45, -0.3], [-1.75, -2.4], [-2.75, -1.95]]; // 右後方留給去換衣間的路
const buddyObjs = [];
let heldId = 'white';                   // 現在抱在懷裡的是哪一隻
let smallIds = [];                      // 擁有的小鴨（含原本的小白鴨），順序決定站位
const slotOf = (id) => BUDDY_SLOTS[Math.max(0, smallIds.indexOf(id)) % BUDDY_SLOTS.length];
const faceCenter = (x, z) => Math.atan2(0 - x, 0.6 - z);
function makeBuddy(id) {
  const d = BUDDIES[id]();
  const [x, z] = slotOf(id);
  d.scale.setScalar(0.5);
  d.position.set(x, 0, z);
  d.rotation.y = faceCenter(x, z);
  d.userData.phase = smallIds.indexOf(id) * 1.3;
  d.userData.id = id;
  d.userData.facing = d.rotation.y;
  return d;
}
function placeBuddies(ids) {
  smallIds = ['white', ...ids.filter((id) => BUDDIES[id] && id !== 'white')];
  for (const b of buddyObjs) scene.remove(b);
  buddyObjs.length = 0;
  for (const id of smallIds) {
    if (id === heldId) continue;
    const d = makeBuddy(id);
    scene.add(d);
    buddyObjs.push(d);
  }
}
// 把懷裡的小鴨換成另一隻（直接換，沒有動畫）
function setHeldDuck(id) {
  const old = small;
  const next = (BUDDIES[id] || BUDDIES.white)();
  next.scale.setScalar(0.74);
  next.position.copy(old.position);
  next.rotation.copy(old.rotation);
  next.visible = old.visible;
  ducks.remove(old);
  ducks.add(next);
  small = next;
  heldId = id;
}
// ---------- 小鴨的等待動作（在商城買）：散步、跳跳、轉圈圈、打瞌睡、跳舞 ----------
// 散步時會檢查路線：不會撞到大鴨、其他小鴨、別人的站位、換衣間、佈置物件，也不會走到前面接鴨的地方
let enabledActs = [];
const BUDDY_R = 0.36;
const zTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.font = '900 48px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#ffffff'; g.strokeText('z', 32, 34); g.fillStyle = '#5b6b8a'; g.fillText('z', 32, 34);
  return new THREE.CanvasTexture(c); })();
const zzz = [];
function wanderObstacles(d) {
  const obs = [{ x: 0, z: -0.2, r: 1.05 }, { x: -1.3, z: 0.55, r: 0.35 }, { x: 1.3, z: 0.55, r: 0.35 }, { x: 0, z: 1.2, r: 0.9 }];
  if (booth.visible) obs.push(...boothObstacles());
  obs.push(...decorObstacles());
  for (const o of buddyObjs) {
    if (o === d) continue;
    obs.push({ x: o.position.x, z: o.position.z, r: BUDDY_R });
    const a = o.userData.act;
    if (a && a.type === 'wander' && a.to) obs.push({ x: a.to.x, z: a.to.z, r: BUDDY_R }); // 別人要去的地方先讓給他
  }
  for (const id of smallIds) { if (id === d.userData.id) continue; const [x, z] = slotOf(id); obs.push({ x, z, r: 0.3 }); }
  return obs;
}
function pickAct(d) {
  const ud = d.userData;
  const choices = enabledActs.filter((a) => a !== 'wander' || true);
  const [sx, sz] = slotOf(ud.id);
  const home = new THREE.Vector3(sx, 0, sz);
  const away = Math.hypot(d.position.x - sx, d.position.z - sz) > 0.15;
  if (away && (!enabledActs.includes('wander') || Math.random() < 0.5)) return { type: 'wander', to: home, t: 0 };
  if (!choices.length || Math.random() < 0.3) return { type: 'idle', t: 0, dur: 2 + Math.random() * 3 };
  const type = choices[Math.floor(Math.random() * choices.length)];
  if (type === 'wander') {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, rr = 0.3 + Math.random() * 0.45;
      const to = new THREE.Vector3(sx + Math.sin(a) * rr, 0, sz + Math.cos(a) * rr);
      const obs = wanderObstacles(d);
      if (!blockedAt(to.x, to.z, BUDDY_R, obs) && lineFree(d.position, to, BUDDY_R, obs)) return { type: 'wander', to, t: 0 };
    }
    return { type: 'idle', t: 0, dur: 1.5 };
  }
  return { type, t: 0, dur: { hop: 1.6, spin: 1.3, doze: 4, dance: 3.2 }[type] };
}
let cheerT = 0;
function buddiesCheer() { cheerT = 1; }
function animateBuddies(t, dt) {
  cheerT = Math.max(0, cheerT - dt * 1.2);
  const frozen = swap.active || wardrobe.active;   // 換抱、換衣服時大家先站好不動
  for (const d of buddyObjs) {
    if (d.userData.busy) continue;
    const ud = d.userData, ph = ud.phase;
    if (ud.facing === undefined) ud.facing = d.rotation.y;
    if (!ud.act || (frozen && ud.act.type !== 'idle')) ud.act = { type: 'idle', t: 0, dur: 1 + Math.random() * 2 };
    const act = ud.act;
    act.t += dt;
    let y = 0, rz = Math.sin(t * 1.3 + ph) * 0.04, rx = 0, spin = 0, sy = 1 + Math.sin(t * 2.4 + ph) * 0.02;
    let faceTo = faceCenter(d.position.x, d.position.z);
    if (act.type === 'wander') {
      const dx = act.to.x - d.position.x, dz = act.to.z - d.position.z, dist = Math.hypot(dx, dz);
      if (dist < 0.02) { ud.act = null; }
      else {
        const stepLen = Math.min(dist, 0.5 * dt);
        const nx = d.position.x + (dx / dist) * stepLen, nz = d.position.z + (dz / dist) * stepLen;
        if (blockedAt(nx, nz, BUDDY_R, wanderObstacles(d).filter((o) => Math.hypot(o.x - act.to.x, o.z - act.to.z) > 0.01))) { ud.act = null; }
        else { d.position.x = nx; d.position.z = nz; faceTo = Math.atan2(dx, dz); }
      }
    } else if (act.type === 'hop') { y = Math.abs(Math.sin(act.t * Math.PI * 1.9)) * 0.22; }
    else if (act.type === 'spin') { spin = Math.PI * 2 * ease2(Math.min(1, act.t / act.dur)); }
    else if (act.type === 'doze') {
      const k = Math.min(1, act.t / 0.6, (act.dur - act.t) / 0.6);
      rx = 0.22 * k; sy = 1 - 0.06 * k + Math.sin(t * 2) * 0.015;
      ud.zT = (ud.zT || 0) - dt;
      if (ud.zT <= 0 && act.t < act.dur - 0.6) {
        ud.zT = 0.8;
        const z = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }));
        z.position.set(d.position.x + 0.15, 0.85, d.position.z); z.scale.setScalar(0.18);
        z.userData.life = 0; scene.add(z); zzz.push(z);
      }
    } else if (act.type === 'dance') {
      rz = Math.sin(act.t * 8) * 0.22; y = Math.abs(Math.sin(act.t * 8)) * 0.05; spin = Math.sin(act.t * 4) * 0.45;
    }
    if (act.type !== 'wander' && act.dur !== undefined && act.t > act.dur) ud.act = null;
    if (!ud.act && !frozen) ud.act = pickAct(d);
    // 走路的腳步跟著真的移動距離
    const wd = stepWaddle(d, 'walk', 0.05, 0.12);
    const cheer = cheerT > 0 ? Math.abs(Math.sin((1 - cheerT) * Math.PI * 3 + ph)) * 0.25 * cheerT : 0;
    d.position.y = Math.max(y, cheer) + wd.y;
    ud.facing = turnToward(ud.facing, faceTo, dt, 5);
    d.rotation.set(0, ud.facing + spin, 0);
    ud.body.rotation.set(rx, 0, rz + wd.z);
    ud.body.scale.y = sy;
  }
  for (let i = zzz.length - 1; i >= 0; i--) {
    const z = zzz[i]; z.userData.life += dt;
    z.position.y += dt * 0.35; z.position.x += Math.sin(z.userData.life * 3) * dt * 0.15;
    z.scale.setScalar(0.18 + z.userData.life * 0.08);
    z.material.opacity = Math.max(0, 1 - z.userData.life / 1.6);
    if (z.userData.life > 1.6) { scene.remove(z); z.material.dispose(); zzz.splice(i, 1); }
  }
}

// 換衣間（大鴨後面）
const booth = new THREE.Group();
{
  const W2 = 1.15, H = 3.5, D = 2.5; // 夠大，大鴨收起兩邊、在裡面轉身也不會穿出牆
  const back = shape(BOX, M.wood, W2 * 2, H, 0.08); back.position.set(0, H / 2, -D / 2); booth.add(back);
  for (const sx of [-1, 1]) { const side = shape(BOX, M.wood, 0.08, H, D); side.position.set(sx * W2, H / 2, 0); booth.add(side); }
  const roof = shape(BOX, M.pink, W2 * 2 + 0.3, 0.16, D + 0.3); roof.position.set(0, H + 0.08, 0); booth.add(roof);
  // 招牌
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g2 = c.getContext('2d');
  g2.fillStyle = '#fff4dc'; g2.fillRect(0, 0, 256, 96);
  g2.lineWidth = 8; g2.strokeStyle = '#1b1b1b'; g2.strokeRect(4, 4, 248, 88);
  g2.fillStyle = '#1b1b1b'; g2.font = '900 54px "PingFang TC","Noto Sans TC",sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  g2.fillText('換衣間', 128, 52);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) }));
  sign.position.set(0, H + 0.42, D / 2 + 0.16); booth.add(sign);
  const post = shape(BOX, M.wood, 0.06, 0.3, 0.06, false); post.position.set(0, H + 0.22, D / 2 + 0.12); booth.add(post);
  // 布簾（從左邊收起來）
  const curtain = new THREE.Group();
  curtain.position.set(-W2 + 0.05, 0, D / 2);
  for (let i = 0; i < 7; i++) {
    const fold = shape(CYL, i % 2 ? M.pink : M.red, 0.15, H - 0.2, 0.09);
    fold.position.set(0.13 + i * ((W2 * 2 - 0.2) / 6.5), (H - 0.2) / 2 + 0.08, 0);
    curtain.add(fold);
  }
  const rod = shape(CYL, M.dark, 0.03, W2 * 2, 0.03, false); rod.rotation.z = Math.PI / 2; rod.position.set(0, H - 0.05, D / 2); booth.add(rod);
  booth.add(curtain);
  booth.userData.curtain = curtain;
}
booth.position.set(1.45, 0, -4.1);
booth.rotation.y = -0.3;
scene.add(booth);
// 平常沉在地底下，要換衣服才冒出來
const BOOTH_DOWN = -3.9;
booth.position.y = BOOTH_DOWN;
booth.visible = false;
let boothVel = 0, boothWasUp = false;
function animateBoothRise(dt, t, wantUp) {
  const target = wantUp ? 0 : BOOTH_DOWN;
  if (wantUp && !boothWasUp) { boothWasUp = true; booth.visible = true; sfx.whooshUp(); hap.dash(); }
  if (!wantUp && boothWasUp) { boothWasUp = false; sfx.whooshIn(); }
  // 冒出來：彈簧感（衝過頭一點再落定）；沉下去：直接往下
  if (wantUp) { boothVel += (target - booth.position.y) * 26 * dt; boothVel *= Math.exp(-4.5 * dt); booth.position.y += boothVel * dt; }
  else { boothVel = 0; booth.position.y += (target - booth.position.y) * Math.min(1, dt * 3.2); }
  const moving = Math.abs(booth.position.y - target) > 0.03;
  booth.rotation.z = moving ? Math.sin(t * 40) * 0.012 : 0;
  if (!wantUp && booth.position.y < BOOTH_DOWN + 0.05) booth.visible = false;
}
const BOOTH_FRONT = booth.localToWorld(new THREE.Vector3(0, 0, 2.9));  // 門口前面
const BOOTH_IN = booth.localToWorld(new THREE.Vector3(0, 0, 0.08));   // 換衣間正中間
const HOME = new THREE.Vector3(0, 0, 0);

const lerp3 = (a, b, k) => new THREE.Vector3().lerpVectors(a, b, k);
const ease2 = (x) => x * x * (3 - 2 * x);
function faceToward(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }

// ---------- 走路的路線規劃：避開大鴨、其他小鴨、換衣間，不會互相穿過去 ----------
const GRID = 0.1, GX0 = -4.5, GX1 = 4.5, GZ0 = -5, GZ1 = 3;
const NX = Math.round((GX1 - GX0) / GRID) + 1, NZ = Math.round((GZ1 - GZ0) / GRID) + 1;
function boothObstacles() {
  const out = [];
  for (const lx of [-1.1, -0.4, 0.4, 1.1]) for (const lz of [-1.2, -0.4, 0.4, 1.2]) {
    const w = booth.localToWorld(new THREE.Vector3(lx, 0, lz));
    out.push({ x: w.x, z: w.z, r: 0.4 });
  }
  return out;
}
function blockedAt(x, z, radius, obs) {
  for (const o of obs) { const dx = x - o.x, dz = z - o.z, rr = o.r + radius; if (dx * dx + dz * dz < rr * rr) return true; }
  return false;
}
function lineFree(a, b, radius, obs) {
  const n = Math.ceil(a.distanceTo(b) / 0.05);
  for (let i = 1; i < n; i++) { const k = i / n; if (blockedAt(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, radius, obs)) return false; }
  return true;
}
// A* 找路，再把多餘的轉角拉直
function planPathOnce(from, to, radius, obs) {
  const cell = (x, z) => [Math.round((x - GX0) / GRID), Math.round((z - GZ0) / GRID)];
  const [sx, sz] = cell(from.x, from.z), [tx, tz] = cell(to.x, to.z);
  const idx = (i, j) => j * NX + i;
  const free = (i, j) => i >= 0 && j >= 0 && i < NX && j < NZ &&
    ((Math.abs(i - sx) <= 3 && Math.abs(j - sz) <= 3) || (Math.abs(i - tx) <= 3 && Math.abs(j - tz) <= 3) || !blockedAt(GX0 + i * GRID, GZ0 + j * GRID, radius, obs));
  const g = new Float32Array(NX * NZ).fill(Infinity), came = new Int32Array(NX * NZ).fill(-1), closed = new Uint8Array(NX * NZ);
  const open = [[0, sx, sz]];
  g[idx(sx, sz)] = 0;
  const h = (i, j) => Math.hypot(i - tx, j - tz);
  let found = false, guard = 0;
  while (open.length && guard++ < 60000) {
    let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
    const [, i, j] = open.splice(bi, 1)[0];
    const id = idx(i, j);
    if (closed[id]) continue;
    closed[id] = 1;
    if (i === tx && j === tz) { found = true; break; }
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!free(ni, nj)) continue;
      const nid = idx(ni, nj);
      const ng = g[id] + (di && dj ? 1.414 : 1);
      if (ng < g[nid]) { g[nid] = ng; came[nid] = id; open.push([ng + h(ni, nj), ni, nj]); }
    }
  }
  if (!found) return null;
  const raw = [];
  for (let c = idx(tx, tz); c !== -1; c = came[c]) raw.push(new THREE.Vector3(GX0 + (c % NX) * GRID, 0, GZ0 + Math.floor(c / NX) * GRID));
  raw.reverse();
  raw[0] = from.clone(); raw[raw.length - 1] = to.clone();
  const pts = [raw[0]];
  let anchor = 0;
  for (let k = 2; k < raw.length; k++) {
    if (!lineFree(raw[anchor], raw[k], radius * 0.9, obs)) { pts.push(raw[k - 1]); anchor = k - 1; }
  }
  pts.push(raw[raw.length - 1]);
  return pts;
}
// 找不到路就把身體當小一點再找一次（最後才直接走）
function planPath(from, to, radius, obs) {
  for (const f of [1, 0.85, 0.7, 0.5]) { const r = planPathOnce(from, to, radius * f, obs); if (r) return r; }
  return [from.clone(), to.clone()];
}
function pathLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += pts[i].distanceTo(pts[i - 1]); return L; }
function pathAt(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1]);
    if (d <= seg || i === pts.length - 1) {
      const k = seg ? Math.min(1, d / seg) : 1;
      return { pos: new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], k), dir: Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) };
    }
    d -= seg;
  }
  return { pos: pts[pts.length - 1].clone(), dir: 0 };
}
// 慢慢轉向（不會瞬間轉身）
function turnToward(cur, target, dt, speed = 8) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, dt * speed);
}
const buddyObstacles = (except = []) => buddyObjs.filter((d) => !except.includes(d)).map((d) => ({ x: d.position.x, z: d.position.z, r: 0.42 }));

// ---------- 走去換衣間 → 拉上布簾換衣服 → 走回來（沿著規劃好的路線，繞開小鴨） ----------
const BIG_R = 1.15;   // 大鴨＋翅膀的半徑
const wardrobe = { active: false, t: 0, next: null, swapped: false, done: null, rustle: 0, open: 0 };
function startWardrobe(nextOutfit, done) {
  // 先把懷裡的小鴨放在大鴨前面，大鴨自己走去（路線要繞開放下的小鴨和後面的小鴨們）
  const obs = [...buddyObstacles(), ...boothObstacles(), ...decorObstacles(), { x: PUT_DOWN.x, z: PUT_DOWN.z, r: 0.42 }];
  const path = planPath(HOME, BOOTH_FRONT, BIG_R, obs);
  const L = pathLength(path);
  Object.assign(wardrobe, {
    active: true, t: 0, next: nextOutfit, swapped: false, done, rustle: 0, ta: false, path, walk: Math.max(1.3, L / 1.2),
    rot: 0, open: 0, heldStart: small.position.clone(), droppedSmall: false, pickedUp: false, squeeze: 1, smallRot: small.rotation.y,
  });
  controls.autoRotate = false;
}
// 收起兩邊（左右變窄），出來後「啵」一下彈回原本的樣子
// 等速走路（頭尾短短的加減速），腳步跟著「真的走了多遠」擺動 → 不會原地踏步
function trapezoid(k, a = 0.15) {
  k = THREE.MathUtils.clamp(k, 0, 1);
  const vmax = 1 / (1 - a);
  if (k < a) return 0.5 * vmax * k * k / a;
  if (k > 1 - a) return 1 - 0.5 * vmax * (1 - k) * (1 - k) / a;
  return 0.5 * vmax * a + vmax * (k - a);
}
const STEP_LEN = 0.32;
function stepWaddle(obj, key, amp = 0.06, tilt = 0.07) {
  const ud = obj.userData;
  const p = obj.position, last = ud[key + 'Last'];
  const moved = last ? Math.hypot(p.x - last.x, p.z - last.z) : 0;
  ud[key + 'Last'] = { x: p.x, z: p.z };
  ud[key + 'Ph'] = (ud[key + 'Ph'] || 0) + moved;
  const walking = moved > 0.0008;
  ud[key + 'W'] = (ud[key + 'W'] || 0) + ((walking ? 1 : 0) - (ud[key + 'W'] || 0)) * 0.25; // 停下時腳步慢慢收
  const ph = (ud[key + 'Ph'] / STEP_LEN) * Math.PI;
  return { y: Math.abs(Math.sin(ph)) * amp * ud[key + 'W'], z: Math.sin(ph) * tilt * ud[key + 'W'] };
}
const squeezeX = (sx, sz = 1) => { pairRoot.scale.set(sx, 1 + (1 - Math.min(sx, sz)) * 0.18, sz); };
function animateWardrobe(dt, t) {
  const curtain = booth.userData.curtain;
  if (!wardrobe.active) { animateBoothRise(dt, t, false); curtain.scale.x += (1 - curtain.scale.x) * Math.min(1, dt * 6); curtain.rotation.z = 0; return; }
  wardrobe.t += dt;
  // 換衣間：一開始就冒出來，大鴨換好走開後沉回去
  animateBoothRise(dt, t, wardrobe.t < 0.6 + wardrobe.walk + 0.5 + 0.9 + 0.35 + 1.4 + 0.4 + 0.9 + 0.6 + 0.5);
  const w = wardrobe.t, W = wardrobe.walk, P = wardrobe.path, L = pathLength(P);
  const NARROW = 0.56;
  const T0 = 0.6,                 // 放下小鴨
    T1 = T0 + W,                  // 走到換衣間門口
    T2 = T1 + 0.5,                // 面向門、收起兩邊、布簾拉開
    T3 = T2 + 0.9,                // 側著身子走進去
    T4 = T3 + 0.35,               // 布簾拉上
    T5 = T4 + 1.4,                // 在裡面換衣服（布簾晃動）
    T6 = T5 + 0.4,                // 布簾拉開
    T7 = T6 + 0.9,                // 走出來（還是窄窄的）
    T8 = T7 + 0.6,                // 啵！彈回原本的樣子
    T9 = T8 + W,                  // 走回原位
    T10 = T9 + 0.4,               // 轉回正面
    T11 = T10 + 0.7;              // 把小鴨抱回來
  let pos = HOME, targetRot = 0, curtainOpen = 0, waddleOn = false, shake = 0, sx = 1, sz = 1;
  const intoDoor = faceToward(BOOTH_FRONT, BOOTH_IN);
  // ---- 小鴨：放下 → 在前面等 → 被抱回去 ----
  if (w < T0) {
    const k = ease2(w / T0);
    small.position.lerpVectors(wardrobe.heldStart, PUT_DOWN, k);
    small.rotation.z = 0;
    wardrobe.open = k;
  } else if (!wardrobe.droppedSmall) {
    wardrobe.droppedSmall = true;
    ducks.remove(small); scene.add(small);         // 放在地上，不跟著大鴨走
    small.position.copy(PUT_DOWN); small.position.y = 0;
  }
  if (wardrobe.droppedSmall && !wardrobe.pickedUp) {
    // 在前面看著大鴨，輕輕搖擺
    const look = faceToward(small.position, pairRoot.position);
    wardrobe.smallRot = turnToward(wardrobe.smallRot, look, dt, 4);
    small.rotation.set(0, wardrobe.smallRot, Math.sin(t * 2.2) * 0.04);
  }
  // ---- 大鴨 ----
  if (w < T0) { pos = HOME; }
  else if (w < T1) { const at = pathAt(P, trapezoid((w - T0) / W) * L); pos = at.pos; targetRot = at.dir; waddleOn = true; wardrobe.open = Math.max(0, 1 - (w - T0) / 0.3); }
  else if (w < T2) { const k = ease2((w - T1) / 0.5); pos = BOOTH_FRONT; targetRot = intoDoor; curtainOpen = k; sx = 1 - (1 - NARROW) * k; if (!wardrobe.sq) { wardrobe.sq = true; sfx.swish(); } }
  else if (w < T3) { const k = ease2((w - T2) / 0.9); pos = lerp3(BOOTH_FRONT, BOOTH_IN, k); targetRot = intoDoor; curtainOpen = 1; waddleOn = true; sx = NARROW; }
  else if (w < T4) { pos = BOOTH_IN; targetRot = intoDoor; sx = NARROW; curtainOpen = 1 - (w - T3) / 0.35; }
  else if (w < T5) {
    // 在裡面轉身：前後也縮瘦，轉的時候才不會穿出牆
    const k = (w - T4) / (T5 - T4);
    sz = k < 0.15 ? 1 - 0.45 * (k / 0.15) : k > 0.8 ? 0.55 + 0.45 * ((k - 0.8) / 0.2) : 0.55;
    pos = BOOTH_IN; sx = NARROW; shake = 1; targetRot = k > 0.15 ? intoDoor + Math.PI : intoDoor;
    wardrobe.rustle -= dt;
    if (wardrobe.rustle <= 0) { wardrobe.rustle = 0.22; sfx.swish(); }
    if (w > T4 + 0.7 && !wardrobe.swapped) { wardrobe.swapped = true; wearOutfit(wardrobe.next); }
  }
  else if (w < T6) { pos = BOOTH_IN; sx = NARROW; targetRot = intoDoor + Math.PI; curtainOpen = (w - T5) / 0.4; }
  else if (w < T7) { const k = ease2((w - T6) / 0.9); pos = lerp3(BOOTH_IN, BOOTH_FRONT, k); targetRot = intoDoor + Math.PI; sx = NARROW; curtainOpen = 1; waddleOn = true; }
  else if (w < T8) {
    const k = (w - T7) / 0.6;
    pos = BOOTH_FRONT; targetRot = intoDoor + Math.PI; curtainOpen = 1;
    // 彈簧：0.56 → 衝過頭到 1.15 → 回到 1
    sx = 1 - (1 - NARROW) * Math.cos(k * Math.PI * 2.5) * Math.exp(-k * 4.5);
    if (!wardrobe.ta) { wardrobe.ta = true; sfx.pop(); sfx.boing(); sfx.sparkle(); hap.caught(); popHearts(); }
  }
  else if (w < T9) { const at = pathAt(P, (1 - trapezoid((w - T8) / W)) * L); pos = at.pos; targetRot = at.dir + Math.PI; waddleOn = true; curtainOpen = Math.max(0, 1 - (w - T8) / 0.5); }
  else if (w < T10) { pos = HOME; targetRot = 0; wardrobe.open = (w - T9) / 0.4; }
  else if (w < T11) {
    pos = HOME; targetRot = 0;
    if (!wardrobe.pickedUp) { wardrobe.pickedUp = true; scene.remove(small); ducks.add(small); wardrobe.pickFrom = small.position.clone(); wardrobe.pickRot = small.rotation.y; }
    const k = ease2((w - T10) / 0.7);
    small.position.set(0, CATCH_Y * k, wardrobe.pickFrom.z + (HOLD_Z - wardrobe.pickFrom.z) * k);
    small.rotation.set(0, wardrobe.pickRot + (0.12 - wardrobe.pickRot) * k, 0);
    wardrobe.open = 1 - k;
  }
  else {
    wardrobe.active = false; wardrobe.sq = false;
    if (!wardrobe.pickedUp) { scene.remove(small); ducks.add(small); }
    pairRoot.position.set(0, 0, 0); pairRoot.rotation.set(0, 0, 0); pairRoot.scale.setScalar(1); pairRoot.visible = true;
    smallY = CATCH_Y; smallZ = HOLD_Z; smallX = 0; wardrobe.open = 0;
    squeeze = 1; quack(0, 1.2, 0.3, 0.12);
    if (wardrobe.done) wardrobe.done();
    return;
  }
  wardrobe.rot = turnToward(wardrobe.rot, targetRot, dt, shake ? 4 : 7);
  pairRoot.position.copy(pos);
  const wd = stepWaddle(pairRoot, 'walk', 0.06, 0.06);
  pairRoot.position.y = wd.y;
  pairRoot.rotation.set(0, wardrobe.rot, wd.z);
  squeezeX(sx, sz);
  pairRoot.visible = true;
  curtain.scale.x = Math.max(0.16, 1 - 0.84 * THREE.MathUtils.clamp(curtainOpen, 0, 1));
  curtain.rotation.z = shake ? Math.sin(t * 30) * 0.015 : 0;
  curtain.children.forEach((f, i) => { f.rotation.z = shake ? Math.sin(t * 22 + i) * 0.05 : 0; });
}

// ---------- 換抱另一隻小鴨：放下 → 懷裡那隻先繞過大鴨走回位置 → 被選中的那隻再走過來 → 抱起來 ----------
// 兩隻輪流走、路線都繞開大鴨和其他小鴨，不會互相穿過去
const swap = { active: false, t: 0, open: 0 };
const PUT_DOWN = new THREE.Vector3(0, 0, 1.55);     // 大鴨前面放下的位置
const BIG_BODY = { x: 0, z: -0.2, r: 1.02 };
const OPEN_WINGS = [{ x: -1.3, z: 0.55, r: 0.35 }, { x: 1.3, z: 0.55, r: 0.35 }];
const SMALL_R = 0.36;
function startSwap(newId, done) {
  const buddy = buddyObjs.find((b) => b.userData.id === newId);
  if (!buddy || swap.active || wardrobe.active) return false;
  const [hx, hz] = slotOf(heldId);
  const home = new THREE.Vector3(hx, 0, hz);
  const from = buddy.position.clone(); from.y = 0;
  const pathA = planPath(PUT_DOWN, home, SMALL_R, [BIG_BODY, ...OPEN_WINGS, ...buddyObstacles(), ...boothObstacles(), ...decorObstacles()]);
  const pathB = planPath(from, PUT_DOWN, SMALL_R, [BIG_BODY, ...OPEN_WINGS, ...buddyObstacles([buddy]), { x: home.x, z: home.z, r: 0.42 }, ...boothObstacles(), ...decorObstacles()]);
  const tA = Math.max(0.9, pathLength(pathA) / 1.4), tB = Math.max(0.9, pathLength(pathB) / 1.4);
  Object.assign(swap, { active: true, t: 0, open: 1, buddy, newId, done, home, from, pathA, pathB, tA, tB, heldStart: small.position.clone(), rotA: small.rotation.y, rotB: buddy.rotation.y });
  buddy.userData.busy = true;
  controls.autoRotate = false;
  return true;
}
function animateSwap(dt, t) {
  if (!swap.active) return;
  swap.t += dt;
  const w = swap.t, b = swap.buddy;
  const DOWN = 0.6, A_END = DOWN + swap.tA, B_START = A_END + 0.15, B_END = B_START + swap.tB, UP = B_END + 0.6, END = UP + 0.05;
  const step = (obj, path, k0, rotKey, phase) => {
    const k = trapezoid(k0);
    const at = pathAt(path, k * pathLength(path));
    obj.position.copy(at.pos);
    const moving = k0 > 0 && k0 < 1;
    const wd = stepWaddle(obj, 'walk', 0.04, 0.12);
    obj.position.y = wd.y;
    swap[rotKey] = turnToward(swap[rotKey], at.dir, dt, 9);
    obj.rotation.set(0, swap[rotKey], wd.z);
    if (moving && Math.floor(w * 4) !== Math.floor((w - dt) * 4)) sfx.flap();
  };
  if (w < DOWN) {
    const k = ease2(w / DOWN);
    small.position.lerpVectors(swap.heldStart, PUT_DOWN, k);
    small.rotation.z = 0;
    swap.open = k;
  } else if (w < A_END) {
    swap.open = 1;
    const k = (w - DOWN) / swap.tA;
    step(small, swap.pathA, k, 'rotA', 1);
    small.scale.setScalar(0.74 - 0.24 * ease2(Math.min(1, k)));
  } else if (w < B_END) {
    small.position.copy(swap.home); small.position.y = 0; small.scale.setScalar(0.5);
    swap.rotA = turnToward(swap.rotA, faceCenter(swap.home.x, swap.home.z), dt, 6);
    small.rotation.set(0, swap.rotA, 0);
    const k = (w - B_START) / swap.tB;
    step(b, swap.pathB, k, 'rotB', 2);
    b.scale.setScalar(0.5 + 0.24 * ease2(THREE.MathUtils.clamp(k, 0, 1)));
  } else if (w < UP) {
    const k = ease2((w - B_END) / 0.6);
    swap.rotB = turnToward(swap.rotB, 0.12, dt, 10);
    b.position.set(0, CATCH_Y * k, PUT_DOWN.z + (HOLD_Z - PUT_DOWN.z) * k);
    b.rotation.set(0, swap.rotB, 0);
    b.scale.setScalar(0.74);
    swap.open = 1 - k;
  } else if (w >= END) {
    const oldHeld = small, oldId = heldId;
    ducks.remove(oldHeld);
    oldHeld.position.copy(swap.home); oldHeld.position.y = 0;
    oldHeld.rotation.set(0, faceCenter(swap.home.x, swap.home.z), 0);
    oldHeld.scale.setScalar(0.5);
    oldHeld.userData.id = oldId; oldHeld.userData.phase = smallIds.indexOf(oldId) * 1.3; oldHeld.userData.busy = false;
    oldHeld.userData.facing = oldHeld.rotation.y; oldHeld.userData.act = null; oldHeld.userData.walkLast = null;
    scene.add(oldHeld);
    buddyObjs.splice(buddyObjs.indexOf(b), 1, oldHeld);
    scene.remove(b);
    b.userData.busy = false; b.userData.act = null; b.userData.body.rotation.set(0, 0, 0); b.userData.body.scale.y = 1;
    b.scale.setScalar(0.74); b.rotation.set(0, 0.12, 0);
    ducks.add(b);
    small = b;
    heldId = swap.newId;
    smallY = CATCH_Y; smallZ = HOLD_Z; smallX = 0;
    swap.active = false; swap.open = 0;
    squeeze = 1; popHearts(); hap.caught(); quack(0, 1.3, 0.35, 0.12);
    if (swap.done) swap.done();
  }
}


// ---------- 場景佈置（節慶主題）：先做聖誕節 ----------
const DM = {
  pine: mat(0x3f9e5a), pineDark: mat(0x2f7f47), trunk: mat(0x9a6a43), snow: mat(0xffffff), carrot: mat(0xff8a3d),
  coal: mat(0x2b2b2b), giftRed: mat(0xe8524a), giftGreen: mat(0x5cbf6a), giftBlue: mat(0x5aa9e6), ribbon: mat(0xffd24a),
};
const DECOR_BUILD = {
  tree: () => {
    const g = new THREE.Group();
    const trunk = shape(CYL, DM.trunk, 0.2, 0.6, 0.2); trunk.position.y = 0.3; g.add(trunk);
    [[1.15, 1.3, 1.0], [0.9, 1.1, 1.75], [0.62, 0.95, 2.4]].forEach(([r, h, y], i) => {
      const c = shape(CONE, i % 2 ? DM.pineDark : DM.pine, r, h, r); c.position.y = y; g.add(c);
    });
    const star = part(new THREE.OctahedronGeometry(0.2), M.gold); star.position.y = 3.0; star.rotation.z = Math.PI / 4; g.add(star);
    g.userData.star = star;
    const balls = [M.red, M.gold, M.blue, M.pink];
    for (let i = 0; i < 14; i++) {
      const lvl = i % 3, a = i * 2.39, rr = [0.95, 0.72, 0.48][lvl], yy = [0.75, 1.5, 2.15][lvl];
      const b = blob(balls[i % 4], 0.09, 0.09, 0.09); b.position.set(Math.sin(a) * rr, yy, Math.cos(a) * rr); g.add(b);
    }
    return g;
  },
  snowman: () => {
    const g = new THREE.Group();
    [[0.55, 0.5], [0.42, 1.28], [0.32, 1.9]].forEach(([r, y]) => { const b = blob(DM.snow, r, r, r); b.position.y = y; g.add(b); });
    for (const sx of [-1, 1]) { const e = blob(DM.coal, 0.045, 0.05, 0.03, false); e.position.set(sx * 0.11, 1.98, 0.28); g.add(e); }
    const nose = shape(CONE, DM.carrot, 0.06, 0.32, 0.06); nose.rotation.x = Math.PI / 2; nose.position.set(0, 1.9, 0.42); g.add(nose);
    for (const y of [1.15, 1.35, 1.55]) { const bt = blob(DM.coal, 0.045, 0.045, 0.03, false); bt.position.set(0, y, Math.sqrt(Math.max(0, 0.42 ** 2 - (y - 1.28) ** 2)) + 0.01); g.add(bt); }
    const scarf = part(new THREE.TorusGeometry(0.3, 0.07, 10, 30), M.red); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.64; g.add(scarf);
    const brim = shape(CYL, DM.coal, 0.34, 0.04, 0.34); brim.position.y = 2.17; g.add(brim);
    const top = shape(CYL, DM.coal, 0.22, 0.36, 0.22); top.position.y = 2.36; g.add(top);
    const band = shape(CYL, M.red, 0.225, 0.07, 0.225, false); band.position.y = 2.24; g.add(band);
    return g;
  },
  gifts: () => {
    const g = new THREE.Group();
    [[DM.giftRed, 0.7, 0.55, 0.7, 0, 0, 0.2], [DM.giftGreen, 0.55, 0.45, 0.55, 0.62, 0.15, -0.3], [DM.giftBlue, 0.45, 0.6, 0.45, -0.55, 0.25, 0.5], [DM.giftRed, 0.35, 0.3, 0.35, 0.15, 0.55, 0.9]].forEach(([m, w, h, d, x, z, ry]) => {
      const box = new THREE.Group();
      const b = shape(BOX, m, w, h, d); b.position.y = h / 2; box.add(b);
      const r1 = shape(BOX, DM.ribbon, w + 0.01, h + 0.01, 0.1, false); r1.position.y = h / 2; box.add(r1);
      const r2 = shape(BOX, DM.ribbon, 0.1, h + 0.01, d + 0.01, false); r2.position.y = h / 2; box.add(r2);
      for (const sx of [-1, 1]) { const bow = blob(DM.ribbon, 0.1, 0.07, 0.05); bow.position.set(sx * 0.08, h + 0.05, 0); bow.rotation.z = sx * 0.6; box.add(bow); }
      box.position.set(x, 0, z); box.rotation.y = ry; g.add(box);
    });
    return g;
  },
  lights: () => {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 40; i++) { const k = i / 40; const x = -4 + 8 * k; pts.push(new THREE.Vector3(x, 3.6 - Math.sin(k * Math.PI * 3) ** 2 * 0.45, -4.9 + Math.sin(k * Math.PI) * 0.4)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.025, 6, false), new THREE.MeshBasicMaterial({ color: 0x2b2b2b })));
    const cols = [0xff5a5a, 0xffd24a, 0x5cd67a, 0x5aa9ff, 0xff8fd1];
    g.userData.bulbs = [];
    for (let i = 0; i < 26; i++) {
      const p = curve.getPointAt((i + 0.5) / 26);
      const m = new THREE.MeshBasicMaterial({ color: cols[i % cols.length] });
      const bulb = new THREE.Mesh(SPHERE, m); bulb.scale.set(0.08, 0.11, 0.08); bulb.position.copy(p).add(new THREE.Vector3(0, -0.1, 0));
      g.add(bulb); g.userData.bulbs.push({ m, base: new THREE.Color(cols[i % cols.length]), i });
    }
    return g;
  },
  snowfall: () => {
    const N = 420, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 11; pos[i * 3 + 1] = Math.random() * 7.5; pos[i * 3 + 2] = -6 + Math.random() * 9; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g2 = c.getContext('2d'); g2.beginPath(); g2.arc(32, 32, 24, 0, Math.PI * 2); g2.fillStyle = '#ffffff'; g2.fill(); g2.lineWidth = 5; g2.strokeStyle = '#9db6c9'; g2.stroke();
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.14, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, alphaTest: 0.3 }));
    pts.userData.snow = true;
    return pts;
  },
};
// 擺放位置（避開小鴨的站位和換衣間）＋ 給走路路線用的障礙物大小
const DECOR_PLACE = {
  tree: { x: -1.6, z: -4.7, ry: 0, r: 1.15 },
  gifts: { x: -2.15, z: -3.65, ry: 0.3, r: 0.75 },
  snowman: { x: 2.1, z: -1.1, ry: -0.7, r: 0.6 },
  lights: { x: 0, z: 0, ry: 0, r: 0 },
  snowfall: { x: 0, z: 0, ry: 0, r: 0 },
};
const decorObjs = {};
function applyDecor(shown) {
  for (const id of Object.keys(DECOR_BUILD)) {
    const want = shown.includes(id);
    if (want && !decorObjs[id]) {
      const o = DECOR_BUILD[id]();
      const pl = DECOR_PLACE[id];
      o.position.set(pl.x, 0, pl.z); o.rotation.y = pl.ry;
      scene.add(o); decorObjs[id] = o;
    } else if (!want && decorObjs[id]) { scene.remove(decorObjs[id]); delete decorObjs[id]; }
  }
}
const decorObstacles = () => Object.keys(decorObjs).filter((id) => DECOR_PLACE[id].r).map((id) => ({ x: DECOR_PLACE[id].x, z: DECOR_PLACE[id].z, r: DECOR_PLACE[id].r }));
function animateDecor(t, dt) {
  const sn = decorObjs.snowfall;
  if (sn) {
    const a = sn.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) - dt * (0.45 + (i % 7) * 0.05);
      if (y < 0) y += 7.5;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(t * 0.8 + i) * dt * 0.12);
    }
    a.needsUpdate = true;
  }
  const li = decorObjs.lights;
  if (li) for (const b of li.userData.bulbs) { const on = Math.sin(t * 3 + b.i * 1.7) > -0.2; b.m.color.copy(b.base).multiplyScalar(on ? 1 : 0.35); }
  const tr = decorObjs.tree;
  if (tr) tr.userData.star.rotation.y = t * 1.2;
}


// ---------- 大鴨的目光：一直看著小鴨（抱著時往下看、飛上去時抬頭、哭的時候看著牠） ----------
const HEAD_A = 0.62, HEAD_B = 0.69;            // 頭（橢圓）的水平、垂直半徑
const gaze = { yaw: 0, pitch: 0 };
const tmpG = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpE = new THREE.Euler();
// 沿著方向 d 從頭的中心往外找「真正的身體表面」（梨形：低頭時會碰到比較胖的肚子，五官要跟著浮出來，不能陷進去）
function surfR(d) {
  const h = Math.hypot(d.x, d.z);
  let lo = 0, hi = 2.2;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const y = 1.61 + mid * d.y;
    const inside = y > 0 && y < 2.3 && mid * h < big.userData.r(y);
    if (inside) lo = mid; else hi = mid;
  }
  return lo;
}
for (const f of big.userData.feats) { const d = f.p0.clone().normalize(); f.dir0 = d; f.off = f.p0.length() - surfR(d); }
function updateGaze(dt) {
  const face = big.userData.face;
  // 要看的地方：小鴨的頭；小鴨在畫面上方看不到時（等著掉下來）就抬頭往上看
  let target;
  if (!small.visible || smallY > 5.5) target = tmpG.set(0, 9, 1.2);
  else target = small.localToWorld(tmpG.set(0, 1.1, 0));
  face.worldToLocal(target);
  const horiz = Math.hypot(target.x, target.z);
  let yaw = Math.atan2(target.x, Math.max(0.2, target.z));
  let pitch = Math.atan2(target.y, Math.max(0.25, horiz));
  yaw = THREE.MathUtils.clamp(yaw, -0.75, 0.75);
  pitch = THREE.MathUtils.clamp(pitch, -0.42, 0.45); // 抬頭最多到這裡，臉還看得到
  const k = Math.min(1, dt * 8);
  gaze.yaw += (yaw - gaze.yaw) * k;
  gaze.pitch += (pitch - gaze.pitch) * k;
  tmpQ.setFromEuler(tmpE.set(-gaze.pitch, gaze.yaw, 0, 'YXZ'));
  // 五官沿著頭的表面滑動（不會陷進頭裡或浮在外面）
  for (const f of big.userData.feats) {
    const d = tmpG.copy(f.dir0).applyQuaternion(tmpQ);
    f.o.position.copy(d).multiplyScalar(surfR(d) + f.off);
    f.o.quaternion.copy(tmpQ).multiply(f.q0);
  }
  // 抬頭往上看時，整隻稍微往後仰
  const lean = THREE.MathUtils.clamp(gaze.pitch - 0.1, 0, 0.4) * 0.25;
  big.userData.body.rotation.x = -lean;
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
const CAM_HOME = new THREE.Vector3(0, 0.95, 0.3);
const CAM_BOOTH = new THREE.Vector3(0.4, 1.25, -1.2); // 換衣服時鏡頭往後移，看得到換衣間
const camGoal = new THREE.Vector3().copy(CAM_HOME);
const camDelta = new THREE.Vector3();
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
let camFitDist = dist;
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
let revealDone = false;
let decoy = false;                       // 多人派對：這一輪鴨子不是飛給我（但我自己不知道）
let emptyPresses = [], tired = 0;        // 連續空按 → 手好酸鴨
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
// 衝刺鴨加速後速度很快 → 接住的範圍再放寬一些
const winHi = () => WIN_HI + (has('dash') && trickState.dashed ? 0.4 : 0);
const winLo = () => WIN_LO - (has('dash') && trickState.dashed ? 0.3 : 0);

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
  revealDone = false;
  if (s !== 'wait' && s !== 'fall') { decoy = false; if (tired > 0) { tired = 0; hideBubble(); } }
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
  if (tired > 0) return;
  if (state === 'wait' || state === 'fall') {
    if (!wingsClosed) {
      wingsClosed = true;
      const rel = smallY - CATCH_Y;
      if (state === 'fall' && rel <= winHi() && rel >= winLo()) {
        // 時機剛好 → 接住
        setState('caught');
        sfx.stopFall();
        smallY = CATCH_Y; vel = 0; small.visible = true;
        squeeze = 1;
        streak++;
        if (streak > best) { best = streak; try { localStorage.setItem(bestKey(), best); } catch (e) {} }
        updateScore();
        const firsts = recordCaught(trick);
        const reward = coinReward(trick);
        addCoins(reward); setTimeout(() => sfx.coin(), 260); if (reward > 1) setTimeout(() => sfx.coin(), 420); buddiesCheer();
        if (firsts.length || streak % 5 === 0) { sfx.fanfare(); hap.big(); } else { sfx.catchSound(streak); hap.caught(); }
        if (firsts.length) firsts.forEach((tr) => achieve(`成功接住${tr.name.replace('！', '')}`));
        else toast(streak >= 3 ? `接得好！連續 ${streak} 隻` : '接得好！');

        setButton('…', false);
      } else {
        sfx.swish(); hap.early();
        const now = performance.now();
        emptyPresses = emptyPresses.filter((x) => now - x < 2500);
        emptyPresses.push(now);
        if (emptyPresses.length >= 5) {
          // 連續空按 5 次 → 大鴨停下來：手好酸鴨
          emptyPresses = [];
          tired = 2.6;
          setButton('手好酸鴨…', false);
          showBubble('手好酸鴨…');
          quack(0.1, 0.7, 0.35, 0.35);
          say('手好酸鴨', 0.85, 0.9, 200);
          hap.sad();
        } else {
          toast('太早了！');
          earlyCooldown = 0.1;
          setButton('…', false);
        }
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
  show(document.getElementById('dex'), false); show(document.getElementById('shop'), false);
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
function myPresence(extra = {}) { return { code: roomCode, name: myName(), host: isHost, kind: roomKind, st: started ? 1 : 0, thr: currentThrower || null, ...extra }; }
function pushPresence() { if (net && roomCode) net.presence(myPresence()).catch(() => {}); }
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
  show(lobbyEl, false); show(startBtn, false);
  mode = roomKind; streak = 0; loadBest(); updateScore();
  show(duoEl, false); show(actionBtn, true); show(roomEl, true);
  drawRoomLine();
  resetLooks(); smallZ = HOLD_Z;
  currentThrower = first;
  if (first === myPeer) becomeThrower(roomKind === 'duo' ? `${partner ? partner.name : '朋友'} 加入了！你先拋鴨` : '你先拋鴨！');
  else becomeWaiter(`加入成功！等 ${nameOf(first)} 拋鴨`);
  sfx.dingDong(); hap.ding();
  pushPresence();
}
// 其他人都離開了：留在房間等他們回來（用同一個房號就能回來）
function backToWaiting(text) {
  started = false; isHost = true; partner = roomKind === 'duo' ? null : partner;
  currentThrower = null; pendingTarget = null;
  mode = 'solo'; role = null;
  resetLooks(); smallY = CATCH_Y; smallZ = HOLD_Z; setState('idle');
  show(actionBtn, false); show(roomEl, false);
  show(duoEl, true); show(document.getElementById('roomJoin'), false); show(document.getElementById('inviteBtn'), true);
  duoMsg.textContent = `${text}\n房間號碼：${roomCode}，朋友輸入這個號碼就能回來。`;
  pushPresence();
  if (roomKind === 'multi') drawLobby();
}
function becomeThrower(msg) {
  role = 'thrower'; pendingTarget = null; currentThrower = myPeer;
  setTimeout(pushPresence, 0);
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
  const hostP = others.find((p) => p.presence.host) || others.find((p) => p.presence.kind);
  if (!isHost && hostP && hostP.presence.kind && !started) {
    const k = hostP.presence.kind === 'multi' ? 'multi' : 'duo';
    if (k !== roomKind) { roomKind = k; setLabel(duoTitle, k === 'multi' ? '多人派對' : '雙人連線', k === 'multi' ? 'party' : 'duo', { size: 26 }); }
  }
  let list = others.map((p) => ({ peer: p.peer, name: String(p.presence.name || '朋友').slice(0, 10), host: !!p.presence.host, presence: p.presence }));
  if (roomKind === 'duo') list = list.slice(0, 1);
  else list = list.slice(0, MAX_PLAYERS - 1);
  const before = players.map((x) => x.peer);
  players = list;
  for (const x of players) if (!before.includes(x.peer)) seen[x.peer] = seen[x.peer] || 0;

  if (roomKind === 'duo') {
    const p = players[0];
    if (!p) {
      if (partner && !lostTimer) lostTimer = setTimeout(() => { lostTimer = null; if (!players.length && started) { toast('朋友離線了'); backToWaiting('朋友離線了，等他回來…'); } }, 3000);
    } else {
      clearTimeout(lostTimer); lostTimer = null;
      const pp = list[0].presence;
      if (!partner || partner.peer !== p.peer) {
        partner = { peer: p.peer, name: p.name };
        if (!started && myPeer) {
          // 對方正在玩（我是回來的人）→ 照對方記得的輪次；不然由房主（沒有房主就用編號小的）先拋
          let first;
          if (pp.st && pp.thr) first = pp.thr;
          else if (isHost) first = myPeer;
          else if (p.host) first = p.peer;
          else first = [myPeer, p.peer].sort()[0];
          beginGame(first);
        }
      }
    }
  } else {
    // 房主不見了而且還沒開始 → 編號最小的人當新房主
    if (!started && !isHost && myPeer && !list.some((x) => x.host) && list.length && [myPeer, ...list.map((x) => x.peer)].sort()[0] === myPeer) {
      isHost = true; pushPresence();
    }
    // 回到已經開始的派對 → 直接加入，等鴨子飛來
    const live = list.find((x) => x.presence.st);
    if (!started && live && myPeer) beginGame(live.presence.thr && live.presence.thr !== myPeer ? live.presence.thr : live.peer);
    drawLobby();
    if (started) {
      drawRoomLine(); checkStuck();
      if (!players.length && !lostTimer) lostTimer = setTimeout(() => { lostTimer = null; if (!players.length && started) backToWaiting('其他人都離開了，等朋友回來…'); }, 3000);
      if (players.length) { clearTimeout(lostTimer); lostTimer = null; }
    }
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
    // 拋鴨的人離開了 → 如果有人說鴨子在他手上就交給他，不然由編號最小的人接手
    const holder = players.find((x) => x.presence && x.presence.st && x.presence.thr === x.peer);
    const next = holder ? holder.peer : [...alive].sort()[0];
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
  // 多人派對：誰要接是秘密，連拋的人都不知道
  if (roomKind === 'multi') { setButton('鴨子飛出去了…', false); toast('鴨子飛出去了！'); }
  else setButton(`等 ${target.name} 接…`, false);
}
function sendResult(ok) { currentThrower = myPeer; sendMsg({ t: 'result', ok, streak, at: Date.now() }); }
function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
function handleMsg(msg, from) {
  if (msg.t === 'start') {
    if (!started) beginGame(from);
    return;
  }
  if (!started && (msg.t === 'throw' || msg.t === 'result')) beginGame(msg.t === 'result' ? from : (msg.to === myPeer ? from : from));
  if (msg.t === 'throw') {
    currentThrower = from;
    const forMe = roomKind === 'duo' || !msg.to || msg.to === myPeer;
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
    // 多人派對：大家畫面都一樣（都能按接住、翅膀都能揮），只有真正被選中的人鴨子會掉下來
    decoy = !forMe;
    if (decoy) { waitFor = 1e9; trick = []; }
    setButton('接住！');
    toast(roomKind === 'multi' ? '鴨子飛出去了！注意！' : `${nameOf(from)} 拋鴨了！`);
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

// ---------- 鴨幣 ＆ 鴨商城（介面） ----------
let coins = 0;
try { coins = Math.max(0, Math.floor(+localStorage.getItem('hugduck-coins') || 0)); } catch (e) {}
const shopState = { owned: [], outfit: null };
try { Object.assign(shopState, JSON.parse(localStorage.getItem('hugduck-shop') || '{}')); } catch (e) {}
const saveShop = () => { try { localStorage.setItem('hugduck-shop', JSON.stringify(shopState)); localStorage.setItem('hugduck-coins', String(coins)); } catch (e) {} };
const coinEl = document.getElementById('coins');
function drawCoins(bump) {
  coinEl.innerHTML = `${icon('coin', 24)}<b>${coins}</b>`;
  if (bump) { coinEl.classList.remove('bump'); void coinEl.offsetWidth; coinEl.classList.add('bump'); }
}
function addCoins(n) {
  coins += n; saveShop(); drawCoins(true);
  // 左上角飄出「+N」
  const f = document.createElement('div');
  f.className = 'coin-float' + (n > 1 ? ' big' : '');
  f.textContent = `+${n}`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1200);
}
// 接住的獎勵：普通鴨 1、衝刺鴨／隱形鴨 3、其他特殊鴨 2（組合技取最高的那個）
const COIN_REWARD = { dash: 3, vanish: 3 };
function coinReward(list) {
  if (!list || !list.length) return 1;
  return Math.max(...list.map((t) => COIN_REWARD[t.id] || 2));
}
drawCoins(false);

const SHOP_ITEMS = [
  { id: 'bowtie', kind: 'big', name: '紅領結', price: 40, ic: 'bowtie' },
  { id: 'scarf', kind: 'big', name: '溫暖圍巾', price: 60, ic: 'scarf' },
  { id: 'beanie', kind: 'big', name: '毛線帽', price: 80, ic: 'beanie' },
  { id: 'chef', kind: 'big', name: '廚師帽', price: 100, ic: 'chef' },
  { id: 'wizard', kind: 'big', name: '魔法師帽', price: 150, ic: 'wizard' },
  { id: 'crown', kind: 'big', name: '國王皇冠', price: 200, ic: 'crown' },
  { id: 'santa', kind: 'big', name: '聖誕帽', price: 70, ic: 'santa' },
  { id: 'white', kind: 'small', name: '原本的小白鴨', price: 0, ic: 'chick-fdfcf8', free: true },
  { id: 'yellow', kind: 'small', name: '小黃鴨', price: 10, ic: 'chick-ffe27a' },
  { id: 'grey', kind: 'small', name: '小灰鴨', price: 12, ic: 'chick-c9c4bd' },
  { id: 'pink', kind: 'small', name: '蝴蝶結小粉鴨', price: 18, ic: 'chick-ffd0dc-bow' },
  { id: 'blue', kind: 'small', name: '棒球帽小藍鴨', price: 22, ic: 'chick-cfe8ff-cap' },
  { id: 'leaf', kind: 'small', name: '小葉子綠鴨', price: 26, ic: 'chick-d8f0c8-leaf' },
  { id: 'cool', kind: 'small', name: '墨鏡酷小鴨', price: 30, ic: 'chick-fdfcf8-shades' },
  { id: 'xmas', kind: 'small', name: '聖誕小鴨', price: 28, ic: 'chick-ffe27a-santa' },
];
const SHOP_ACTS = [
  { id: 'wander', name: '散步', tip: '在自己的位置附近走來走去', price: 25, ic: 'walk' },
  { id: 'hop', name: '跳跳', tip: '開心地原地跳', price: 15, ic: 'hop' },
  { id: 'spin', name: '轉圈圈', tip: '原地轉一圈', price: 15, ic: 'spin' },
  { id: 'doze', name: '打瞌睡', tip: '點頭打盹，冒出 zzz', price: 20, ic: 'doze' },
  { id: 'dance', name: '跳舞', tip: '左右搖擺扭來扭去', price: 25, ic: 'dance' },
];
shopState.acts = Array.isArray(shopState.acts) ? shopState.acts.filter((id) => SHOP_ACTS.some((a) => a.id === id)) : [];
shopState.actsOff = Array.isArray(shopState.actsOff) ? shopState.actsOff : [];
const refreshActs = () => { enabledActs = shopState.acts.filter((id) => !shopState.actsOff.includes(id)); };
refreshActs();
// 一進來就穿上已經買好的造型、讓夥伴小鴨站好
shopState.owned = shopState.owned.filter((id) => SHOP_ITEMS.some((x) => x.id === id));
if (!shopState.owned.includes(shopState.outfit)) shopState.outfit = null;
wearOutfit(shopState.outfit);
if (shopState.held && shopState.held !== 'white' && shopState.owned.includes(shopState.held)) setHeldDuck(shopState.held);
else shopState.held = 'white';
placeBuddies(shopState.owned.filter((id) => BUDDIES[id]));

// 場景佈置：節慶主題（之後可以加新年、萬聖節…）
const DECOR_THEMES = [
  { id: 'xmas', name: '聖誕節套件', ic: 'xtree', items: [
    { id: 'tree', name: '聖誕樹', price: 60, ic: 'xtree' },
    { id: 'snowman', name: '雪人', price: 45, ic: 'snowman' },
    { id: 'gifts', name: '禮物堆', price: 30, ic: 'gift' },
    { id: 'lights', name: '聖誕燈串', price: 35, ic: 'lights' },
    { id: 'snowfall', name: '下雪', price: 50, ic: 'snow' },
  ] },
];
shopState.decor = Array.isArray(shopState.decor) ? shopState.decor.filter((id) => DECOR_BUILD[id]) : [];
shopState.decorOff = Array.isArray(shopState.decorOff) ? shopState.decorOff : [];
const shownDecor = () => shopState.decor.filter((id) => !shopState.decorOff.includes(id));
applyDecor(shownDecor());
// 全套：還沒買的那些打 8 折
const bundlePrice = (th) => Math.round(th.items.filter((x) => !shopState.decor.includes(x.id)).reduce((a, x) => a + x.price, 0) * 0.8);

const shopEl = document.getElementById('shop');
const shopList = document.getElementById('shopList');
let shopTab = 'big';
function openShop() {
  show(menuEl, false); show(shopEl, true); show(actionBtn, false); show(submitEl, false); hideBubble();
  document.querySelectorAll('#shop .tab').forEach((b) => b.classList.toggle('on', b.dataset.k === shopTab));
  document.getElementById('shopCoins').innerHTML = `${icon('coin', 26)}<b>${coins}</b> 鴨幣　<small>每接住 1 隻得 1 枚</small>`;
  document.getElementById('shopHint').textContent = shopTab === 'big'
    ? '大鴨會走進從地面冒出來的換衣間，換上新造型'
    : shopTab === 'small' ? '買到的小鴨會站在大鴨後面，按「抱抱牠」就換牠被抱著'
    : '依節慶佈置場景，可以整套買（打 8 折）或單買';
  shopList.textContent = '';
  if (shopTab === 'decor') { drawDecorShop(); return; }
  for (const it of SHOP_ITEMS.filter((x) => x.kind === shopTab)) {
    const owned = it.free || shopState.owned.includes(it.id);
    const worn = shopState.outfit === it.id;
    const li = document.createElement('li');
    li.innerHTML = `<span class="sh-ic">${icon(it.ic, 46)}</span><span class="sh-tx"><b></b><small>${icon('coin', 16)}${it.price}</small></span>`;
    li.querySelector('b').textContent = it.name;
    const btn = document.createElement('button');
    if (!owned) {
      btn.textContent = coins >= it.price ? '購買' : `還差 ${it.price - coins}`;
      btn.disabled = coins < it.price;
      btn.className = 'buy';
      btn.onclick = () => buy(it);
    } else if (it.kind === 'big') {
      btn.textContent = worn ? '脫下' : '穿上';
      btn.className = worn ? '' : 'buy';
      btn.onclick = () => changeOutfit(worn ? null : it.id);
    } else if (heldId === it.id) {
      btn.textContent = '抱著中';
      btn.disabled = true;
    } else {
      btn.textContent = '抱抱牠';
      btn.className = 'buy';
      btn.onclick = () => holdBuddy(it);
    }
    li.appendChild(btn);
    shopList.appendChild(li);
  }
  if (shopTab === 'small') drawActsShop();
}
function drawActsShop() {
  const head = document.createElement('li');
  head.className = 'section';
  head.textContent = '小鴨的等待動作（買了之後所有夥伴小鴨都會做）';
  shopList.appendChild(head);
  for (const a of SHOP_ACTS) {
    const owned = shopState.acts.includes(a.id);
    const li = document.createElement('li');
    li.innerHTML = `<span class="sh-ic">${icon(a.ic, 40)}</span><span class="sh-tx"><b></b><small></small></span>`;
    li.querySelector('b').textContent = a.name;
    li.querySelector('small').innerHTML = owned ? '' : `${icon('coin', 16)}${a.price}　`;
    li.querySelector('small').append(a.tip);
    const btn = document.createElement('button');
    if (!owned) {
      btn.textContent = coins >= a.price ? '購買' : `還差 ${a.price - coins}`;
      btn.disabled = coins < a.price; btn.className = 'buy';
      btn.onclick = () => {
        if (coins < a.price) return;
        coins -= a.price; shopState.acts.push(a.id); saveShop(); drawCoins(true); sfx.coin(); refreshActs();
        show(shopEl, false); toast(`小鴨們學會${a.name}了！`); sfx.sparkle(); buddiesCheer();
        setTimeout(openShop, 2600);
      };
    } else {
      const on = !shopState.actsOff.includes(a.id);
      btn.textContent = on ? '關閉' : '開啟';
      btn.className = on ? '' : 'buy';
      btn.onclick = () => { shopState.actsOff = shopState.actsOff.filter((x) => x !== a.id); if (on) shopState.actsOff.push(a.id); saveShop(); refreshActs(); openShop(); };
    }
    li.appendChild(btn);
    shopList.appendChild(li);
  }
}
function buy(it) {
  if (coins < it.price || shopState.owned.includes(it.id)) return;
  coins -= it.price;
  shopState.owned.push(it.id);
  saveShop(); drawCoins(true); sfx.coin();
  if (it.kind === 'big') changeOutfit(it.id);
  else {
    placeBuddies(shopState.owned.filter((id) => BUDDIES[id]));
    show(shopEl, false);
    toast(`${it.name}來到大鴨身後了！`);
    sfx.pop(); hap.caught(); buddiesCheer();
    setTimeout(openShop, 1800);
  }
}
function drawDecorShop() {
  const row = (ic, name, priceHtml, btn, cls = '') => {
    const li = document.createElement('li');
    if (cls) li.className = cls;
    li.innerHTML = `<span class="sh-ic">${icon(ic, 46)}</span><span class="sh-tx"><b></b><small>${priceHtml}</small></span>`;
    li.querySelector('b').textContent = name;
    li.appendChild(btn);
    shopList.appendChild(li);
  };
  for (const th of DECOR_THEMES) {
    const remain = th.items.filter((x) => !shopState.decor.includes(x.id));
    const bp = bundlePrice(th);
    const all = document.createElement('button');
    if (remain.length) {
      all.textContent = coins >= bp ? '全套購買' : `還差 ${bp - coins}`;
      all.disabled = coins < bp; all.className = 'buy';
      all.onclick = () => buyDecor(th, remain, bp);
    } else {
      const anyShown = th.items.some((x) => !shopState.decorOff.includes(x.id));
      all.textContent = anyShown ? '全部收起' : '全部擺出';
      all.onclick = () => { for (const x of th.items) toggleDecor(x.id, !anyShown, true); openShop(); };
    }
    const orig = remain.reduce((a, x) => a + x.price, 0);
    row(th.ic, `${th.name}（全套 ${th.items.length} 件）`, remain.length ? `${icon('coin', 16)}${bp}　<s>${orig}</s>` : '已全部擁有', all, 'bundle');
    for (const it of th.items) {
      const owned = shopState.decor.includes(it.id);
      const btn = document.createElement('button');
      if (!owned) {
        btn.textContent = coins >= it.price ? '購買' : `還差 ${it.price - coins}`;
        btn.disabled = coins < it.price; btn.className = 'buy';
        btn.onclick = () => buyDecor(th, [it], it.price);
      } else {
        const on = !shopState.decorOff.includes(it.id);
        btn.textContent = on ? '收起' : '擺出';
        btn.className = on ? '' : 'buy';
        btn.onclick = () => { toggleDecor(it.id, !on); openShop(); };
      }
      row(it.ic, it.name, `${icon('coin', 16)}${it.price}`, btn);
    }
  }
}
function toggleDecor(id, on, quiet) {
  shopState.decorOff = shopState.decorOff.filter((x) => x !== id);
  if (!on) shopState.decorOff.push(id);
  saveShop(); applyDecor(shownDecor());
  if (!quiet) sfx.pop();
}
function buyDecor(th, items, price) {
  if (coins < price || !items.length) return;
  coins -= price;
  for (const it of items) { if (!shopState.decor.includes(it.id)) shopState.decor.push(it.id); shopState.decorOff = shopState.decorOff.filter((x) => x !== it.id); }
  saveShop(); drawCoins(true); sfx.coin(); applyDecor(shownDecor());
  show(shopEl, false);
  toast(items.length > 1 ? `${th.name}佈置好了！` : `${items[0].name}擺好了！`);
  sfx.sparkle(); hap.caught(); buddiesCheer();
  setTimeout(openShop, 1900);
}
function holdBuddy(it) {
  if (swap.active || wardrobe.active || heldId === it.id) return;
  show(shopEl, false);
  const ok = startSwap(it.id, () => {
    shopState.held = it.id; saveShop();
    toast(`換抱${it.name}了！`);
    setTimeout(openShop, 1000);
  });
  if (!ok) openShop();
}
function changeOutfit(id) {
  if (wardrobe.active) return;
  shopState.outfit = id; saveShop();
  show(shopEl, false);
  startWardrobe(id, () => { toast(id ? '換好了！好看嗎？' : '換回原本的樣子了'); setTimeout(openShop, 900); });
}
document.getElementById('shopBtn').addEventListener('click', openShop);
document.querySelectorAll('#shop .tab').forEach((b) => b.addEventListener('click', () => { shopTab = b.dataset.k; openShop(); }));
document.getElementById('shopBack').addEventListener('click', openMenu);

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
  animateWardrobe(dt, clock.elapsedTime);
  animateSwap(dt, clock.elapsedTime);
  animateBuddies(clock.elapsedTime, dt);
  animateDecor(clock.elapsedTime, dt);
  updateGaze(dt);
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
      const e = k * k;                 // 越甩越快，放手那一刻速度最快
      wingDY = -0.22 + 0.72 * e; wingLift = 0.25 - 0.85 * e; open = 0;
      smallY = CATCH_Y + wingDY; smallZ = HOLD_Z;
      bigDip = 1 - k * 1.6;
      tossVel = (2 * 0.72) / (T_UP - T_DIP); // = 放手瞬間翅膀往上的速度
    } else {                           // 放手：小鴨繼續往上飛，翅膀慢慢回到預備位置
      if (!tossReleased) { tossReleased = true; sfx.whooshUp(); hap.toss(); }
      const k = ease(Math.min(1, (tt - T_UP) / (T_BACK - T_UP)));
      wingDY = 0.5 * (1 - k); wingLift = -0.6 * (1 - k); open = k;
      smallY += tossVel * dt;          // 維持放手時的速度一路飛上去（不停頓、不突然加速）
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
    if (rel < winLo()) {
      // 沒接到：往前滑落到地上
      const k = THREE.MathUtils.clamp((winLo() - rel) / 0.4, 0, 1);
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
    if (stateT > 1.7 && !revealDone && trick && trick.length) {
      revealDone = true;
      toast(`剛剛那隻是${trick.map((x) => x.name.replace('！', '')).join('＋')}`, 'warning');
    }
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

  // 手好酸：休息一下，時間到才能再接
  if (tired > 0) {
    tired -= dt;
    if (tired <= 0) {
      tired = 0; hideBubble();
      if ((state === 'wait' || state === 'fall') && smallY - CATCH_Y >= winLo()) { wingsClosed = false; setButton('接住！'); sfx.flap(); }
    }
  }
  // 太早按的冷卻：0.1 秒後翅膀打開，可以再按
  if (earlyCooldown > 0 && tired <= 0 && (state === 'wait' || state === 'fall')) {
    earlyCooldown -= dt;
    if (earlyCooldown <= 0 && smallY - CATCH_Y >= winLo()) { wingsClosed = false; setButton('接住！'); sfx.flap(); }
  }

  // 小鴨位置
  const holding = state === 'idle' || state === 'caught';
  if (state !== 'fall') { smallX += (0 - smallX) * Math.min(1, dt * 8); small.visible = !(state === 'sent' || state === 'await'); }
  if (!swap.active && !wardrobe.active) small.position.set(smallX, smallY + bounce + (holding ? Math.sin(t * 2.2) * 0.012 + sq * 0.5 : 0), smallZ);
  if (!swap.active && !wardrobe.active) small.rotation.z = (crying ? Math.sin(t * 30) * 0.06 : Math.sin(t * 1.6) * 0.035) + flail * Math.sin(t * 22) * 0.18;
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
  const sad = state === 'miss' || tired > 0 ? 0.35 : swap.active ? swap.open : wardrobe.active ? wardrobe.open : 0;
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

  // 換衣服時鏡頭慢慢移過去看換衣間，結束再移回來（整台相機一起平移，角度不變）
  camGoal.copy(wardrobe.active ? CAM_BOOTH : CAM_HOME);
  camDelta.copy(camGoal).sub(controls.target).multiplyScalar(Math.min(1, dt * 2.5));
  if (camDelta.lengthSq() > 1e-8) { controls.target.add(camDelta); camera.position.add(camDelta); }
  // 換衣服時鏡頭稍微拉遠一點
  {
    const off = camera.position.clone().sub(controls.target);
    const want = wardrobe.active ? Math.max(off.length(), camFitDist * 1.3) : null;
    if (want && Math.abs(off.length() - want) > 0.01) { off.setLength(off.length() + (want - off.length()) * Math.min(1, dt * 2)); camera.position.copy(controls.target).add(off); }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
document.getElementById('loading').remove();
animate();

// 測試用：讓自動測試讀得到遊戲狀態
window.__duck = { get scene3d() { return { small, buddyObjs, pairRoot, swap, wardrobe, booth, big, hugWings, THREE }; }, get dex() { return dex; }, get state() { return state; }, get rel() { return smallY - CATCH_Y; }, get vel() { return vel; }, setStreak(n) { streak = n; updateScore(); }, get trick() { return trick && trick.map((t) => t.id); } };
