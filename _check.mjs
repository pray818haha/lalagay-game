
import * as THREE from 'three';
import * as TWEEN from 'https://cdn.jsdelivr.net/npm/@tweenjs/tween.js@23.1.3/dist/tween.esm.js';

/* =====================================================================
 * 第一部分：斗地主规则引擎（与服务端 games/doudizhu.js 规则一致）
 * ===================================================================== */

// 牌值：3-15（11=J,12=Q,13=K,14=A,15=2），16=小王，17=大王
const V_NAME = v => v === 16 ? '小王' : v === 17 ? '大王' : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }[v] || String(v));
const V_SHORT = v => v === 16 ? '小王' : v === 17 ? '大王' : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }[v] || String(v));
const SUIT_NAME = ['♠', '♥', '♣', '♦']; // s: 0黑桃 1红桃 2梅花 3方块
const SUIT_KEY = ['spade', 'heart', 'club', 'diamond'];

function buildDeck() {
  const d = [];
  let id = 0;
  for (let v = 3; v <= 15; v++) for (let s = 0; s < 4; s++) d.push({ id: id++, v, s });
  d.push({ id: id++, v: 16, s: 0 });
  d.push({ id: id++, v: 17, s: 1 });
  // 洗牌
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function countVals(cards) {
  const m = {};
  for (const c of cards) m[c.v] = (m[c.v] || 0) + 1;
  return m;
}

// 牌型名称（用于错误提示）
const TYPE_NAME = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', straight2: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', bomb: '炸弹', rocket: '王炸',
};

// 识别牌型，返回 {type, main, len} 或 null
function analyze(cards) {
  const n = cards.length;
  if (n === 0) return null;
  const cnt = countVals(cards);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const counts = vals.map(v => cnt[v]);
  const maxC = Math.max(...counts);
  if (vals[0] >= 15 && n > 2 && vals.includes(16) === false && vals.includes(17) === false && maxC <= 2) { /* 2 和王不参与顺子 */ }

  if (n === 1) return { type: 'single', main: vals[0], len: 1 };
  if (n === 2) {
    if (vals[0] === 16 && vals[1] === 17) return { type: 'rocket', main: 99, len: 2 };
    if (counts[0] === 2) return { type: 'pair', main: vals[0], len: 1 };
    return null;
  }
  if (n === 3 && counts[0] === 3) return { type: 'triple', main: vals[0], len: 1 };
  if (n === 4) {
    if (counts[0] === 4) return { type: 'bomb', main: vals[0], len: 1 };
    if (maxC === 3) return { type: 'triple1', main: vals[counts.indexOf(3)], len: 1 };
    return null;
  }
  if (n === 5 && maxC === 3 && counts.includes(2)) return { type: 'triple2', main: vals[counts.indexOf(3)], len: 1 };
  // 顺子：5张以上单顺，不含2和王
  if (n >= 5 && maxC === 1 && vals[n - 1] <= 14 && vals[n - 1] - vals[0] === n - 1) return { type: 'straight', main: vals[n - 1], len: n };
  // 连对：3连对以上，不含2和王
  if (n >= 6 && n % 2 === 0 && counts.every(c => c === 2) && vals[vals.length - 1] <= 14 && vals[vals.length - 1] - vals[0] === vals.length - 1)
    return { type: 'straight2', main: vals[vals.length - 1], len: vals.length };
  // 飞机：2个以上连续三张，可不带/带单/带对
  const triples = vals.filter(v => cnt[v] >= 3);
  if (triples.length >= 2) {
    // 找最长连续三张链
    for (let len = triples.length; len >= 2; len--) {
      for (let i = 0; i + len <= triples.length; i++) {
        const chain = triples.slice(i, i + len);
        if (chain[len - 1] > 14) continue;
        if (chain[len - 1] - chain[0] !== len - 1) continue;
        // 检查能否组成飞机
        const chainCards = len * 3;
        const rest = n - chainCards;
        if (rest === 0) return { type: 'plane', main: chain[len - 1], len };
        if (rest === len) return { type: 'plane1', main: chain[len - 1], len };
        if (rest === len * 2) {
          // 带的必须是对子
          const restVals = vals.filter(v => !chain.includes(v));
          const restCnt = restVals.map(v => cnt[v] - (cnt[v] >= 3 && chain.includes(v) ? 3 : 0));
          let pairs = 0;
          for (const v of vals) {
            let c = cnt[v];
            if (chain.includes(v)) c -= 3;
            if (c === 2) pairs++;
            else if (c === 4) pairs += 2;
            else if (c !== 0) { pairs = -999; break; }
          }
          if (pairs === len) return { type: 'plane2', main: chain[len - 1], len };
        }
      }
    }
    return null;
  }
  // 四带二
  if (n === 6 && maxC === 4) return { type: 'four2', main: vals[counts.indexOf(4)], len: 1 };
  return null;
}

// a 能否压过 b（b 为 null 表示领出）
function canBeat(a, b) {
  if (!a) return false;
  if (!b) return true;
  if (a.type === 'rocket') return true;
  if (b.type === 'rocket') return false;
  if (a.type === 'bomb' && b.type !== 'bomb') return true;
  if (b.type === 'bomb' && a.type !== 'bomb') return false;
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.main > b.main;
}

