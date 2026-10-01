// 掼蛋（四人联机完整版）：2副牌108张，4人两两组队（0&2 vs 1&3），从2升到A通关
// 核心：逢人配（级牌百搭）、进贡/退贡/抗贡、双下、升级规则
// 牌型：单张/对子/三带二/钢板(2组三张)/木板(3组连对)/顺子(5张)/同花顺(5张同花)/炸弹(4~8张)/天王炸(4王)
// 牌力：天王炸 > 8炸 > 7炸 > 6炸 > 同花顺 > 5炸 > 4炸 > 普通牌型（同牌型才能压）
const { shuffle, addLog } = require('./util');

const N = 4;
const HAND_CNT = 27;
const LEVELS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]; // 2~A，14=A

// 牌点：3-15（11=J,12=Q,13=K,14=A,15=2），16=小王，17=大王；每点数8张（两副），王各2张
function buildDeck() {
  const d = [];
  let id = 0;
  for (let dk = 0; dk < 2; dk++) {
    for (let v = 3; v <= 15; v++) for (let s = 0; s < 4; s++) d.push({ id: id++, v, s });
    d.push({ id: id++, v: 16, s: 0 });
    d.push({ id: id++, v: 17, s: 1 });
  }
  return shuffle(d);
}

function countVals(cards) {
  const m = {};
  for (const c of cards) m[c.v] = (m[c.v] || 0) + 1;
  return m;
}

// 当前级牌值（2=15, 3=3, ..., A=14）
function levelVal(level) { return level === 2 ? 15 : level; }

// 逢人配：当前级牌是百搭（王除外）
function isWild(card, level) { return card.v === levelVal(level) && card.v < 16; }

// 将手牌中的逢人配分离出来，返回 {normal, wilds}
function splitWilds(cards, level) {
  const normal = [], wilds = [];
  for (const c of cards) (isWild(c, level) ? wilds : normal).push(c);
  return { normal, wilds };
}

// 用百搭补足指定点数的需求，返回补足后的虚拟计数（不修改原数组）
function fillWithWilds(cnt, need, wildCount) {
  const c = { ...cnt };
  let w = wildCount;
  for (const [v, n] of Object.entries(need)) {
    const val = +v;
    const cur = c[val] || 0;
    if (cur < n) {
      const lack = n - cur;
      if (w < lack) return null;
      w -= lack;
      c[val] = n;
    }
  }
  return { cnt: c, wildUsed: wildCount - w };
}

