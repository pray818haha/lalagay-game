// 四人斗地主：2 副牌共 108 张，4 人，1 地主 vs 3 农民，每人 25 张 + 8 张底牌
// 叫分 1/2/3/不叫；牌型无三带一、四带二；炸弹 4~8 张；四王为天尊
// 特殊规则：报到、摊打、头撩、荒番、明王（均使本局加减分翻倍）
const { shuffle, addLog } = require('./util');

const N = 4;
const HAND_CNT = 25;
const BOTTOM_CNT = 8;

// 牌点：3-15（11=J,12=Q,13=K,14=A,15=2），16=小王，17=大王；每点数 8 张（两副），王各 2 张
function buildDeck() {
  const d = [];
  let id = 0;
  for (let dk = 0; dk < 2; dk++) {
    for (let v = 3; v <= 15; v++) for (let s = 0; s < 4; s++) d.push({ id: id++, v, s });
    d.push({ id: id++, v: 16, s: 0 }); // 小王
    d.push({ id: id++, v: 17, s: 1 }); // 大王
  }
  return shuffle(d);
}

function countVals(cards) {
  const m = {};
  for (const c of cards) m[c.v] = (m[c.v] || 0) + 1;
  return m;
}

// 识别牌型，返回 {type, main, len, size} 或 null
function analyze(cards) {
  const n = cards.length;
  if (!n) return null;
  const cnt = countVals(cards);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  const counts = vals.map(v => cnt[v]);
  const maxC = Math.max(...counts);

  if (n === 1) return { type: 'single', main: vals[0], len: 1, size: 1 };

  if (n === 2) {
    // 对子（双大王、双小王也算对子；大小王混合不算）
    if (vals.length === 1 && counts[0] === 2) return { type: 'pair', main: vals[0], len: 1, size: 2 };
    return null;
  }

  if (n === 3 && vals.length === 1 && counts[0] === 3)
    return { type: 'triple', main: vals[0], len: 1, size: 3 };

  // 天尊：两大两小四张王，全场最大
  if (n === 4 && cnt[16] === 2 && cnt[17] === 2)
    return { type: 'rocket', main: 99, len: 1, size: 4 };

  // 炸弹：4~8 张同点数（不含王，王不能组成普通炸弹）
  if (n >= 4 && vals.length === 1 && vals[0] <= 15 && counts[0] === n)
    return { type: 'bomb', main: vals[0], len: 1, size: n };

  // 三带二：3 同点 + 1 对（对子点不同于三张点）；未命中不能返回 null，5 张也可能是顺子
  if (n === 5) {
    const tv = vals.find(v => cnt[v] === 3);
    const pv = vals.find(v => cnt[v] === 2 && v !== tv);
    if (tv !== undefined && pv !== undefined)
      return { type: 'triple2', main: tv, len: 1, size: 5 };
  }

  // 顺子：>=5 张连续单牌，不含 2、王
  if (n >= 5 && maxC === 1 && vals[n - 1] < 15 && vals[n - 1] - vals[0] === n - 1)
    return { type: 'straight', main: vals[n - 1], len: n, size: n };

  // 连对：>=3 组连续对子，不含 2、王
  if (n >= 6 && n % 2 === 0 && maxC === 2) {
    const k = n / 2;
    if (vals.length === k && vals[k - 1] < 15 && vals[k - 1] - vals[0] === k - 1)
      return { type: 'pairs', main: vals[k - 1], len: k, size: n };
  }

  // 飞机：k>=2 组连续三张（纯三顺，3k 张）
  const triples = vals.filter(v => v <= 14 && cnt[v] === 3);
  // 取最长连续段
  const seg = longestSeg(triples);
  if (seg) {
    const k = seg.vs.length;
    // 纯三顺：恰好 k 组三张
    if (n === 3 * k && vals.length === k)
      return { type: 'plane', main: seg.vs[k - 1], len: k, size: n };
    // 飞机带翅膀：k 组三张 + k 个对子（对子点不同于三张点），共 5k 张
    if (n === 5 * k) {
      const tset = new Set(seg.vs);
      const wingVals = vals.filter(v => !tset.has(v) && cnt[v] === 2);
      if (wingVals.length === k)
        return { type: 'plane2', main: seg.vs[k - 1], len: k, size: n };
    }
  }

  return null;
}