// 从手牌中找能压过 last 的最小组合（电脑用）
function findBeat(hand, last) {
  const cnt = countVals(hand);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const byV = v => hand.filter(c => c.v === v);

  // 尝试同牌型最小压
  if (last.type === 'single') {
    for (const v of vals) if (v > last.main) return byV(v).slice(0, 1);
  } else if (last.type === 'pair') {
    for (const v of vals) if (v > last.main && cnt[v] >= 2) return byV(v).slice(0, 2);
  } else if (last.type === 'triple') {
    for (const v of vals) if (v > last.main && cnt[v] >= 3) return byV(v).slice(0, 3);
  } else if (last.type === 'triple1') {
    for (const v of vals) if (v > last.main && cnt[v] >= 3) {
      const rest = hand.filter(c => c.v !== v);
      if (rest.length) return [...byV(v).slice(0, 3), rest[0]];
    }
  } else if (last.type === 'triple2') {
    for (const v of vals) if (v > last.main && cnt[v] >= 3) {
      const restVals = vals.filter(x => x !== v && cnt[x] >= 2);
      if (restVals.length) return [...byV(v).slice(0, 3), ...byV(restVals[0]).slice(0, 2)];
    }
  } else if (last.type === 'straight') {
    const len = last.len;
    const sv = vals.filter(v => v <= 14);
    for (let i = 0; i + len <= sv.length; i++) {
      const chain = sv.slice(i, i + len);
      if (chain[len - 1] - chain[0] !== len - 1) continue;
      if (chain[len - 1] <= last.main) continue;
      return chain.flatMap(v => byV(v).slice(0, 1));
    }
  } else if (last.type === 'straight2') {
    const len = last.len;
    const sv = vals.filter(v => v <= 14 && cnt[v] >= 2);
    for (let i = 0; i + len <= sv.length; i++) {
      const chain = sv.slice(i, i + len);
      if (chain[len - 1] - chain[0] !== len - 1) continue;
      if (chain[len - 1] <= last.main) continue;
      return chain.flatMap(v => byV(v).slice(0, 2));
    }
  }
  // 炸弹
  if (last.type !== 'bomb' && last.type !== 'rocket') {
    for (const v of vals) if (cnt[v] === 4) return byV(v);
    if (vals.includes(16) && vals.includes(17)) return [byV(16)[0], byV(17)[0]];
  } else if (last.type === 'bomb') {
    for (const v of vals) if (cnt[v] === 4 && v > last.main) return byV(v);
    if (vals.includes(16) && vals.includes(17)) return [byV(16)[0], byV(17)[0]];
  }
  return null;
}

// 电脑领出：出最小的单张/对子/三张
function botLead(hand) {
  const cnt = countVals(hand);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  // 优先出单张
  return [hand[0]];
}

/* =====================================================================
 * 第二部分：游戏状态
 * ===================================================================== */
const G = {
  phase: 'bid',           // bid | play | over
  hands: [[], [], []],    // 0=我 1=左对手 2=右对手
  bottom: [],
  landlord: -1,
  turn: 0,
  bidStarter: 0, bidCount: 0, maxBid: 0, maxBidSeat: -1, bids: {},
  last: null, lastSeat: -1, passCount: 0,
  turnStart: 0, turnTimeout: 25,
  winner: -1, over: false,
  log: [],
  selected: new Set(),    // 我选中的牌 id
  bidTimer: null,
};

function addLog(msg) {
  G.log.push(msg);
  const el = document.getElementById('log');
  el.innerHTML = G.log.slice(-8).map(l => `<div>${l}</div>`).join('');
}

function playerName(seat) {
  if (seat === 0) return '你';
  return seat === 1 ? '地主位(左)' : '农民位(右)';
}
function seatLabel3(seat) {
  return ['你', '左边', '右边'][seat];
}

/* =====================================================================
 * 第三部分：Three.js 场景
 * ===================================================================== */
