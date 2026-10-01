// 麻将（简化国标）：136 张，吃碰杠胡，自摸/点炮
const { shuffle, addLog } = require('./util');

const T_NAME = [];
for (let i = 0; i < 9; i++) T_NAME[i] = (i + 1) + '万';
for (let i = 9; i < 18; i++) T_NAME[i] = (i - 8) + '条';
for (let i = 18; i < 27; i++) T_NAME[i] = (i - 17) + '筒';
T_NAME[27] = '东'; T_NAME[28] = '南'; T_NAME[29] = '西'; T_NAME[30] = '北';
T_NAME[31] = '中'; T_NAME[32] = '发'; T_NAME[33] = '白';

function buildWall() {
  const w = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) w.push(t);
  return shuffle(w);
}

function toCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

// 标准胡牌判定：3n+2
function canHu(counts) {
  const c = counts.slice();
  for (let i = 0; i < 34; i++) {
    if (c[i] >= 2) {
      c[i] -= 2;
      if (decompose(c)) { c[i] += 2; return true; }
      c[i] += 2;
    }
  }
  return false;
}

function decompose(c) {
  let i = 0;
  while (i < 34 && c[i] === 0) i++;
  if (i === 34) return true;
  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3;
    if (decompose(c)) { c[i] += 3; return true; }
    c[i] += 3;
  }
  // 顺子（仅万条筒）
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    if (decompose(c)) { c[i]++; c[i + 1]++; c[i + 2]++; return true; }
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return false;
}

function huOptions(handTiles) {
  // 返回手牌+1 张可胡的所有牌
  const res = [];
  const c = toCounts(handTiles);
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (canHu(c)) res.push(t);
    c[t]--;
  }
  return res;
}

function chiOptions(handTiles, tile) {
  // 返回可吃的组合 [a,b]（手牌中的两张）
  if (tile >= 27) return [];
  const n = tile % 9;
  const res = [];
  const has = t => handTiles.includes(t);
  const base = tile - n;
  if (n >= 2 && has(tile - 2) && has(tile - 1)) res.push([tile - 2, tile - 1]);
  if (n >= 1 && n <= 7 && has(tile - 1) && has(tile + 1)) res.push([tile - 1, tile + 1]);
  if (n <= 6 && has(tile + 1) && has(tile + 2)) res.push([tile + 1, tile + 2]);
  return res;
}

function drawTile(state, seat) {
  if (!state.wall.length) {
    state.over = true; state.winner = -2; // 流局
    addLog(state, '牌墙摸完，流局');
    return null;
  }
  const t = state.wall.pop();
  state.hands[seat].push(t);
  return t;
}

function sortHand(state, seat) {
  state.hands[seat].sort((a, b) => a - b);
}

function nextTurn(state) {
  state.turn = (state.turn + 1) % 4;
  state.phase = 'draw';
}