// 尝试用百搭组成指定牌型，返回 {type, main, len, size, wildUsed} 或 null
function analyze(cards, level) {
  const n = cards.length;
  if (!n) return null;
  const lv = levelVal(level);
  const { normal, wilds } = splitWilds(cards, level);
  const cnt = countVals(normal);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const counts = vals.map(v => cnt[v]);
  const maxC = Math.max(...counts, 0);

  // 天王炸：2大王+2小王（不能用百搭）
  if (n === 4 && cnt[16] === 2 && cnt[17] === 2)
    return { type: 'rocket', main: 99, len: 1, size: 4, wildUsed: 0 };

  // 炸弹：4~8张同点（可用百搭补足，王不能组成普通炸弹）
  if (n >= 4 && n <= 8) {
    for (const v of vals) {
      if (v >= 16) continue;
      const need = n - cnt[v];
      if (need <= wilds.length)
        return { type: 'bomb', main: v, len: 1, size: n, wildUsed: need };
    }
  }

  // 单张
  if (n === 1) return { type: 'single', main: vals[0] || (wilds.length ? lv : 0), len: 1, size: 1, wildUsed: wilds.length };

  // 对子
  if (n === 2) {
    for (const v of vals) {
      if (v >= 16) continue;
      const need = 2 - cnt[v];
      if (need <= wilds.length)
        return { type: 'pair', main: v, len: 1, size: 2, wildUsed: need };
    }
    // 双王（大小王各一不算对子，双大/双小才算）
    if (cnt[16] === 2 || cnt[17] === 2) return { type: 'pair', main: vals[0], len: 1, size: 2, wildUsed: 0 };
  }

  // 三带二：3同点+1对（无三带一！）
  if (n === 5) {
    // 先尝试不用百搭的纯三带二
    const tv = vals.find(v => v < 16 && cnt[v] === 3);
    const pv = vals.find(v => v < 16 && cnt[v] === 2 && v !== tv);
    if (tv !== undefined && pv !== undefined)
      return { type: 'triple2', main: tv, len: 1, size: 5, wildUsed: 0 };
    // 用百搭尝试
    for (const tv of vals) {
      if (tv >= 16) continue;
      const needT = Math.max(0, 3 - cnt[tv]);
      if (needT > wilds.length) continue;
      const remWilds = wilds.length - needT;
      // 从剩余牌中找对子
      const rest = vals.filter(v => v !== tv && v < 16);
      for (const pv of rest) {
        const needP = Math.max(0, 2 - cnt[pv]);
        if (needP <= remWilds)
          return { type: 'triple2', main: tv, len: 1, size: 5, wildUsed: needT + needP };
      }
    }
  }

  // 钢板（三顺）：恰好2组连续三张
  if (n === 6) {
    for (let i = 0; i < vals.length; i++) {
      const v1 = vals[i];
      if (v1 >= 15) continue;
      const v2 = v1 + 1;
      const need1 = Math.max(0, 3 - (cnt[v1] || 0));
      const need2 = Math.max(0, 3 - (cnt[v2] || 0));
      if (need1 + need2 <= wilds.length)
        return { type: 'plate', main: v2, len: 2, size: 6, wildUsed: need1 + need2 };
    }
  }

  // 木板（三连对）：恰好3组连续对子
  if (n === 6) {
    for (let i = 0; i + 2 < vals.length + 2; i++) {
      const v1 = vals[i] !== undefined ? vals[i] : (i < vals.length ? vals[i] : 3 + i);
      if (v1 >= 15) continue;
      const v2 = v1 + 1, v3 = v1 + 2;
      const need1 = Math.max(0, 2 - (cnt[v1] || 0));
      const need2 = Math.max(0, 2 - (cnt[v2] || 0));
      const need3 = Math.max(0, 2 - (cnt[v3] || 0));
      if (need1 + need2 + need3 <= wilds.length)
        return { type: 'pairs', main: v3, len: 3, size: 6, wildUsed: need1 + need2 + need3 };
    }
  }

  // 顺子：恰好5张连续（A2345最小，10JQKA最大；A不两头用）
  if (n === 5) {
    // 尝试所有5连组合（含A2345特殊：将A视为1）
    const trySeq = (seqVals) => {
      let need = 0;
      for (const sv of seqVals) {
        const actual = sv === 1 ? 14 : sv; // A用14表示
        need += Math.max(0, 1 - (cnt[actual] || 0));
      }
      if (need <= wilds.length)
        return { type: 'straight', main: seqVals[4] === 1 ? 14 : seqVals[4], len: 5, size: 5, wildUsed: need };
      return null;
    };
    // 普通顺子 3-4-5-6-7 ... 10-J-Q-K-A
    for (let start = 3; start <= 10; start++) {
      const r = trySeq([start, start + 1, start + 2, start + 3, start + 4]);
      if (r) return r;
    }
    // A2345（A视为1）
    const r = trySeq([1, 2, 3, 4, 5]);
    if (r) return { ...r, main: 5 }; // A2345 以5为最大
  }

  // 同花顺：恰好5张同花色连续（不能用百搭改变花色，百搭只能补点数）
  // 简化：同花顺要求5张同花色，点数连续；百搭只能用于补同花色的缺失点数
  if (n === 5) {
    for (let suit = 0; suit < 4; suit++) {
      const suitCards = normal.filter(c => c.s === suit && c.v < 16);
      const suitCnt = countVals(suitCards);
      const suitVals = Object.keys(suitCnt).map(Number).sort((a, b) => a - b);
      // 尝试5连
      for (let start = 3; start <= 10; start++) {
        let need = 0;
        for (let k = 0; k < 5; k++) {
          const v = start + k;
          if (v > 14) break;
          need += Math.max(0, 1 - (suitCnt[v] || 0));
        }
        if (need <= wilds.length && suitCards.length + wilds.length >= 5)
          return { type: 'flush', main: start + 4, len: 5, size: 5, wildUsed: need };
      }
      // A2345同花
      let needA = Math.max(0, 1 - (suitCnt[14] || 0));
      let need2 = Math.max(0, 1 - (suitCnt[15] || 0));
      let need3 = Math.max(0, 1 - (suitCnt[3] || 0));
      let need4 = Math.max(0, 1 - (suitCnt[4] || 0));
      let need5 = Math.max(0, 1 - (suitCnt[5] || 0));
      if (needA + need2 + need3 + need4 + need5 <= wilds.length)
        return { type: 'flush', main: 5, len: 5, size: 5, wildUsed: needA + need2 + need3 + need4 + need5 };
    }
  }

  return null;
}