const CARD_W = 35, CARD_H = 55, CARD_T = 0.28, CARD_R = 2.2;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3a3f52);
scene.fog = new THREE.Fog(0x3a3f52, 900, 1800);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 1, 3000);
camera.position.set(0, 280, 450);
camera.lookAt(0, 0, -40);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a1a10, 0.45);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dd, 1.0);
sun.position.set(150, 320, 180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -400; sun.shadow.camera.right = 400;
sun.shadow.camera.top = 400; sun.shadow.camera.bottom = -400;
sun.shadow.camera.near = 50; sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0002;
sun.shadow.radius = 4;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xe8f0ff, 0.4);
fill.position.set(-120, 160, 420);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1200, 64),
  new THREE.MeshStandardMaterial({ color: 0x5c6178, roughness: 1, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -50.5;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- 牌面纹理 ---------- */
const TEX_SCALE = 8;
const texCache = new Map();

const SUIT_SYMBOL = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const SUIT_RED = { spade: false, heart: true, club: false, diamond: true };

const PIPS = {
  '2': [[.5, .18, 0], [.5, .82, 1]],
  '3': [[.5, .18, 0], [.5, .5, 0], [.5, .82, 1]],
  '4': [[.3, .18, 0], [.7, .18, 0], [.3, .82, 1], [.7, .82, 1]],
  '5': [[.3, .18, 0], [.7, .18, 0], [.5, .5, 0], [.3, .82, 1], [.7, .82, 1]],
  '6': [[.3, .18, 0], [.7, .18, 0], [.3, .5, 0], [.7, .5, 0], [.3, .82, 1], [.7, .82, 1]],
  '7': [[.3, .15, 0], [.7, .15, 0], [.5, .32, 0], [.3, .5, 0], [.7, .5, 0], [.3, .85, 1], [.7, .85, 1]],
  '8': [[.3, .14, 0], [.7, .14, 0], [.5, .29, 0], [.3, .43, 0], [.7, .43, 0], [.3, .72, 1], [.7, .72, 1], [.3, .87, 1], [.7, .87, 1]],
  '9': [[.3, .13, 0], [.7, .13, 0], [.3, .35, 0], [.7, .35, 0], [.5, .5, 0], [.3, .65, 1], [.7, .65, 1], [.3, .87, 1], [.7, .87, 1]],
  '10': [[.3, .12, 0], [.7, .12, 0], [.5, .25, 0], [.3, .38, 0], [.7, .38, 0], [.3, .62, 1], [.7, .62, 1], [.5, .75, 1], [.3, .88, 1], [.7, .88, 1]],
};

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// JQK 贴图（程序绘制简化人像）
function drawCourt(ctx, W, H, rank, suitKey) {
  const red = SUIT_RED[suitKey];
  const col = red ? '#c0392b' : '#1a1a2e';
  const accent = red ? '#e74c3c' : '#2c3e50';
  const gold = '#d4a017';
  // 面板
  const fx = W * 0.17, fy = H * 0.075, fw = W * 0.66, fh = H * 0.85;
  ctx.save();
  ctx.fillStyle = '#fdfdf8';
  ctx.fillRect(fx, fy, fw, fh);
  ctx.strokeStyle = '#161616'; ctx.lineWidth = 3;
  ctx.strokeRect(fx, fy, fw, fh);
  // 上下两半人像（镜像）
  const drawHalf = (cy, flip) => {
    ctx.save();
    ctx.translate(fx + fw / 2, cy);
    if (flip) ctx.rotate(Math.PI);
    // 身体
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-fw * 0.28, fh * 0.22);
    ctx.lineTo(fw * 0.28, fh * 0.22);
    ctx.lineTo(fw * 0.2, -fh * 0.05);
    ctx.lineTo(-fw * 0.2, -fh * 0.05);
    ctx.closePath();
    ctx.fill();
    // 饰带
    ctx.strokeStyle = gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-fw * 0.2, fh * 0.05); ctx.lineTo(fw * 0.2, -fh * 0.02); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fw * 0.2, fh * 0.05); ctx.lineTo(-fw * 0.2, -fh * 0.02); ctx.stroke();
    // 头
    ctx.fillStyle = '#f2c89a';
    ctx.beginPath(); ctx.arc(0, -fh * 0.12, fw * 0.13, 0, Math.PI * 2); ctx.fill();
    // 冠/帽
    ctx.fillStyle = rank === 'K' ? gold : rank === 'Q' ? accent : col;
    ctx.fillRect(-fw * 0.11, -fh * 0.22, fw * 0.22, fh * 0.08);
    // 花色徽章
    ctx.fillStyle = col;
    ctx.font = `${fw * 0.16}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(SUIT_SYMBOL[suitKey], 0, fh * 0.1);
    ctx.restore();
  };
  drawHalf(fy + fh * 0.25, false);
  drawHalf(fy + fh * 0.75, true);
  ctx.restore();
}

// 生成牌面纹理
function makeFaceTexture(v, s) {
  const key = `f${v}_${s}`;
  if (texCache.has(key)) return texCache.get(key);
  const W = Math.round(CARD_W * TEX_SCALE), H = Math.round(CARD_H * TEX_SCALE);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // 牌底
  ctx.fillStyle = '#fdfdf8';
  roundRectPath(ctx, 0, 0, W, H, CARD_R * TEX_SCALE);
  ctx.fill();
  ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
  roundRectPath(ctx, 1, 1, W - 2, H - 2, CARD_R * TEX_SCALE);
  ctx.stroke();

  const isJoker = v >= 16;
  const suitKey = isJoker ? null : SUIT_KEY[s];
  const red = isJoker ? (v === 17) : SUIT_RED[suitKey];
  const color = red ? '#c0392b' : '#1a1a2e';

  if (isJoker) {
    // 大小王
    ctx.fillStyle = color;
    ctx.font = `bold ${W * 0.22}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const label = v === 17 ? '大王' : '小王';
    ctx.fillText(label, W / 2, H * 0.32);
    ctx.font = `bold ${W * 0.16}px serif`;
    ctx.fillText('JOKER', W / 2, H * 0.55);
    ctx.save();
    ctx.translate(W / 2, H * 0.78); ctx.rotate(Math.PI);
    ctx.font = `bold ${W * 0.22}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  } else if (v >= 11 && v <= 13) {
    // JQK
    drawCourt(ctx, W, H, V_NAME(v), suitKey);
  } else {
    // 数字牌 / A（按牌面名称查布局，v=15 对应 '2'）
    const rankName = V_NAME(v);
    const pips = v === 14 ? [[.5, .5, 0]] : PIPS[rankName];
    const pipSize = W * 0.23;
    for (const [px, py, flip] of pips) {
      ctx.save();
      ctx.translate(px * W, py * H);
      if (flip) ctx.rotate(Math.PI);
      ctx.fillStyle = color;
      ctx.font = `${pipSize}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SUIT_SYMBOL[suitKey], 0, 0);
      ctx.restore();
    }
  }
  // 角标（左上正立 + 右下倒置）
  const rankTxt = isJoker ? '' : V_NAME(v);
  const cornerSize = W * 0.16;
  const drawCorner = (cx, cy, flip) => {
    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = `bold ${cornerSize}px "Arial Narrow", Arial, sans-serif`;
    ctx.fillText(rankTxt, 0, 0);
    if (!isJoker) {
      ctx.font = `${cornerSize * 0.9}px serif`;
      ctx.fillText(SUIT_SYMBOL[suitKey], 0, cornerSize * 1.05);
    }
    ctx.restore();
  };
  drawCorner(W * 0.12, H * 0.03, false);
  drawCorner(W * 0.88, H * 0.97, true);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(key, tex);
  return tex;
}

// 牌背纹理
let backTex = null;
function makeBackTexture() {
  if (backTex) return backTex;
  const W = Math.round(CARD_W * TEX_SCALE), H = Math.round(CARD_H * TEX_SCALE);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#a03040';
  roundRectPath(ctx, 0, 0, W, H, CARD_R * TEX_SCALE);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 2;
  for (let x = -H; x < W + H; x += 14) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + H, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  roundRectPath(ctx, 8, 8, W - 16, H - 16, (CARD_R - 1) * TEX_SCALE);
  ctx.stroke();
  backTex = new THREE.CanvasTexture(cv);
  backTex.colorSpace = THREE.SRGBColorSpace;
  return backTex;
}