// 在升序点数组中找最长连续段（长度>=2），返回 {vs} 或 null
function longestSeg(vs) {
  let best = null, cur = [];
  for (const v of vs) {
    if (cur.length && v === cur[cur.length - 1] + 1) cur.push(v);
    else cur = [v];
    if (cur.length >= 2 && (!best || cur.length > best.length)) best = cur.slice();
  }
  return best ? { vs: best } : null;
}

const TYPE_NAME = {
  single: '单张', pair: '对子', triple: '三张', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '三顺', plane2: '飞机带翅膀',
  bomb: '炸弹', rocket: '天尊',
};

// cur 能否压过 prev；领出（prev=null）时任何合法牌型都可以
function canBeat(cur, prev) {
  if (!prev) return true;
  if (cur.type === 'rocket') return true;
  if (prev.type === 'rocket') return false;
  if (cur.type === 'bomb' && prev.type === 'bomb')
    return cur.size > prev.size || (cur.size === prev.size && cur.main > prev.main);
  if (cur.type === 'bomb') return true;                 // 炸弹压一切非炸弹普通牌
  if (prev.type === 'bomb') return false;
  if (cur.type !== prev.type) return false;
  if (cur.len !== prev.len) return false;
  return cur.main > prev.main;
}

// 手牌中是否存在能压过 last 的组合（只用于自动跳过；宁可多判 true 也不能漏判）
// bombsLeft：该玩家本局剩余可用炸弹次数（不含时视为无限，地主不限）
function hasBeat(hand, last, bombsLeft) {
  if (!last) return true;
  const noBomb = bombsLeft !== undefined && bombsLeft <= 0;
  const cnt = countVals(hand);
  const vals = Object.keys(cnt).map(Number).sort((a, b) => a - b);
  // 天尊
  if (!noBomb && cnt[16] >= 2 && cnt[17] >= 2) return true;
  // 炸弹
  const bombs = vals.filter(v => v <= 15 && cnt[v] >= 4);
  if (!noBomb && last.type === 'bomb') {
    return bombs.some(v => cnt[v] > last.size || (cnt[v] === last.size && v > last.main));
  }
  if (!noBomb && bombs.length) return true; // 普通牌局里有任意炸弹即可压（非炸弹比较时）
  if (last.type === 'rocket') return false;

  const hasPairOther = tv => vals.some(w => w !== tv && cnt[w] >= 2);
  switch (last.type) {
    case 'single':
      return vals.some(v => v > last.main);
    case 'pair':
      return vals.some(v => v > last.main && cnt[v] >= 2);
    case 'triple':
      return vals.some(v => v > last.main && cnt[v] >= 3);
    case 'triple2':
      return vals.some(v => v > last.main && cnt[v] >= 3 && (cnt[v] >= 5 || hasPairOther(v)));
    case 'straight': {
      const run = vals.filter(v => v < 15 && cnt[v] >= 1);
      for (let i = 0; i + last.len <= run.length; i++)
        if (run[i + last.len - 1] - run[i] === last.len - 1 && run[i + last.len - 1] > last.main) return true;
      return false;
    }
    case 'pairs': {
      const k = last.len, ps = vals.filter(v => v < 15 && cnt[v] >= 2);
      for (let i = 0; i + k <= ps.length; i++)
        if (ps[i + k - 1] - ps[i] === k - 1 && ps[i + k - 1] > last.main) return true;
      return false;
    }
    case 'plane':
    case 'plane2': {
      const k = last.len, ts = vals.filter(v => v <= 14 && cnt[v] >= 3);
      for (let i = 0; i + k <= ts.length; i++) {
        if (ts[i + k - 1] - ts[i] === k - 1 && ts[i + k - 1] > last.main) {
          if (last.type === 'plane') return true;
          // 带翅膀还要凑得出 k 个对子
          const tset = new Set(ts.slice(i, i + k));
          if (vals.filter(w => !tset.has(w) && cnt[w] >= 2).length >= k) return true;
        }
      }
      return false;
    }
  }
  return false;
}