const TYPE_NAME = {
  single: '单张', pair: '对子', triple2: '三带二',
  straight: '顺子', flush: '同花顺', pairs: '木板', plate: '钢板',
  bomb: '炸弹', rocket: '天王炸',
};

// 牌力等级：火箭(6) > 8炸(5) > 7炸(5) > 6炸(5) > 同花顺(4) > 5炸(3) > 4炸(2) > 普通(0)
function powerLevel(pat) {
  if (pat.type === 'rocket') return 6;
  if (pat.type === 'bomb') {
    if (pat.size === 8) return 5;
    if (pat.size === 7) return 5;
    if (pat.size === 6) return 5;
    if (pat.size === 5) return 3;
    if (pat.size === 4) return 2;
  }
  if (pat.type === 'flush') return 4;
  return 0;
}

// cur 能否压过 prev；领出（prev=null）时任何合法牌型都可以
function canBeat(cur, prev) {
  if (!prev) return true;
  const cl = powerLevel(cur), pl = powerLevel(prev);
  if (cl !== pl) return cl > pl;
  // 同等级比较
  if (cur.type === 'rocket') return false; // 火箭最大，不会被压
  if (cur.type === 'bomb') {
    if (cur.size !== prev.size) return cur.size > prev.size;
    return cur.main > prev.main;
  }
  if (cur.type === 'flush') return cur.main > prev.main;
  // 普通牌型必须同类型同长度
  if (cur.type !== prev.type) return false;
  if (cur.len !== prev.len) return false;
  return cur.main > prev.main;
}