/* ---------- 卡牌几何体 ---------- */
function makeCardGeo() {
  const w = CARD_W / 2, h = CARD_H / 2, r = CARD_R;
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: CARD_T, bevelEnabled: false });
  geo.translate(0, 0, -CARD_T / 2);
  // UV 映射
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (pos.getX(i) + w) / (2 * w), (pos.getY(i) + h) / (2 * h));
  }
  return geo;
}
const cardGeo = makeCardGeo();
const sideMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

function createCardMesh(v, s) {
  const faceTex = makeFaceTexture(v, s);
  const frontMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.22 });
  const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(), roughness: 0.6 });
  const mesh = new THREE.Mesh(cardGeo, [frontMat, backMat, sideMat]);
  // 材质组：ExtrudeGeometry 有 2 组（front+back 一体），我们用平面贴正反面
  return mesh;
}

// 用平面贴正反面 + 薄盒体当侧面
function createCard(v, s) {
  const group = new THREE.Group();
  const faceTex = makeFaceTexture(v, s);
  const frontMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: faceTex, emissiveIntensity: 0.22 });
  const backMat = new THREE.MeshStandardMaterial({ map: makeBackTexture(), roughness: 0.6 });
  // 正面平面
  const front = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W - 0.4, CARD_H - 0.4), frontMat);
  front.position.z = CARD_T / 2 + 0.02;
  group.add(front);
  // 背面平面
  const back = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W - 0.4, CARD_H - 0.4), backMat);
  back.position.z = -CARD_T / 2 - 0.02;
  back.rotation.y = Math.PI;
  group.add(back);
  // 侧面薄盒
  const side = new THREE.Mesh(new THREE.BoxGeometry(CARD_W - 0.6, CARD_H - 0.6, CARD_T), sideMat);
  group.add(side);
  group.userData = { v, s, id: -1, flying: false, selected: false };
  return group;
}

/* ---------- Q版人物 ---------- */
function toonMat(color, roughness = 0.9) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}
function qmesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; return m; }

function createChibi(cfg) {
  const g = new THREE.Group();
  const skinMat = toonMat(cfg.skin, 0.75);
  const jacketMat = toonMat(cfg.jacket);
  const pantsMat = toonMat(cfg.pants);
  const darkMat = toonMat(0x1c1c1c, 0.85);
  const w = cfg.fat ? 1.28 : 1.0;
  const d = cfg.fat ? 1.18 : 0.92;

  const legGeo = new THREE.CapsuleGeometry(7.5, 18, 6, 14);
  for (const s of [-1, 1]) {
    const leg = qmesh(legGeo, pantsMat);
    leg.position.set(11 * s * w, 17, 0);
    g.add(leg);
  }
  const footGeo = new THREE.SphereGeometry(8.5, 18, 14);
  for (const s of [-1, 1]) {
    const foot = qmesh(footGeo, toonMat(cfg.shoes, 0.7));
    foot.scale.set(1, 0.55, 1.5);
    foot.position.set(11 * s * w, 4.5, 4);
    g.add(foot);
  }
  const torso = qmesh(new THREE.SphereGeometry(26, 28, 22), jacketMat);
  torso.scale.set(w, 1.05, d);
  torso.position.y = 52;
  g.add(torso);

  if (cfg.hat === 'melon') {
    const placket = qmesh(new THREE.BoxGeometry(2.2, 34, 2), toonMat(0x4a0d12, 0.9));
    placket.position.set(0, 52, 26 * d - 1);
    g.add(placket);
    for (let i = 0; i < 3; i++) {
      const btn = qmesh(new THREE.SphereGeometry(1.8, 10, 8), toonMat(0xd9a520, 0.5));
      btn.position.set(0, 42 + i * 10, 26 * d + 1);
      g.add(btn);
    }
    const collar = qmesh(new THREE.TorusGeometry(11, 2.6, 10, 24), toonMat(0x4a0d12, 0.9));
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 76;
    g.add(collar);
  } else {
    const sash = qmesh(new THREE.TorusGeometry(24 * w, 3, 10, 28), toonMat(0x4a4038, 0.95));
    sash.rotation.x = Math.PI / 2;
    sash.scale.set(1, d / w, 1);
    sash.position.y = 44;
    g.add(sash);
  }

  const armGeo = new THREE.CapsuleGeometry(6, 20, 6, 14);
  for (const s of [-1, 1]) {
    const arm = qmesh(armGeo, jacketMat);
    arm.position.set(27 * s * w, 62, 2);
    arm.rotation.z = s * 0.35;
    arm.rotation.x = -0.25;
    g.add(arm);
    const hand = qmesh(new THREE.SphereGeometry(7, 16, 12), skinMat);
    hand.position.set(33 * s * w, 44, 7);
    g.add(hand);
  }

  const headY = 104;
  const head = qmesh(new THREE.SphereGeometry(30, 32, 26), skinMat);
  head.scale.set(1.06, 0.98, 0.98);
  head.position.y = headY;
  g.add(head);
  for (const s of [-1, 1]) {
    const ear = qmesh(new THREE.SphereGeometry(5, 12, 10), skinMat);
    ear.scale.set(0.5, 1, 0.8);
    ear.position.set(30 * s, headY + 1, 0);
    g.add(ear);
  }
  const faceZ = 27.5;
  for (const s of [-1, 1]) {
    const eye = qmesh(new THREE.SphereGeometry(3.4, 12, 10), darkMat);
    eye.scale.set(1, 1.3, 0.5);
    eye.position.set(10.5 * s, headY + 4, faceZ);
    g.add(eye);
    const hl = qmesh(new THREE.SphereGeometry(1.1, 8, 6), toonMat(0xffffff, 0.3));
    hl.position.set(9.5 * s, headY + 5.5, faceZ + 1.6);
    g.add(hl);
  }
  for (const s of [-1, 1]) {
    const brow = qmesh(new THREE.BoxGeometry(8, 1.8, 1.6), darkMat);
    brow.position.set(10.5 * s, headY + 10, faceZ - 0.5);
    brow.rotation.z = cfg.smile ? s * -0.28 : s * -0.06;
    g.add(brow);
  }
  const nose = qmesh(new THREE.SphereGeometry(2.6, 10, 8), skinMat);
  nose.position.set(0, headY - 1, faceZ + 2.2);
  g.add(nose);
  if (cfg.smile) {
    const mouth = qmesh(new THREE.TorusGeometry(6, 1.3, 8, 20, Math.PI), darkMat);
    mouth.position.set(0, headY - 8, faceZ + 0.5);
    mouth.rotation.z = Math.PI;
    g.add(mouth);
  } else {
    const mouth = qmesh(new THREE.BoxGeometry(8, 1.6, 1.4), darkMat);
    mouth.position.set(0, headY - 8.5, faceZ + 0.5);
    g.add(mouth);
  }
  if (cfg.mustache) {
    for (const s of [-1, 1]) {
      const m = qmesh(new THREE.TorusGeometry(5.5, 1.5, 8, 16, Math.PI * 0.8), darkMat);
      m.position.set(6.5 * s, headY - 5, faceZ + 1);
      m.rotation.z = s > 0 ? Math.PI * 0.9 : Math.PI * 1.3;
      g.add(m);
    }
  }
  if (cfg.hat === 'melon') {
    const cap = qmesh(new THREE.SphereGeometry(31.5, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.45), toonMat(cfg.hatColor, 0.85));
    cap.scale.set(1, 0.72, 1);
    cap.position.y = headY + 8;
    g.add(cap);
    const brim = qmesh(new THREE.CylinderGeometry(32.5, 32.5, 3, 28), toonMat(cfg.hatColor, 0.85));
    brim.position.y = headY + 8.5;
    g.add(brim);
    const knot = qmesh(new THREE.SphereGeometry(3.5, 10, 8), toonMat(0xd93030, 0.6));
    knot.position.y = headY + 30;
    g.add(knot);
  } else {
    const wrap = qmesh(new THREE.SphereGeometry(32, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.52), toonMat(cfg.hatColor, 0.95));
    wrap.scale.set(1, 0.8, 1);
    wrap.position.y = headY + 7;
    g.add(wrap);
    const knotA = qmesh(new THREE.SphereGeometry(5, 10, 8), toonMat(cfg.hatColor, 0.95));
    knotA.position.set(28, headY + 14, -6);
    g.add(knotA);
    const knotB = qmesh(new THREE.SphereGeometry(4, 10, 8), toonMat(cfg.hatColor, 0.95));
    knotB.position.set(31, headY + 9, -8);
    g.add(knotB);
  }
  return g;
}