module.exports = {
  maxPlayers: N,

  // prev：上一局状态（用于累计积分、荒番局延续）
  init(players, prev) {
    const state = {
      phase: 'bid', // bid=叫分；declare=地主报到/摊打抉择；play=出牌
      hands: [[], [], [], []], bottom: [],
      landlord: -1,
      bidStarter: 0, bidCount: 0, maxBid: 0, maxBidSeat: -1, bids: {},
      turn: 0,
      last: null, lastSeat: -1, passCount: 0, lastCards: [],
      plays: [], table: [], round: 1,
      winner: -1, winSide: '', over: false, log: [],
      // 积分与倍数
      scores: prev && Array.isArray(prev.scores) ? prev.scores.slice() : [0, 0, 0, 0],
      voidRound: false,           // 本局流局，则下一局为荒番
      mult: { huangfan: false, mingwang: false, touliao: false, tanda: false, baodao: false },
      markedCard: null,           // 明王标记牌
      baodaoEligible: false,      // 地主是否满足报到条件
      lockedVals: [],             // 报到后不允许拆开的 7+ 炸弹点数
      bombsUsed: [0, 0, 0, 0],    // 各家本局已打出的炸弹次数（含天尊）
      settle: null,               // 本局结算明细
    };
    this._deal(state, !!prev && prev.voidRound);
    return state;
  },

  // 发牌并进入叫分（huangfanArmed=上局流局，本局荒番翻倍）
  _deal(state, huangfanArmed) {
    const deck = buildDeck();
    const hands = [[], [], [], []];
    for (let i = 0; i < N * HAND_CNT; i++) hands[i % N].push(deck.pop());
    for (const h of hands) h.sort((a, b) => a.v - b.v || a.s - b.s);
    state.hands = hands;
    state.bottom = deck.splice(0, BOTTOM_CNT); // 8 张底牌
    state.phase = 'bid';
    state.landlord = -1;
    state.bidStarter = Math.floor(Math.random() * N);
    state.turn = state.bidStarter;
    state.bidCount = 0; state.maxBid = 0; state.maxBidSeat = -1; state.bids = {};
    state.last = null; state.lastSeat = -1; state.passCount = 0; state.lastCards = [];
    state.plays = []; state.table = []; state.round = 1;
    state.winner = -1; state.winSide = ''; state.over = false;
    state.settle = null; state.baodaoEligible = false; state.lockedVals = [];
    state.bombsUsed = [0, 0, 0, 0];
    state.mult = {
      huangfan: !!huangfanArmed,
      mingwang: false, // 明王仅当标记到王（见下）
      touliao: false, tanda: false, baodao: false,
    };
    state.voidRound = false;
    // 明王：发牌前从 108 张概念牌中随机标记一张：0-1=小王，2-3=大王（标到王即明王），
    // 4 以后为普通牌（每点 8 张：两副各 4 花色）
    const markPos = Math.floor(Math.random() * 108);
    if (markPos < 4) {
      state.markedCard = { v: markPos < 2 ? 16 : 17, s: 0 };
      state.mult.mingwang = true;
    } else {
      const p = markPos - 4;
      state.markedCard = { v: 3 + Math.floor(p / 8), s: p % 4 };
    }
    state.turnStart = Date.now();
    addLog(state, `发牌完成，从${seatName(state.bidStarter)} 开始叫分${state.mult.huangfan ? '（本局荒番，积分翻倍）' : ''}${state.mult.mingwang ? '（明王出现，积分翻倍）' : ''}`);
  },

  _makeLandlord(state, immediate3) {
    state.landlord = state.maxBidSeat;
    if (immediate3 && state.bidCount === 1) {
      state.mult.touliao = true; // 头撩：第一位直接叫 3 分
      addLog(state, '头撩！第一位玩家直接叫 3 分，积分翻倍');
    }
    state.hands[state.landlord].push(...state.bottom);
    state.hands[state.landlord].sort((a, b) => a.v - b.v || a.s - b.s);
    const h = state.hands[state.landlord];
    const cnt = countVals(h);
    const fourJokers = cnt[16] >= 2 && cnt[17] >= 2;
    const bigBomb = Object.keys(cnt).some(v => v <= 15 && cnt[v] >= 7);
    state.baodaoEligible = fourJokers || bigBomb;
    // 报到抉择阶段
    state.phase = 'declare';
    state.turn = state.landlord;
    state.turnStart = Date.now();
    addLog(state, `${seatName(state.landlord)} 以 ${state.maxBid} 分成为地主，获得 8 张底牌（共 ${h.length} 张）${state.baodaoEligible ? '，满足报到条件' : ''}`);
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';
    if (seat !== state.turn) return '还没轮到你';

    // ---------- 叫分 ----------
    if (state.phase === 'bid') {
      if (a.op !== 'bid') return '叫分阶段只能叫分';
      const score = a.score | 0;
      if (![0, 1, 2, 3].includes(score)) return '无效叫分';
      if (score > 0 && score <= state.maxBid) return '叫分必须高于当前最高分';
      state.bids[seat] = score;
      state.bidCount++;
      addLog(state, `${seatName(seat)} ${score === 0 ? '不叫' : '叫 ' + score + ' 分'}`);
      if (score > state.maxBid) { state.maxBid = score; state.maxBidSeat = seat; }
      if (score === 3) { this._makeLandlord(state, true); return null; }
      if (state.bidCount >= N) {
        if (state.maxBidSeat < 0) {
          addLog(state, '四家都不叫，本局流局，立即重新发牌，新一局为荒番局（积分翻倍）');
          // 立即重发的新局就是荒番局；若荒番局再次流局则继续链式翻倍
          this._deal(state, true);
          return null;
        }
        this._makeLandlord(state, false);
        return null;
      }
      state.turn = (state.turn + 1) % N;
      state.turnStart = Date.now();
      return null;
    }

    // ---------- 地主：报到 / 摊打 抉择 ----------
    if (state.phase === 'declare') {
      // 报到但不打：直接按地主获胜结算（不叠加报到/摊打翻倍），进入下一局
      if (a.op === 'baodao_pass') {
        if (!state.baodaoEligible) return '你不满足报到条件';
        addLog(state, '地主选择报到不打，直接结算积分');
        this._settle(state, 'landlord', 'baodao', { baodao: false, tanda: false });
        return null;
      }
      if (a.op === 'declare') {
        const tanda = !!a.tanda;
        if (tanda) { state.mult.tanda = true; addLog(state, '地主选择摊打，积分翻倍'); }
        if (state.baodaoEligible) {
          state.mult.baodao = true;
          // 7 张以上炸弹锁定不可拆（四王报到不强制锁）
          const cnt = countVals(state.hands[seat]);
          state.lockedVals = Object.keys(cnt).map(Number).filter(v => v <= 15 && cnt[v] >= 7);
          addLog(state, `地主报到后正常打，积分翻倍${state.lockedVals.length ? '，报到炸弹不可拆开' : ''}`);
        }
        state.phase = 'play';
        state.turn = state.landlord;
        state.turnStart = Date.now();
        return null;
      }
      return '请选择报到或出牌方式';
    }

    // ---------- 出牌 ----------
    if (a.op === 'play') {
      const cards = (a.ids || []).map(id => state.hands[seat].find(c => c.id === id)).filter(Boolean);
      if (!cards.length || cards.length !== (a.ids || []).length) return '选牌无效';
      const pat = analyze(cards);
      if (!pat) return '不符合任何牌型，请重新选择';
      // 农民炸弹次数限制（地主不限；天尊计入炸弹次数）
      if ((pat.type === 'bomb' || pat.type === 'rocket') && seat !== state.landlord) {
        const lim = bombLimit(state, seat);
        if ((state.bombsUsed[seat] || 0) >= lim)
          return `你本局最多只能使用 ${lim} 个炸弹`;
      }
      if (!canBeat(pat, state.last)) {
        if (state.last && state.lastSeat !== seat) {
          const need = TYPE_NAME[state.last.type] || '对应牌型';
          if (pat.type !== state.last.type || pat.len !== state.last.len) return `请打出对应的牌型（${need}），或出炸弹/天尊`;
          return `点数要大于上家的${TYPE_NAME[pat.type] || '牌'}，或出炸弹/天尊`;
        }
        return '打不过上家';
      }
      // 报到炸弹不允许拆开
      if (seat === state.landlord && state.lockedVals.length) {
        const cnt = countVals(cards);
        const handCnt = countVals(state.hands[seat]);
        for (const lv of state.lockedVals) {
          if (cnt[lv] && cnt[lv] !== handCnt[lv]) return '报到的炸弹不能拆开，必须整体作为炸弹打出';
        }
      }
      for (const c of cards) state.hands[seat].splice(state.hands[seat].indexOf(c), 1);
      if (pat.type === 'bomb' || pat.type === 'rocket')
        state.bombsUsed[seat] = (state.bombsUsed[seat] || 0) + 1;
      state.last = pat; state.lastSeat = seat; state.passCount = 0;
      state.lastCards = cards;
      state.plays.push({ seat, cards: cards.map(c => ({ ...c })) });
      state.table = state.table.filter(x => x.seat !== seat);
      state.table.push({ seat, cards: cards.map(c => ({ ...c })) });
      addLog(state, `${seatName(seat)} 出了 ${cards.length} 张（${TYPE_NAME[pat.type]}${pat.type === 'bomb' ? pat.size + '张' : ''}）`);
      if (state.hands[seat].length === 0) {
        const landlordWin = seat === state.landlord;
        this._settle(state, landlordWin ? 'landlord' : 'farmers', 'normal');
        addLog(state, landlordWin ? '地主先出完，地主获胜！' : '农民先出完，农民同盟获胜！');
        return null;
      }
      state.turn = (state.turn + 1) % N;
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
      if (state.passCount >= 2) {
        this._endTrick(state);
      } else {
        state.turn = (state.turn + 1) % N;
        this._autoPass(state);
      }
      state.turnStart = Date.now();
      return null;
    }
    return '未知操作';
  },

  // 一轮结束（连续两家过）：最后出牌者获得下一轮领出权
  _endTrick(state) {
    state.last = null; state.passCount = 0; state.lastCards = [];
    state.table = []; state.round++;
    state.turn = state.lastSeat;
    addLog(state, `一轮结束，${seatName(state.lastSeat)} 领出`);
  },

  // 当前行动者压不过上家时自动跳过（可能连续多家），直到有人能出或一轮结束
  _autoPass(state) {
    let guard = 0;
    while (!state.over && state.last && state.lastSeat !== state.turn
      && !hasBeat(state.hands[state.turn], state.last,
        state.turn === state.landlord ? Infinity : bombLimit(state, state.turn) - (state.bombsUsed[state.turn] || 0))
      && guard++ < 12) {
      addLog(state, `${seatName(state.turn)} 没有可出的牌，自动跳过`);
      const skipSeat = state.turn;
      state.table = state.table.filter(a => a.seat !== skipSeat);
      state.table.push({ seat: skipSeat, cards: null });
      state.passCount++;
      if (state.passCount >= 2) { this._endTrick(state); break; }
      state.turn = (state.turn + 1) % N;
    }
  },

  // 结算：winSide=landlord|farmers；倍数 flags 以 state.mult 为准
  _settle(state, winSide, reason) {
    const m = state.mult;
    const mult = (m.huangfan ? 2 : 1) * (m.mingwang ? 2 : 1) * (m.touliao ? 2 : 1)
      * (m.tanda ? 2 : 1) * (m.baodao ? 2 : 1);
    const bid = state.maxBid;
    const landlordWin = winSide === 'landlord';
    const deltas = [0, 0, 0, 0];
    const dLand = (landlordWin ? 3 : -3) * bid * mult;
    const dFarmer = (landlordWin ? -1 : 1) * bid * mult;
    deltas[state.landlord] = dLand;
    for (let i = 0; i < N; i++) if (i !== state.landlord) deltas[i] = dFarmer;
    for (let i = 0; i < N; i++) state.scores[i] += deltas[i];
    state.settle = { winSide, reason, bid, mult, deltas: deltas.slice() };
    state.over = true;
    state.winSide = winSide;
    state.winner = state.landlord; // 供前端通用判定
    state.phase = 'over';
    addLog(state, `结算：${landlordWin ? '地主胜' : '农民胜'}，叫 ${bid} 分 ×${mult} 倍，积分 ${deltas.map(d => (d > 0 ? '+' : '') + d).join('/')}`);
  },

  view(state, seat) {
    return {
      phase: state.phase,
      turn: state.turn, landlord: state.landlord,
      bids: state.bids, maxBid: state.maxBid, bidStarter: state.bidStarter,
      turnStart: state.turnStart, turnTimeout: 25,
      bottom: state.phase === 'bid' ? [] : state.bottom, // 叫分阶段底牌保密
      bottomCnt: BOTTOM_CNT,
      hand: state.hands[seat],
      counts: state.hands.map(h => h.length),
      lastCards: state.lastCards || [],
      plays: state.plays,
      table: state.table || [], round: state.round || 1,
      mustPlay: state.phase === 'play' && (!state.last || state.lastSeat === seat),
      winner: state.winner, winSide: state.winSide, over: state.over, log: state.log,
      // 积分/倍数/特殊规则
      scores: state.scores,
      mult: state.mult,
      markedCard: state.markedCard,
      baodaoEligible: seat === state.landlord ? state.baodaoEligible : false,
      bombsUsed: state.bombsUsed,
      bombLimit: [0, 1, 2, 3].map(i => {
        const v = bombLimit(state, i);
        return v === Infinity ? -1 : v; // -1 表示地主无限
      }),
      settle: state.settle,
    };
  },

  // 超时自动行动
  timeoutAction(state, seat) {
    if (state.phase === 'bid') return { op: 'bid', score: 0 };
    if (state.phase === 'declare') return { op: 'declare', tanda: false };
    if (!state.last || state.lastSeat === seat) return { op: 'play', ids: [state.hands[seat][0].id] };
    return { op: 'pass' };
  },

  // 电脑策略（保持简单）
  bot(state, seat) {
    const h = state.hands[seat];
    if (state.phase === 'bid') {
      const cnt = {};
      let power = 0;
      for (const c of h) {
        cnt[c.v] = (cnt[c.v] || 0) + 1;
        if (c.v >= 16) power += 2.5;
        else if (c.v === 15) power += 1.5;
        else if (c.v === 14) power += 0.8;
      }
      for (const v in cnt) {
        if (cnt[v] >= 4) power += cnt[v] === 4 ? 4 : cnt[v] * 1.5; // 两副牌炸弹更多
      }
      let score = power >= 9 ? 3 : power >= 6.5 ? 2 : power >= 5 ? 1 : 0;
      if (score <= state.maxBid) score = 0;
      return { op: 'bid', score };
    }
    if (state.phase === 'declare') {
      // 有四王时报到不打；其余一律正常打、不摊打
      if (state.baodaoEligible) {
        const cnt = countVals(h);
        if (cnt[16] >= 2 && cnt[17] >= 2) return { op: 'baodao_pass' };
      }
      return { op: 'declare', tanda: false };
    }
    // 报到锁定的 7+ 炸弹不可拆开，选牌时必须整体绕开/整体打出
    const locked = new Set(state.lockedVals || []);
    // 领出：最小单张（简单策略）；若只剩锁定炸弹则整体打出
    if (!state.last || state.lastSeat === seat) {
      const c = h.find(x => !locked.has(x.v));
      if (c) return { op: 'play', ids: [c.id] };
      return { op: 'play', ids: h.map(x => x.id) };
    }
    const pat = state.last;
    // 只跟单张/对子，不出炸弹（且不拆锁定炸弹）
    if (pat.type === 'single') {
      const c = h.find(x => x.v > pat.main && !locked.has(x.v));
      if (c) return { op: 'play', ids: [c.id] };
    } else if (pat.type === 'pair') {
      for (const c of h) {
        if (locked.has(c.v)) continue;
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

// 本局炸弹次数上限：地主无限；农民不叫/叫1分→1次，叫2分→2次
function bombLimit(state, seat) {
  if (seat === state.landlord) return Infinity;
  const bid = state.bids[seat] || 0;
  return bid >= 2 ? 2 : 1;
}
