// 三国杀（极简版）：杀 / 闪 / 桃，4 血，回合内限一张杀，濒死自动用桃
const { shuffle, addLog } = require('./util');

function buildDeck() {
  const d = [];
  let id = 0;
  for (let i = 0; i < 44; i++) d.push({ id: id++, k: 'sha' });
  for (let i = 0; i < 24; i++) d.push({ id: id++, k: 'shan' });
  for (let i = 0; i < 8; i++) d.push({ id: id++, k: 'tao' }); // 桃为一次性资源，使用后移出游戏
  return shuffle(d);
}

function draw(state, seat, n) {
  for (let i = 0; i < n; i++) {
    if (!state.deck.length) state.deck = shuffle(state.disc.splice(0));
    if (!state.deck.length) return;
    state.hands[seat].push(state.deck.pop());
  }
}

function alivePlayers(state) {
  return state.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);
}

function damage(state, seat, n) {
  const p = state.players[seat];
  p.hp -= n;
  addLog(state, `玩家${seat + 1} 受到 ${n} 点伤害，剩 ${p.hp} 血`);
  // 濒死自动用桃（简化，后续可迭代为依次询问所有玩家出桃）
  while (p.hp <= 0) {
    const idx = state.hands[seat].findIndex(c => c.k === 'tao');
    if (idx < 0) break;
    const c = state.hands[seat].splice(idx, 1)[0];
    p.hp++;
    addLog(state, `玩家${seat + 1} 濒死自动使用【桃】，回复至 ${p.hp} 血`);
  }
  if (p.hp <= 0) {
    p.alive = false;
    // 弃置手牌：桃直接移出游戏，杀/闪回弃牌堆
    for (const c of state.hands[seat]) if (c.k !== 'tao') state.disc.push(c);
    state.hands[seat] = [];
    addLog(state, `玩家${seat + 1} 阵亡`);
  }
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    state.over = true; state.winner = alive[0];
    addLog(state, `玩家${alive[0] + 1} 成为最后的幸存者，获胜！`);
  }
}

function nextTurn(state) {
  const n = state.players.length;
  do { state.turn = (state.turn + 1) % n; } while (!state.players[state.turn].alive);
  state.usedSha = false;
  draw(state, state.turn, 2);
  addLog(state, `—— 玩家${state.turn + 1} 的回合（摸2张）——`);
}

module.exports = {
  maxPlayers: 4,

  init(players) {
    const state = {
      deck: buildDeck(), disc: [],
      players: players.map(() => ({ hp: 4, alive: true })),
      hands: players.map(() => []),
      turn: 0, usedSha: false,
      pending: null, // {kind:'sha', from, to}
      winner: -1, over: false, log: [],
    };
    for (let r = 0; r < 4; r++) for (let s = 0; s < players.length; s++) draw(state, s, 1);
    draw(state, 0, 2);
    addLog(state, '游戏开始，玩家1 先手');
    return state;
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';

    // 响应闪
    if (state.pending) {
      const pd = state.pending;
      if (seat !== pd.to) return '等待被攻击的玩家响应';
      if (a.op === 'shan') {
        const idx = state.hands[seat].findIndex(c => c.k === 'shan');
        if (idx < 0) return '你没有【闪】';
        state.disc.push(state.hands[seat].splice(idx, 1)[0]);
        addLog(state, `玩家${seat + 1} 打出【闪】，躲避了杀`);
        state.pending = null;
        return null;
      }
      if (a.op === 'hurt') {
        state.pending = null;
        damage(state, seat, 1);
        return null;
      }
      return '请响应【杀】';
    }

    if (seat !== state.turn) return '还没轮到你';

    if (a.op === 'sha') {
      if (state.usedSha) return '本回合已出过【杀】';
      const idx = state.hands[seat].findIndex(c => c.k === 'sha');
      if (idx < 0) return '你没有【杀】';
      const to = a.to;
      if (to === seat || to < 0 || to >= state.players.length || !state.players[to].alive) return '目标无效';
      state.disc.push(state.hands[seat].splice(idx, 1)[0]);
      state.usedSha = true;
      state.pending = { kind: 'sha', from: seat, to };
      addLog(state, `玩家${seat + 1} 对 玩家${to + 1} 使用【杀】`);
      return null;
    }

    if (a.op === 'tao') {
      const p = state.players[seat];
      if (p.hp >= 4) return '体力已满';
      const idx = state.hands[seat].findIndex(c => c.k === 'tao');
      if (idx < 0) return '你没有【桃】';
      state.hands[seat].splice(idx, 1); // 桃使用后移出游戏
      p.hp++;
      addLog(state, `玩家${seat + 1} 使用【桃】，回复至 ${p.hp} 血`);
      return null;
    }

    if (a.op === 'end') {
      // 弃牌至体力值（桃直接移出游戏，其余进弃牌堆）
      const p = state.players[seat];
      while (state.hands[seat].length > p.hp) {
        const c = state.hands[seat].pop();
        if (c.k !== 'tao') state.disc.push(c);
      }
      nextTurn(state);
      return null;
    }
    return '未知操作';
  },

  view(state, seat) {
    return {
      turn: state.turn, usedSha: state.usedSha,
      players: state.players.map(p => ({ hp: p.hp, alive: p.alive })),
      counts: state.hands.map(h => h.length),
      hand: state.hands[seat],
      deckCount: state.deck.length,
      pending: state.pending,
      needResponse: !!(state.pending && state.pending.to === seat),
      winner: state.winner, over: state.over, log: state.log,
    };
  },

  // 电脑策略：被杀优先闪；回合内残血吃桃、有杀就杀、否则结束
  bot(state, seat) {
    if (state.pending) {
      if (state.pending.to !== seat) return null;
      return state.hands[seat].some(c => c.k === 'shan') ? { op: 'shan' } : { op: 'hurt' };
    }
    const p = state.players[seat];
    if (p.hp <= 2 && state.hands[seat].some(c => c.k === 'tao')) return { op: 'tao' };
    if (!state.usedSha && state.hands[seat].some(c => c.k === 'sha')) {
      const targets = state.players.map((x, i) => (x.alive && i !== seat ? i : -1)).filter(i => i >= 0);
      if (targets.length) return { op: 'sha', to: targets[Math.floor(Math.random() * targets.length)] };
    }
    return { op: 'end' };
  },
};