/* ---------- 桌子 ---------- */
function makeWoodTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#4a2c15'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    ctx.strokeStyle = `rgba(${20 + Math.random() * 40 | 0},${12 + Math.random() * 22 | 0},6,${0.12 + Math.random() * 0.15})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    const y = Math.random() * 512;
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6 + (Math.random() - 0.5) * 4);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const tableTopMat = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.6, metalness: 0 });
const tableSideMat = toonMat(0x2a1808, 0.8);
const table = new THREE.Mesh(new THREE.CylinderGeometry(330, 345, 16, 72), [tableSideMat, tableTopMat, tableSideMat]);
table.position.set(0, -8, -20);
table.receiveShadow = true;
scene.add(table);
const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(36, 52, 36, 32), tableSideMat);
tableLeg.position.set(0, -34, -20);
tableLeg.castShadow = true;
scene.add(tableLeg);

/* ---------- 人物 ---------- */
// 左：地主位
const charLeft = createChibi({
  skin: 0xf2c89a, jacket: 0xa02028, pants: 0x33302e, shoes: 0x1c1c1c,
  fat: true, smile: true, mustache: true, hat: 'melon', hatColor: 0x161616,
});
charLeft.position.set(-310, -50, -250);
charLeft.rotation.y = Math.atan2(310, 250);
charLeft.scale.setScalar(1.5);
scene.add(charLeft);

// 右：农民位
const charRight = createChibi({
  skin: 0xe8b98a, jacket: 0x5f7a8c, pants: 0x3d4a5c, shoes: 0x2a2a2a,
  fat: false, smile: false, mustache: false, hat: 'turban', hatColor: 0x9a9a94,
});
charRight.position.set(310, -50, -250);
charRight.rotation.y = Math.atan2(-310, 250);
charRight.scale.setScalar(1.5);
scene.add(charRight);

// 地主标记（头顶金色小牌）
function makeLandlordBadge() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffd166';
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = '#7a5c00';
  ctx.font = 'bold 44px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('地主', 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(38, 38, 1);
  return sp;
}
const badgeLeft = makeLandlordBadge();
badgeLeft.position.set(0, 175, 0);
badgeLeft.visible = false;
charLeft.add(badgeLeft);
const badgeRight = makeLandlordBadge();
badgeRight.position.set(0, 175, 0);
badgeRight.visible = false;
charRight.add(badgeRight);

/* =====================================================================
 * 第四部分：3D 牌局管理
 * ===================================================================== */
const handGroup = new THREE.Group();       // 我的手牌（挂在场景，不动）
scene.add(handGroup);
const botFanLeft = new THREE.Group();      // 左对手手牌扇
const botFanRight = new THREE.Group();
charLeft.add(botFanLeft);
charRight.add(botFanRight);
botFanLeft.position.set(0, 62, 55);
botFanLeft.rotation.y = Math.PI;
botFanRight.position.set(0, 62, 55);
botFanRight.rotation.y = Math.PI;

const tableCardsGroup = new THREE.Group();  // 桌面已出的牌
scene.add(tableCardsGroup);
const bottomGroup = new THREE.Group();       // 底牌
scene.add(bottomGroup);

// 我的手牌 mesh 列表（与 G.hands[0] 同步）
let myCardMeshes = [];
let botLeftMeshes = [];
let botRightMeshes = [];

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children[0];
    g.remove(c);
    c.traverse(o => {
      if (o.geometry && o.geometry !== cardGeo) o.geometry.dispose();
    });
  }
}

