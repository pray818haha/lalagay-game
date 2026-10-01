// UNO：颜色/数字出牌规则，含 skip/reverse/+2/变色/+4
const { shuffle, addLog } = require('./util');

const COLORS = ['R', 'Y', 'G', 'B'];
const COLOR_NAME = { R: '红', Y: '黄', G: '绿', B: '蓝', W: '黑' };

function buildDeck() {
  const d = [];
  let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (let k = 0; k < 2; k++) {
      for (let n = 1; n <= 9; n++) d.push({ id: id++, c, v: String(n) });
      for (const v of ['S', 'V', 'D2']) d.push({ id: id++, c, v });
    }
  }
  for (let k = 0; k < 4; k++) {
    d.push({ id: id++, c: 'W', v: 'W' });
    d.push({ id: id++, c: 'W', v: 'W4' });
  }
  return shuffle(d);
}

function drawCards(state, seat, n) {
  for (let i = 0; i < n; i++) {
    if (!state.deck.length) {
      const top = state.disc.pop();
      state.deck = shuffle(state.disc);
      state.disc = [top];
    }
    if (!state.deck.length) return;
    state.hands[seat].push(state.deck.pop());
  }
}

function nextSeat(state, n) {
  const cnt = state.hands.length;
  return (state.turn + state.dir * n + cnt * n) % cnt;
}

function canPlay(state, card) {
  const top = state.disc[state.disc.length - 1];
  return card.c === 'W' || card.c === state.color || card.v === top.v;
}

module.exports = {
  maxPlayers: 4,

  init(players) {
    const deck = buildDeck();
    const hands = players.map(() => []);
    const state = {
      deck, hands, disc: [], turn: 0, dir: 1, color: null,
      winner: -1, over: false, log: [],
      needColor: false, // 出完变色牌后需要选颜色
    };
    for (let r = 0; r < 7; r++) for (let s = 0; s < players.length; s++) drawCards(state, s, 1);
    // 翻首张（非功能牌）
    let first = deck.pop();
    while (first.c === 'W' || isNaN(first.v)) { deck.unshift(first); first = deck.pop(); }
    state.disc = [first];
    state.color = first.c;
    addLog(state, '游戏开始，首张牌：' + COLOR_NAME[first.c] + first.v);
    return state;
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';
    if (seat !== state.turn) return '还没轮到你';

    if (a.op === 'play') {
      const card = state.hands[seat][a.idx];
      if (!card) return '没有这张牌';
      if (state.needColor) return '请先选择颜色';
      if (!canPlay(state, card)) return '这张牌不能出（需匹配颜色或数字）';
      if (card.v === 'W4') {
        // 简化：不校验“无同色才能出+4”的规则（后续可迭代）
      }
      state.hands[seat].splice(a.idx, 1);
      state.disc.push(card);
      addLog(state, `玩家${seat + 1} 出了 ${COLOR_NAME[card.c]}${card.v}`);

      if (card.c === 'W') {
        if (!a.color || !COLORS.includes(a.color)) { state.needColor = true; state.pendingWild = card; return null; }
        state.color = a.color;
      } else {
        state.color = card.c;
      }

      if (state.hands[seat].length === 0) {
        state.over = true; state.winner = seat;
        addLog(state, `玩家${seat + 1} 出完所有牌，获胜！`);
        return null;
      }

      const v = card.v;
      if (v === 'S') { state.turn = nextSeat(state, 2); }
      else if (v === 'V') { state.dir *= -1; state.turn = nextSeat(state, 1); addLog(state, '方向反转'); }
      else if (v === 'D2') { const t = nextSeat(state, 1); drawCards(state, t, 2); addLog(state, `玩家${t + 1} 被罚摸2张并跳过`); state.turn = nextSeat(state, 2); }
      else if (v === 'W4') { const t = nextSeat(state, 1); drawCards(state, t, 4); addLog(state, `玩家${t + 1} 被罚摸4张并跳过`); state.turn = nextSeat(state, 2); }
      else state.turn = nextSeat(state, 1);
      return null;
    }

    if (a.op === 'color') {
      if (!state.needColor) return '现在不需要选颜色';
      if (!COLORS.includes(a.color)) return '颜色无效';
      state.color = a.color;
      state.needColor = false;
      addLog(state, `玩家${seat + 1} 指定颜色：${COLOR_NAME[a.color]}`);
      const card = state.pendingWild;
      if (card.v === 'W4') { const t = nextSeat(state, 1); drawCards(state, t, 4); addLog(state, `玩家${t + 1} 被罚摸4张并跳过`); state.turn = nextSeat(state, 2); }
      else state.turn = nextSeat(state, 1);
      if (state.hands[seat].length === 0) { state.over = true; state.winner = seat; addLog(state, `玩家${seat + 1} 出完所有牌，获胜！`); }
      return null;
    }

    if (a.op === 'draw') {
      if (state.needColor) return '请先选择颜色';
      drawCards(state, seat, 1);
      addLog(state, `玩家${seat + 1} 摸了1张牌`);
      state.turn = nextSeat(state, 1);
      return null;
    }
    return '未知操作';
  },

  view(state, seat) {
    return {
      turn: state.turn, dir: state.dir, color: state.color,
      top: state.disc[state.disc.length - 1],
      recent: state.disc.slice(-7), // 最近弃牌，桌面摊开显示
      discCount: state.disc.length, deckCount: state.deck.length,
      hand: state.hands[seat],
      counts: state.hands.map(h => h.length),
      needColor: state.needColor && seat === state.turn,
      winner: state.winner, over: state.over, log: state.log,
    };
  },

  // 电脑策略：优先出匹配的普通牌，万能牌留到最后
  bot(state, seat) {
    if (state.needColor) {
      const cnt = { R: 0, Y: 0, G: 0, B: 0 };
      for (const c of state.hands[seat]) if (cnt[c.c] !== undefined) cnt[c.c]++;
      let color = 'R', best = -1;
      for (const k of COLORS) if (cnt[k] > best) { best = cnt[k]; color = k; }
      return { op: 'color', color };
    }
    const top = state.disc[state.disc.length - 1];
    let wild = -1;
    for (let i = 0; i < state.hands[seat].length; i++) {
      const c = state.hands[seat][i];
      if (c.c === 'W') { if (wild < 0) wild = i; continue; }
      if (c.c === state.color || c.v === top.v) return { op: 'play', idx: i };
    }
    if (wild >= 0) {
      const cnt = { R: 0, Y: 0, G: 0, B: 0 };
      for (const c of state.hands[seat]) if (cnt[c.c] !== undefined) cnt[c.c]++;
      let color = 'R', best = -1;
      for (const k of COLORS) if (cnt[k] > best) { best = cnt[k]; color = k; }
      return { op: 'play', idx: wild, color };
    }
    return { op: 'draw' };
  },
};