module.exports = {
  maxPlayers: 4,
  T_NAME,

  init(players) {
    const state = {
      wall: buildWall(),
      hands: [[], [], [], []],
      melds: [[], [], [], []], // {type:'chi'|'peng'|'gang'|'angang', tiles:[]}
      discards: [[], [], [], []],
      turn: 0, dealer: 0, phase: 'draw',
      claim: null, // {tile, from, asks:{seat:{hu,gang,peng,chi}}, responses:{seat:action}}
      winner: -1, over: false, log: [],
    };
    for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) state.hands[s].push(state.wall.pop());
    for (let s = 0; s < 4; s++) sortHand(state, s);
    addLog(state, '游戏开始，玩家1 为庄家');
    return state;
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';

    // 认领阶段：收集所有响应，按 胡>杠>碰>吃 优先级裁决
    if (state.claim) {
      const cl = state.claim;
      const my = cl.asks[seat];
      if (!my) return '等待其他玩家响应';
      const valid =
        (a.op === 'pass') ||
        (a.op === 'hu' && my.hu) ||
        (a.op === 'gang' && my.gang) ||
        (a.op === 'peng' && my.peng) ||
        (a.op === 'chi' && my.chi && Array.isArray(a.combo) &&
          my.chi.some(cb => cb[0] === a.combo[0] && cb[1] === a.combo[1]));
      if (!valid) return '无效操作';
      cl.responses[seat] = a;
      if (a.op === 'pass') addLog(state, `玩家${seat + 1} 过`);
      // 还有人没响应，继续等
      if (Object.keys(cl.responses).length < Object.keys(cl.asks).length) return null;

      // 全部响应完毕，裁决
      const PR = { hu: 4, gang: 3, peng: 2, chi: 1 };
      let best = null;
      for (const [s, r] of Object.entries(cl.responses)) {
        if (r.op === 'pass') continue;
        if (!best || PR[r.op] > PR[best.r.op]) best = { seat: +s, r };
      }
      const tile = cl.tile, from = cl.from;
      if (!best) {
        state.discards[from].push(tile);
        state.claim = null;
        nextTurn(state);
        return null;
      }
      const s = best.seat, r = best.r;
      if (r.op === 'hu') return this._win(state, s, tile, '点炮');
      const h = state.hands[s];
      if (r.op === 'gang') {
        for (let i = 0; i < 3; i++) h.splice(h.indexOf(tile), 1);
        state.melds[s].push({ type: 'gang', tiles: [tile, tile, tile, tile] });
        addLog(state, `玩家${s + 1} 杠 ${T_NAME[tile]}`);
        state.claim = null; state.turn = s;
        drawTile(state, s); sortHand(state, s);
        state.phase = 'play';
        return null;
      }
      if (r.op === 'peng') {
        h.splice(h.indexOf(tile), 1); h.splice(h.indexOf(tile), 1);
        state.melds[s].push({ type: 'peng', tiles: [tile, tile, tile] });
        addLog(state, `玩家${s + 1} 碰 ${T_NAME[tile]}`);
        state.claim = null; state.turn = s; state.phase = 'play';
        return null;
      }
      // chi
      const [x, y] = r.combo;
      h.splice(h.indexOf(x), 1); h.splice(h.indexOf(y), 1);
      state.melds[s].push({ type: 'chi', tiles: [x, y, tile].sort((p, q) => p - q) });
      addLog(state, `玩家${s + 1} 吃 ${T_NAME[tile]}`);
      state.claim = null; state.turn = s; state.phase = 'play';
      return null;
    }

    if (seat !== state.turn) return '还没轮到你';

    if (a.op === 'draw') {
      if (state.phase !== 'draw') return '你现在不能摸牌';
      const t = drawTile(state, seat);
      if (t === null) return null;
      sortHand(state, seat);
      state.phase = 'play';
      addLog(state, `玩家${seat + 1} 摸了1张牌`);
      return null;
    }

    if (a.op === 'hu') {
      if (state.phase !== 'play') return '无效操作';
      const c = toCounts(state.hands[seat]);
      if (!canHu(c)) return '还不能胡';
      return this._win(state, seat, null, '自摸');
    }

    if (a.op === 'angang') {
      if (state.phase !== 'play') return '无效操作';
      const h = state.hands[seat];
      const c = toCounts(h);
      if (c[a.tile] !== 4) return '没有暗杠';
      for (let i = 0; i < 4; i++) h.splice(h.indexOf(a.tile), 1);
      state.melds[seat].push({ type: 'angang', tiles: [a.tile, a.tile, a.tile, a.tile] });
      addLog(state, `玩家${seat + 1} 暗杠 ${T_NAME[a.tile]}`);
      drawTile(state, seat); sortHand(state, seat);
      return null;
    }

    if (a.op === 'discard') {
      if (state.phase !== 'play') return '请先摸牌';
      const h = state.hands[seat];
      const idx = h.indexOf(a.tile);
      if (idx < 0) return '没有这张牌';
      h.splice(idx, 1);
      addLog(state, `玩家${seat + 1} 打出 ${T_NAME[a.tile]}`);

      // 检查其他玩家认领
      const asks = {};
      for (let s = 0; s < 4; s++) {
        if (s === seat) continue;
        const hh = state.hands[s];
        const cc = toCounts(hh);
        cc[a.tile]++;
        const hu = canHu(cc);
        cc[a.tile]--;
        const gang = cc[a.tile] === 3;
        const peng = cc[a.tile] >= 2;
        const chi = s === (seat + 1) % 4 ? chiOptions(hh, a.tile) : [];
        if (hu || gang || peng || chi.length) asks[s] = { hu, gang, peng, chi };
      }
      if (Object.keys(asks).length) {
        state.claim = { tile: a.tile, from: seat, asks, responses: {} };
      } else {
        state.discards[seat].push(a.tile);
        nextTurn(state);
      }
      return null;
    }
    return '未知操作';
  },

  _win(state, seat, tile, how) {
    if (tile !== null) state.hands[seat].push(tile);
    sortHand(state, seat);
    state.over = true; state.winner = seat; state.claim = null;
    addLog(state, `玩家${seat + 1} ${how}胡牌！`);
    return null;
  },

  view(state, seat) {
    // 已响应过的玩家不再看到认领按钮（等待其他人裁决）
    const my = state.claim && state.claim.responses[seat] === undefined ? state.claim.asks[seat] : null;
    const canSelfHu = state.phase === 'play' && state.turn === seat && canHu(toCounts(state.hands[seat]));
    const c = toCounts(state.hands[seat]);
    const angangs = state.phase === 'play' && state.turn === seat
      ? Object.keys(c).filter(t => c[t] === 4).map(Number) : [];
    return {
      turn: state.turn, phase: state.phase, dealer: state.dealer,
      hand: state.hands[seat],
      melds: state.melds,
      discards: state.discards,
      counts: state.hands.map(h => h.length),
      wallCount: state.wall.length,
      claim: state.claim ? { tile: state.claim.tile, from: state.claim.from, my } : null,
      canSelfHu, angangs,
      winner: state.winner, over: state.over, log: state.log,
    };
  },

  // 电脑策略
  bot(state, seat) {
    // 认领阶段：胡 > 杠 > 碰(70%) > 吃(50%)，否则过
    if (state.claim) {
      const my = state.claim.asks[seat];
      if (!my) return null;
      if (my.hu) return { op: 'hu' };
      if (my.gang) return { op: 'gang' };
      if (my.peng && Math.random() < 0.7) return { op: 'peng' };
      if (my.chi && my.chi.length && Math.random() < 0.5) return { op: 'chi', combo: my.chi[0] };
      return { op: 'pass' };
    }
    if (state.phase === 'draw') return { op: 'draw' };
    // play
    if (canHu(toCounts(state.hands[seat]))) return { op: 'hu' };
    const c = toCounts(state.hands[seat]);
    let gangTile = -1;
    for (let t = 0; t < 34; t++) if (c[t] === 4) { gangTile = t; break; }
    if (gangTile >= 0) return { op: 'angang', tile: gangTile };
    // 打出最没用的牌：字牌孤张 > 数牌孤张（靠边加分），并列随机
    const hand = state.hands[seat];
    let best = [], bestScore = -Infinity;
    for (const t of hand) {
      let score = 0;
      if (c[t] === 1) score += 10;
      if (t >= 27) score += 20;
      else {
        const n = t % 9;
        if (n === 0 || n === 8) score += 3;
        const has = x => c[x] > 0;
        const near = (n > 0 && has(t - 1)) || (n < 8 && has(t + 1));
        if (!near) score += 6;
      }
      if (score > bestScore) { bestScore = score; best = [t]; }
      else if (score === bestScore) best.push(t);
    }
    return { op: 'discard', tile: best[Math.floor(Math.random() * best.length)] };
  },
};