// 手牌布局
function handSlot(i, n) {
  const spacing = 15;
  const off = i - (n - 1) / 2;
  return {
    pos: new THREE.Vector3(off * spacing, 36, 245 + i * 0.2),
    rot: new THREE.Euler(-0.75, 0, 0),
  };
}

function layoutMyHand(animate = true) {
  const n = myCardMeshes.length;
  myCardMeshes.forEach((card, i) => {
    if (card.userData.flying) return;
    const s = handSlot(i, n);
    const targetY = card.userData.selected ? s.pos.y + 14 : s.pos.y;
    if (!animate) {
      card.position.copy(s.pos); card.rotation.copy(s.rot);
      card.position.y = targetY;
      return;
    }
    new TWEEN.Tween(card.position).to({ x: s.pos.x, y: targetY, z: s.pos.z }, 200)
      .easing(TWEEN.Easing.Quadratic.Out).start();
    new TWEEN.Tween(card.rotation).to({ x: s.rot.x, y: s.rot.y, z: s.rot.z }, 200)
      .easing(TWEEN.Easing.Quadratic.Out).start();
  });
}

function botSlot(i, n) {
  const spacing = 8.5;
  const off = i - (n - 1) / 2;
  return {
    pos: new THREE.Vector3(off * spacing, 0, i * 0.2),
    rot: new THREE.Euler(-0.5, 0, 0),
  };
}
function layoutBotFan(meshes) {
  const n = meshes.length;
  meshes.forEach((card, i) => {
    if (card.userData.flying) return;
    const s = botSlot(i, n);
    card.position.copy(s.pos);
    card.rotation.copy(s.rot);
  });
}

// 桌面落牌区
const ZONES = {
  me: { x: 0, z: 80, rowDir: -1, face: 0 },
  left: { x: -115, z: -85, rowDir: 1, face: Math.PI },
  right: { x: 115, z: -85, rowDir: 1, face: Math.PI },
};
function tableSlot(index, zone) {
  const zc = ZONES[zone];
  const perRow = 6;
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  return {
    pos: new THREE.Vector3(
      zc.x + (col - (perRow - 1) / 2) * 37,
      CARD_T / 2 + 0.05 + row * 0.2,
      zc.z + zc.rowDir * row * 62
    ),
    rot: new THREE.Euler(-Math.PI / 2, 0, zc.face),
  };
}

// 飞牌动画
function flyCard(card, from, to, rotTo, onDone) {
  card.userData.flying = true;
  const mid = from.clone().lerp(to, 0.5);
  mid.y = Math.max(from.y, to.y) + 60;
  const startRot = card.rotation.clone();
  const dur = 500;
  const t0 = performance.now();
  function step() {
    const t = Math.min((performance.now() - t0) / dur, 1);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    // 贝塞尔弧线
    const a = from.clone().lerp(mid, e);
    const b = mid.clone().lerp(to, e);
    card.position.copy(a.lerp(b, e));
    card.rotation.x = startRot.x + (rotTo.x - startRot.x) * e;
    card.rotation.y = startRot.y + (rotTo.y - startRot.y) * e + Math.PI * 2 * e; // 翻转一圈
    card.rotation.z = startRot.z + (rotTo.z - startRot.z) * e;
    if (t < 1) requestAnimationFrame(step);
    else {
      card.position.copy(to);
      card.rotation.copy(rotTo);
      card.userData.flying = false;
      if (onDone) onDone();
    }
  }
  step();
}

/* =====================================================================
 * 第五部分：牌局流程
 * ===================================================================== */
const statusEl = document.getElementById('status');
const infoEl = document.getElementById('info');
const actionsEl = document.getElementById('actions');

function setStatus(html) { statusEl.innerHTML = html; }
function setInfo() {
  let h = '';
  if (G.landlord >= 0) {
    h += `<span class="dz">地主：${seatLabel3(G.landlord)}</span><br>`;
    h += `你是：${G.landlord === 0 ? '<span class="dz">🎩地主</span>' : '🌾农民'}<br>`;
  } else {
    h += '叫地主阶段<br>';
  }
  h += `我的手牌：${G.hands[0].length} 张<br>`;
  h += `左边：${G.hands[1].length} 张<br>`;
  h += `右边：${G.hands[2].length} 张`;
  infoEl.innerHTML = h;
}

function setActions(buttons) {
  actionsEl.innerHTML = buttons.map(b =>
    `<button class="${b.cls || ''}" data-op="${b.op}" ${b.dis ? 'disabled' : ''}>${b.label}</button>`
  ).join('');
  actionsEl.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => onAction(btn.dataset.op);
  });
}

// 发牌
function deal() {
  const deck = buildDeck();
  G.hands = [[], [], []];
  for (let i = 0; i < 51; i++) G.hands[i % 3].push(deck.pop());
  G.bottom = deck;
  for (const h of G.hands) h.sort((a, b) => a.v - b.v || a.s - b.s);
  G.phase = 'bid';
  G.landlord = -1;
  G.bidStarter = Math.floor(Math.random() * 3);
  G.turn = G.bidStarter;
  G.bidCount = 0; G.maxBid = 0; G.maxBidSeat = -1; G.bids = {};
  G.last = null; G.lastSeat = -1; G.passCount = 0;
  G.over = false; G.winner = -1;
  G.selected.clear();
  addLog(`发牌完成，${seatLabel3(G.bidStarter)} 先叫`);
  renderAllCards();
  updateUI();
  if (G.turn !== 0) botTurn();   // 电脑先叫时自动推进
}