// 手牌中是否存在能压过 last 的组合（用于自动跳过）
function hasBeat(hand, last, level) {
  if (!last) return true;
  const lv = levelVal(level);
  const { normal, wilds } = splitWilds(hand, level);
  const cnt = countVals(normal);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);

  // 天王炸
  if (cnt[16] >= 2 && cnt[17] >= 2) return true;
  if (last.type === 'rocket') return false;

  // 炸弹
  const bombs = [];
  for (const v of vals) {
    if (v >= 16) continue;
    const maxSize = Math.min(8, cnt[v] + wilds.length);
    for (let size = 4; size <= maxSize; size++) {
      bombs.push({ type: 'bomb', main: v, size, len: 1 });
    }
  }
  // 加上同花顺（如果有5张同花）
  for (let s = 0; s < 4; s++) {
    const suitCards = normal.filter(c => c.s === s && c.v < 16);
    if (suitCards.length + wilds.length >= 5) {
      // 简化：只要同花数量够就认为可能有同花顺
      bombs.push({ type: 'flush', main: 0, len: 5, size: 5 });
    }
  }

  const lastLevel = powerLevel(last);
  // 找比last等级高的
  for (const b of bombs) {
    if (powerLevel(b) > lastLevel) return true;
    if (powerLevel(b) === lastLevel) {
      if (b.type === 'bomb' && last.type === 'bomb') {
        if (b.size > last.size || (b.size === last.size && b.main > last.main)) return true;
      } else if (b.type === 'flush' && last.type === 'flush') {
        // 简化：有同花顺就可能压过
        return true;
      }
    }
  }
  if (lastLevel > 0) return false; // 对方是炸弹/同花顺/火箭，普通牌压不了

  // 普通牌型比较
  const hasPairOther = tv => vals.some(w => w !== tv && w < 16 && cnt[w] >= 2);
  switch (last.type) {
    case 'single':
      return vals.some(v => v > last.main) || wilds.length > 0;
    case 'pair':
      return vals.some(v => v > last.main && cnt[v] >= 2) || wilds.length >= 2;
    case 'triple2':
      return vals.some(v => v > last.main && cnt[v] >= 3 && hasPairOther(v)) || wilds.length >= 3;
    case 'straight': {
      const run = vals.filter(v => v < 15);
      for (let i = 0; i + 5 <= run.length; i++)
        if (run[i + 4] - run[i] === 4 && run[i + 4] > last.main) return true;
      // A2345特殊
      if (run.includes(14) && run.includes(15) && run.includes(3) && run.includes(4) && run.includes(5) && 5 > last.main) return true;
      return wilds.length >= 2; // 百搭可能凑成顺子
    }
    case 'pairs': {
      const ps = vals.filter(v => v < 15 && cnt[v] >= 2);
      for (let i = 0; i + 3 <= ps.length; i++)
        if (ps[i + 2] - ps[i] === 2 && ps[i + 2] > last.main) return true;
      return wilds.length >= 2;
    }
    case 'plate': {
      const ts = vals.filter(v => v < 15 && cnt[v] >= 3);
      for (let i = 0; i + 2 <= ts.length; i++)
        if (ts[i + 1] - ts[i] === 1 && ts[i + 1] > last.main) return true;
      return wilds.length >= 2;
    }
  }
  return false;
}