// 渲染所有牌
function renderAllCards() {
  // 我的手牌
  clearGroup(handGroup);
  myCardMeshes = G.hands[0].map(c => {
    const m = createCard(c.v, c.s);
    m.userData.id = c.id;
    handGroup.add(m);
    return m;
  });
  layoutMyHand(false);
  // 对手手牌（只显示背面）
  clearGroup(botFanLeft);
  botLeftMeshes = G.hands[1].map(c => {
    const m = createCard(c.v, c.s);
    m.userData.id = c.id;
    botFanLeft.add(m);
    return m;
  });
  layoutBotFan(botLeftMeshes);
  clearGroup(botFanRight);
  botRightMeshes = G.hands[2].map(c => {
    const m = createCard(c.v, c.s);
    m.userData.id = c.id;
    botFanRight.add(m);
    return m;
  });
  layoutBotFan(botRightMeshes);
  // 桌面
  clearGroup(tableCardsGroup);
  clearGroup(bottomGroup);
}

// 同步手牌（出牌后）
function syncHand(seat) {
  if (seat === 0) {
    // 移除已不在手牌中的 mesh
    const ids = new Set(G.hands[0].map(c => c.id));
    myCardMeshes = myCardMeshes.filter(m => {
      if (!ids.has(m.userData.id)) { handGroup.remove(m); return false; }
      return true;
    });
    layoutMyHand(true);
  } else if (seat === 1) {
    const ids = new Set(G.hands[1].map(c => c.id));
    botLeftMeshes = botLeftMeshes.filter(m => {
      if (!ids.has(m.userData.id)) { botFanLeft.remove(m); return false; }
      return true;
    });
    layoutBotFan(botLeftMeshes);
  } else {
    const ids = new Set(G.hands[2].map(c => c.id));
    botRightMeshes = botRightMeshes.filter(m => {
      if (!ids.has(m.userData.id)) { botFanRight.remove(m); return false; }
      return true;
    });
    layoutBotFan(botRightMeshes);
  }
}

// 把牌打到桌面
function playToTable(seat, cards) {
  const zone = seat === 0 ? 'me' : seat === 1 ? 'left' : 'right';
  cards.forEach((c, i) => {
    const mesh = createCard(c.v, c.s);
    mesh.userData.id = c.id;
    tableCardsGroup.add(mesh);
    const idx = tableCardsGroup.children.length - 1;
    const slot = tableSlot(idx, zone);
    // 起始位置
    let from;
    if (seat === 0) from = new THREE.Vector3(0, 50, 245);
    else if (seat === 1) {
      from = new THREE.Vector3();
      charLeft.getWorldPosition(from);
      from.y += 90;
    } else {
      from = new THREE.Vector3();
      charRight.getWorldPosition(from);
      from.y += 90;
    }
    mesh.position.copy(from);
    mesh.rotation.set(0, 0, 0);
    flyCard(mesh, from, slot.pos, slot.rot);
  });
}

// 亮底牌
function showBottom() {
  clearGroup(bottomGroup);
  G.bottom.forEach((c, i) => {
    const m = createCard(c.v, c.s);
    m.position.set((i - 1) * 45, 60, -140);
    m.rotation.set(-Math.PI / 2, 0, 0);
    bottomGroup.add(m);
    // 翻牌动画
    m.rotation.y = Math.PI;
    new TWEEN.Tween(m.rotation).to({ y: 0 }, 600).easing(TWEEN.Easing.Quadratic.Out).start();
  });
}

/* ---------- 叫地主 ---------- */
function doBid(seat, score) {
  G.bids[seat] = score;
  G.bidCount++;
  addLog(`${seatLabel3(seat)} ${score === 0 ? '不叫' : `叫 ${score} 分`}`);
  if (score > G.maxBid) { G.maxBid = score; G.maxBidSeat = seat; }
  if (score === 3 || G.bidCount >= 3) {
    if (G.maxBidSeat < 0) {
      addLog('三家都不叫，重新发牌');
      setStatus('三家都不叫，重新发牌…');
      setTimeout(deal, 1500);
      updateUI();
      return;
    }
    G.landlord = G.maxBidSeat;
    G.hands[G.landlord].push(...G.bottom);
    G.hands[G.landlord].sort((a, b) => a.v - b.v || a.s - b.s);
    G.phase = 'play';
    G.turn = G.landlord;
    addLog(`${seatLabel3(G.landlord)} 以 ${G.maxBid} 分成为地主`);
    // 地主标记
    badgeLeft.visible = G.landlord === 1;
    badgeRight.visible = G.landlord === 2;
    showBottom();
    renderAllCards();
    showBottom();
    updateUI();
    if (G.turn !== 0) botTurn();
    return;
  }
  G.turn = (G.turn + 1) % 3;
  updateUI();
  if (G.turn !== 0) botTurn();
}

function botBid(seat) {
  const h = G.hands[seat];
  const cnt = countVals(h);
  let power = 0;
  for (const c of h) {
    if (c.v >= 16) power += 2.5;
    else if (c.v === 15) power += 1.5;
    else if (c.v === 14) power += 0.8;
  }
  for (const v in cnt) if (cnt[v] === 4) power += 4;
  let score = power >= 8 ? 3 : power >= 6 ? 2 : power >= 4.5 ? 1 : 0;
  if (score <= G.maxBid) score = 0;
  setTimeout(() => doBid(seat, score), 800 + Math.random() * 800);
}

/* ---------- 出牌 ---------- */
function doPlay(seat, cards) {
  // 从手牌移除
  const ids = new Set(cards.map(c => c.id));
  G.hands[seat] = G.hands[seat].filter(c => !ids.has(c.id));
  const pat = analyze(cards);
  G.last = pat;
  G.lastSeat = seat;
  G.passCount = 0;
  addLog(`${seatLabel3(seat)} 出 ${TYPE_NAME[pat.type]}${cards.length > 1 ? '×' + cards.length : ''}`);
  playToTable(seat, cards);
  syncHand(seat);
  // 胜利判定
  if (G.hands[seat].length === 0) {
    G.over = true;
    G.winner = seat;
    showOver();
    updateUI();
    return;
  }
  G.turn = (G.turn + 1) % 3;
  G.turnStart = Date.now();
  updateUI();
  if (G.turn !== 0) botTurn();
}