module.exports = {
  maxPlayers: N,

  // prev：上一局状态（用于累计等级、进贡信息）
  init(players, prev) {
    const state = {
      phase: 'play', // play=出牌；tribute=进贡/退贡阶段；over=结束
      hands: [[], [], [], []],
      level: prev && typeof prev.level === 'number' ? prev.level : 2, // 当前级牌（2~14）
      turn: 0,
      last: null, lastSeat: -1, lastCards: [], passCount: 0,
      plays: [], table: [], round: 1,
      finished: [], // 出完的名次顺序
      winner: -1, winSide: '', over: false, log: [],
      // 进贡相关
      tributeInfo: null, // {from, to, card, returned}
      doubleDown: false, // 是否双下
      // 升级记录
      levelHistory: prev && Array.isArray(prev.levelHistory) ? prev.levelHistory.slice() : [],
      // 本局结算
      settle: null,
    };
    this._deal(state);
    return state;
  },

  _deal(state) {
    const deck = buildDeck();
    const hands = [[], [], [], []];
    for (let i = 0; i < N * HAND_CNT; i++) hands[i % N].push(deck.pop());
    for (const h of hands) h.sort((a, b) => a.v - b.v || a.s - b.s);
    state.hands = hands;
    state.phase = 'play';
    state.turn = 0; // 第一局由玩家1领出
    state.last = null; state.lastSeat = -1; state.passCount = 0; state.lastCards = [];
    state.plays = []; state.table = []; state.round = 1;
    state.finished = []; state.over = false; state.settle = null;
    state.tributeInfo = null; state.doubleDown = false;
    state.turnStart = Date.now();
    addLog(state, `游戏开始（级牌：${state.level === 14 ? 'A' : state.level === 13 ? 'K' : state.level === 12 ? 'Q' : state.level === 11 ? 'J' : state.level}），玩家1 先出`);
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';
    if (seat !== state.turn) return '还没轮到你';

    // ---------- 进贡/退贡阶段 ----------
    if (state.phase === 'tribute') {
      // 简化：进贡自动进行，退贡由系统选择最小牌退回
      // 实际应给玩家选择，这里先自动处理
      if (a.op === 'tribute_done') {
        state.phase = 'play';
        state.turn = state.tributeInfo ? state.tributeInfo.to : 0; // 头游领出
        state.turnStart = Date.now();
        addLog(state, '进贡完成，开始出牌');
        return null;
      }
      return '进贡阶段请等待';
    }

    // ---------- 出牌 ----------
    if (a.op === 'play') {
      const cards = (a.ids || []).map(id => state.hands[seat].find(c => c.id === id)).filter(Boolean);
      if (!cards.length || cards.length !== (a.ids || []).length) return '选牌无效';
      const pat = analyze(cards, state.level);
      if (!pat) return '不符合任何牌型，请重新选择';
      if (!canBeat(pat, state.last)) {
        if (state.last && state.lastSeat !== seat) {
          const need = TYPE_NAME[state.last.type] || '对应牌型';
          if (pat.type !== state.last.type || pat.len !== state.last.len) return `请打出对应的牌型（${need}），或出炸弹/天王炸`;
          return `点数要大于上家的${TYPE_NAME[pat.type] || '牌'}，或出炸弹/天王炸`;
        }
        return '打不过上家';
      }
      for (const c of cards) state.hands[seat].splice(state.hands[seat].indexOf(c), 1);
      state.last = pat; state.lastSeat = seat; state.passCount = 0;
      state.lastCards = cards;
      state.plays.push({ seat, cards: cards.map(c => ({ ...c })) });
      state.table = state.table.filter(x => x.seat !== seat);
      state.table.push({ seat, cards: cards.map(c => ({ ...c })) });
      addLog(state, `${seatName(seat)} 出了 ${cards.length} 张（${TYPE_NAME[pat.type]}${pat.type === 'bomb' ? pat.size + '张' : ''}）`);

      // 检查是否出完
      if (state.hands[seat].length === 0 && !state.finished.includes(seat)) {
        state.finished.push(seat);
        addLog(state, `${seatName(seat)} 出完，第 ${state.finished.length} 名`);
        // 检查是否一队两人都出完
        const teamA = [0, 2].filter(s => state.finished.includes(s)).length;
        const teamB = [1, 3].filter(s => state.finished.includes(s)).length;
        if (teamA === 2 || teamB === 2) {
          this._endRound(state, teamA === 2 ? 0 : 1);
          return null;
        }
        if (state.finished.length === 3) {
          // 只剩一人，自动结束
          const lastTeam = [0, 1, 2, 3].find(s => !state.finished.includes(s)) % 2;
          this._endRound(state, lastTeam === 0 ? 0 : 1);
          return null;
        }
      }
      this._next(state);
      this._autoPass(state);
      state.turnStart = Date.now();
      return null;
    }

    if (a.op === 'pass') {
      if (!state.last || state.lastSeat === seat) return '你现在必须出牌';
      state.passCount++;
      addLog(state, `${seatName(seat)} 不出`);
      state.table = state.table.filter(x => x.seat !== seat);
      state.table.push({ seat, cards: null });
      const active = [0, 1, 2, 3].filter(s => !state.finished.includes(s));
      if (state.passCount >= active.length - 1) {
        this._endTrick(state);
      } else {
        this._next(state);
        this._autoPass(state);
      }
      state.turnStart = Date.now();
      return null;
    }
    return '未知操作';
  },

  // 一轮结束：最后出牌者获得下一轮领出权
  _endTrick(state) {
    state.last = null; state.passCount = 0; state.lastCards = [];
    state.table = []; state.round++;
    let lead = state.lastSeat;
    if (state.finished.includes(lead)) {
      // 最后出牌者已出完，由第一个活跃玩家领出
      lead = [0, 1, 2, 3].find(s => !state.finished.includes(s));
    }
    state.turn = lead;
    addLog(state, `一轮结束，${seatName(lead)} 领出`);
  },

  _next(state) {
    let t = state.turn;
    do { t = (t + 1) % N; } while (state.finished.includes(t));
    state.turn = t;
    if (state.last && state.lastSeat === t) { state.last = null; state.lastCards = []; state.passCount = 0; }
  },

  _autoPass(state) {
    let guard = 0;
    while (!state.over && state.last && state.lastSeat !== state.turn
      && !hasBeat(state.hands[state.turn], state.last, state.level) && guard++ < 12) {
      addLog(state, `${seatName(state.turn)} 没有可出的牌，自动跳过`);
      const skipSeat = state.turn;
      state.table = state.table.filter(a => a.seat !== skipSeat);
      state.table.push({ seat: skipSeat, cards: null });
      state.passCount++;
      const active = [0, 1, 2, 3].filter(s => !state.finished.includes(s));
      if (state.passCount >= active.length - 1) { this._endTrick(state); break; }
      this._next(state);
    }
  },

  // 一局结束：计算升级、进贡信息
  _endRound(state, winTeam) {
    // finished: [头游, 二游, 三游, 末游] —— 可能不足4人（一队两人都出完即提前结束）
    const first = state.finished[0];
    const second = state.finished[1];
    const third = state.finished[2];
    const fourth = state.finished[3];
    // 不足4人时，把未出完的按座位顺序补到末尾（视为并列末游）
    if (state.finished.length < 4) {
      for (let s = 0; s < N; s++) if (!state.finished.includes(s)) state.finished.push(s);
    }
    // 重新取值（补齐后）
    const f0 = state.finished[0], f1 = state.finished[1], f2 = state.finished[2], f3 = state.finished[3];

    // 确定双下：一队两人都是末两名
    const teamAFinished = [0, 2].filter(s => state.finished.includes(s));
    const teamBFinished = [1, 3].filter(s => state.finished.includes(s));
    const aLast = teamAFinished.length === 2 && teamAFinished.every(s => state.finished.indexOf(s) >= 2);
    const bLast = teamBFinished.length === 2 && teamBFinished.every(s => state.finished.indexOf(s) >= 2);
    state.doubleDown = aLast || bLast;

    // 升级规则：以头游所在队为基准
    let levelUp = 0;
    const firstTeam = f0 % 2;
    const myTeamFinished = firstTeam === 0 ? teamAFinished : teamBFinished;
    if (myTeamFinished.length === 2) {
      const secondPos = state.finished.indexOf(myTeamFinished[1]);
      if (secondPos === 1) levelUp = 3;      // 头游+二游
      else if (secondPos === 2) levelUp = 2; // 头游+三游
      else levelUp = 1;                       // 头游+末游
    }

    // 进贡信息
    if (state.doubleDown) {
      // 双下：末游两人都向对手上游进贡
      state.tributeInfo = {
        type: 'double',
        from: [f2, f3],
        to: [f0, f1],
        cards: [],
        returned: [],
      };
    } else {
      // 单下：末游向头游进贡
      state.tributeInfo = {
        type: 'single',
        from: f3,
        to: f0,
        card: null,
        returned: null,
      };
    }

    // 抗贡检测：末游或双下两人手中有两张大王
    const canResist = (hand) => hand.filter(c => c.v === 17).length >= 2;
    if (state.doubleDown) {
      const h2 = state.hands[f2], h3 = state.hands[f3];
      if (canResist(h2) && canResist(h3)) {
        state.tributeInfo = null;
        addLog(state, '双下但双方均有两张大王，抗贡成功！');
      }
    } else {
      if (canResist(state.hands[f3])) {
        state.tributeInfo = null;
        addLog(state, `${seatName(f3)} 有两张大王，抗贡成功！`);
      }
    }

    // 计算新等级
    const oldLevel = state.level;
    let newLevel = oldLevel;
    if (winTeam === firstTeam) {
      newLevel = LEVELS[Math.min(LEVELS.indexOf(oldLevel) + levelUp, LEVELS.length - 1)];
    }
    // A级通关判定：打到A且获胜，且不能被双下
    const isAWin = oldLevel === 14 && winTeam === firstTeam && !state.doubleDown;

    state.settle = {
      winTeam, firstTeam, levelUp, oldLevel, newLevel,
      doubleDown: state.doubleDown,
      tributeInfo: state.tributeInfo,
      isAWin,
      finished: state.finished.slice(),
    };
    state.over = true;
    state.winner = first; // 头游
    state.winSide = winTeam === 0 ? 'teamA' : 'teamB';
    state.phase = 'over';
    state.level = newLevel; // 记录新等级（下一局用）

    addLog(state, `一局结束！${winTeam === 0 ? '一三队' : '二四队'}获胜，${levelUp > 0 ? `升${levelUp}级（${oldLevel === 14 ? 'A' : oldLevel}→${newLevel === 14 ? 'A' : newLevel}）` : '不升级'}`);
    if (isAWin) addLog(state, '🎉 打到A并获胜，通关成功！');
  },

  view(state, seat) {
    return {
      phase: state.phase,
      turn: state.turn,
      level: state.level,
      levelName: state.level === 14 ? 'A' : state.level === 13 ? 'K' : state.level === 12 ? 'Q' : state.level === 11 ? 'J' : state.level,
      turnStart: state.turnStart, turnTimeout: 25,
      hand: state.hands[seat],
      counts: state.hands.map(h => h.length),
      lastCards: state.lastCards || [],
      plays: state.plays,
      table: state.table || [], round: state.round || 1,
      mustPlay: !state.last || state.lastSeat === seat,
      finished: state.finished,
      winner: state.winner, winSide: state.winSide, over: state.over, log: state.log,
      // 进贡/结算
      tributeInfo: state.tributeInfo,
      doubleDown: state.doubleDown,
      settle: state.settle,
    };
  },

  // 超时自动行动：必须领出时出最小单牌，否则不出
  timeoutAction(state, seat) {
    if (state.phase === 'tribute') return { op: 'tribute_done' };
    if (!state.hands[seat].length) return { op: 'pass' };
    if (!state.last || state.lastSeat === seat) return { op: 'play', ids: [state.hands[seat][0].id] };
    return { op: 'pass' };
  },

  // 电脑策略（保持简单）
  bot(state, seat) {
    const h = state.hands[seat];
    if (!h.length) return { op: 'pass' };
    if (state.phase === 'tribute') return { op: 'tribute_done' };
    // 领出：最小单张
    if (!state.last || state.lastSeat === seat) return { op: 'play', ids: [h[0].id] };
    const pat = state.last;
    // 只跟单张/对子
    if (pat.type === 'single') {
      const c = h.find(x => x.v > pat.main && !isWild(x, state.level));
      if (c) return { op: 'play', ids: [c.id] };
    } else if (pat.type === 'pair') {
      for (const c of h) {
        if (isWild(c, state.level)) continue;
        if (c.v > pat.main && h.filter(x => x.v === c.v).length >= 2) {
          return { op: 'play', ids: h.filter(x => x.v === c.v).slice(0, 2).map(x => x.id) };
        }
      }
    }
    return { op: 'pass' };
  },
};

function seatName(seat) {
  return `玩家${seat + 1}`;
}