function doPass(seat) {
  G.passCount++;
  addLog(`${seatLabel3(seat)} 不出`);
  if (G.passCount >= 2) {
    G.last = null;
    G.passCount = 0;
    addLog('一轮结束');
  }
  G.turn = (G.turn + 1) % 3;
  G.turnStart = Date.now();
  updateUI();
  if (G.turn !== 0) botTurn();
}

// 电脑出牌
function botTurn() {
  if (G.over) return;
  const seat = G.turn;
  const h = G.hands[seat];
  const delay = 900 + Math.random() * 900;
  if (G.phase === 'bid') { botBid(seat); return; }
  setTimeout(() => {
    if (G.over) return;
    const mustLead = !G.last || G.lastSeat === seat;
    if (mustLead) {
      doPlay(seat, botLead(h));
    } else {
      const beat = findBeat(h, G.last);
      if (beat) doPlay(seat, beat);
      else doPass(seat);
    }
  }, delay);
}

/* ---------- 我的操作 ---------- */
function onAction(op) {
  if (G.over) return;
  if (G.turn !== 0) return;
  if (G.phase === 'bid') {
    const score = parseInt(op.replace('bid:', ''));
    doBid(0, score);
    return;
  }
  if (op === 'pass') {
    if (!G.last || G.lastSeat === 0) return; // 必须领出
    doPass(0);
    return;
  }
  if (op === 'play') {
    const cards = G.hands[0].filter(c => G.selected.has(c.id));
    if (!cards.length) return;
    const pat = analyze(cards);
    if (!pat) { toast('不符合任何牌型，请重新选择'); return; }
    if (G.last && G.lastSeat !== 0 && !canBeat(pat, G.last)) {
      const need = TYPE_NAME[G.last.type] || '';
      toast(pat.type === G.last.type ? `点数要大于上家的${need}` : `请打出对应的牌型（${need}），或出炸弹/王炸`);
      return;
    }
    G.selected.clear();
    doPlay(0, cards);
  }
}

// 点击选手牌
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
renderer.domElement.addEventListener('pointerdown', e => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downPos) return;
  const dx = e.clientX - downPos[0], dy = e.clientY - downPos[1];
  downPos = null;
  if (dx * dx + dy * dy > 36) return; // 拖拽不触发
  if (G.over || G.phase !== 'play' || G.turn !== 0) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(handGroup.children, true);
  if (!hits.length) return;
  let obj = hits[0].object;
  while (obj && obj.parent !== handGroup) obj = obj.parent;
  if (!obj) return;
  const id = obj.userData.id;
  if (G.selected.has(id)) G.selected.delete(id);
  else G.selected.add(id);
  obj.userData.selected = G.selected.has(id);
  layoutMyHand(true);
  updateUI();
});

/* ---------- UI ---------- */
function updateUI() {
  setInfo();
  if (G.over) {
    setStatus('游戏结束');
    setActions([]);
    return;
  }
  if (G.phase === 'bid') {
    const bidTxt = [0, 1, 2].map(i => {
      const b = G.bids[i];
      return `${seatLabel3(i)}：${b === undefined ? '…' : b === 0 ? '不叫' : b + '分'}`;
    }).join('　');
    setStatus(`📢 叫地主　${bidTxt}${G.turn === 0 ? '　<b>轮到你</b>' : ''}`);
    if (G.turn === 0) {
      setActions([
        { op: 'bid:0', label: '不叫' },
        { op: 'bid:1', label: '1分', cls: 'primary', dis: G.maxBid >= 1 },
        { op: 'bid:2', label: '2分', cls: 'primary', dis: G.maxBid >= 2 },
        { op: 'bid:3', label: '3分', cls: 'primary', dis: G.maxBid >= 3 },
      ]);
    } else setActions([]);
    return;
  }
  // 出牌阶段
  const mustLead = !G.last || G.lastSeat === 0;
  if (G.turn === 0) {
    setStatus(`轮到你出牌　<span id="clock">${G.turnTimeout}</span>`);
    setActions([
      { op: 'play', label: `出牌（已选${G.selected.size}张）`, cls: 'primary', dis: G.selected.size === 0 },
      { op: 'pass', label: '不出', dis: mustLead },
    ]);
    G.turnStart = Date.now();
  } else {
    setStatus(`等待 ${seatLabel3(G.turn)} 出牌…`);
    setActions([]);
  }
}

function toast(msg) {
  setStatus(`<b style="color:#ff8a8a">${msg}</b>`);
  setTimeout(() => { if (!G.over) updateUI(); }, 1800);
}

function showOver() {
  const mask = document.getElementById('overMask');
  const title = document.getElementById('overTitle');
  const desc = document.getElementById('overDesc');
  const iWin = G.winner === 0;
  const isLandlordWin = G.winner === G.landlord;
  title.textContent = isLandlordWin ? '🎩 地主胜利！' : '🌾 农民胜利！';
  desc.textContent = iWin ? '恭喜你赢了！' : `${seatLabel3(G.winner)} 先出完了牌`;
  mask.style.display = 'flex';
}

/* ---------- 倒计时 ---------- */
setInterval(() => {
  if (G.over || G.turn !== 0 || G.phase !== 'play') return;
  const el = document.getElementById('clock');
  if (!el) return;
  const left = Math.max(0, G.turnTimeout - Math.floor((Date.now() - G.turnStart) / 1000));
  el.textContent = left;
  el.className = left <= 5 ? 'warn' : '';
  if (left <= 0) {
    // 超时自动
    if (!G.last || G.lastSeat === 0) doPlay(0, [G.hands[0][0]]);
    else doPass(0);
  }
}, 500);

/* ---------- 渲染循环 ---------- */
function animate() {
  requestAnimationFrame(animate);
  TWEEN.update();
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ---------- 启动 ---------- */
setStatus('正在发牌…');
setTimeout(deal, 600);
