// 大富翁：掷骰子、走格子、买地、收租、机会/命运
const { shuffle, addLog } = require('./util');

// 24 格环形地图
function buildBoard() {
  const b = [];
  b.push({ type: 'start', name: '起点' });
  const names = ['台北', '香港', '上海', '北京', '东京', '首尔', '曼谷', '新加坡', '悉尼', '伦敦', '巴黎', '柏林', '罗马', '纽约', '洛杉矶', '多伦多'];
  let ni = 0;
  for (let i = 1; i < 24; i++) {
    if (i === 6) b.push({ type: 'jail', name: '监狱' });
    else if (i === 12) b.push({ type: 'park', name: '免费停车场' });
    else if (i === 18) b.push({ type: 'gotojail', name: '进监狱' });
    else if (i === 3) b.push({ type: 'tax', name: '所得税', amount: 200 });
    else if (i === 15) b.push({ type: 'tax', name: '印花税', amount: 150 });
    else if (i % 4 === 3) b.push({ type: 'chance', name: '机会' });
    else {
      const price = 100 + Math.floor(i / 4) * 60;
      b.push({ type: 'land', name: names[ni++ % names.length], price, rent: price });
    }
  }
  return b;
}

const CHANCES = [
  { text: '中彩票 +200', money: 200 },
  { text: '罚款 -150', money: -150 },
  { text: '银行分红 +100', money: 100 },
  { text: '修房子 -100', money: -100 },
  { text: '直接前进到起点', goto: 0 },
  { text: '后退3格', move: -3 },
  { text: '前进3格', move: 3 },
];

function alivePlayers(state) {
  return state.players.map((p, i) => (p.alive ? i : -1)).filter(i => i >= 0);
}

function checkOver(state) {
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    state.over = true; state.winner = alive[0];
    addLog(state, `玩家${alive[0] + 1} 成为大富翁！`);
    return true;
  }
  // 4 人局只剩 2 人时按资金结算（快速收尾，避免双人僵局）
  if (state.players.length >= 3 && alive.length === 2) {
    const w = state.players[alive[0]].money >= state.players[alive[1]].money ? alive[0] : alive[1];
    state.over = true; state.winner = w;
    addLog(state, `只剩两名玩家，按资金结算，玩家${w + 1} 获胜！`);
    return true;
  }
  return false;
}

function bankrupt(state, seat, to) {
  const p = state.players[seat];
  if (p.money >= 0) return;
  // 卖光地产抵债（简化：直接破产）
  p.alive = false;
  for (const t of state.board) if (t.owner === seat) delete t.owner;
  addLog(state, `玩家${seat + 1} 破产出局`);
  checkOver(state);
}

function move(state, seat, steps) {
  const p = state.players[seat];
  const old = p.pos;
  p.pos = (p.pos + steps + 24) % 24;
  if (steps > 0 && p.pos < old) { p.money += 200; addLog(state, `玩家${seat + 1} 经过起点，+200`); }
}

function resolveTile(state, seat) {
  const p = state.players[seat];
  const tile = state.board[p.pos];
  addLog(state, `玩家${seat + 1} 走到【${tile.name}】`);
  if (tile.type === 'land') {
    if (tile.owner === undefined) {
      if (p.money >= tile.price) { state.phase = 'buy'; return; } // 等待购买决策
      addLog(state, '资金不足，无法购买');
    } else if (tile.owner !== seat) {
      p.money -= tile.rent;
      state.players[tile.owner].money += tile.rent;
      addLog(state, `玩家${seat + 1} 向 玩家${tile.owner + 1} 支付租金 ${tile.rent}`);
      bankrupt(state, seat);
    }
  } else if (tile.type === 'tax') {
    p.money -= tile.amount;
    addLog(state, `缴纳【${tile.name}】-${tile.amount}`);
    bankrupt(state, seat);
  } else if (tile.type === 'chance') {
    const c = state.chances.pop();
    state.chances.unshift(c);
    addLog(state, `机会：${c.text}`);
    if (c.money) { p.money += c.money; bankrupt(state, seat); }
    if (c.goto !== undefined) p.pos = c.goto;
    if (c.move) { move(state, seat, c.move); resolveTile(state, seat); return; }
  } else if (tile.type === 'gotojail') {
    p.pos = 6; p.jail = 1;
    addLog(state, `玩家${seat + 1} 被送进监狱，停一回合`);
  }
  state.phase = 'end';
}

function nextTurn(state) {
  const n = state.players.length;
  do { state.turn = (state.turn + 1) % n; } while (!state.players[state.turn].alive);
  state.phase = 'roll';
}

module.exports = {
  maxPlayers: 4,

  init(players) {
    const state = {
      board: buildBoard(),
      players: players.map(() => ({ pos: 0, money: 1000, alive: true, jail: 0 })),
      chances: shuffle(CHANCES.slice()),
      turn: 0, phase: 'roll', dice: [1, 1],
      winner: -1, over: false, log: [],
    };
    addLog(state, '游戏开始，每人 1500 资金');
    return state;
  },

  act(state, seat, a) {
    if (state.over) return '游戏已结束';
    if (seat !== state.turn) return '还没轮到你';
    const p = state.players[seat];

    if (a.op === 'roll') {
      if (state.phase !== 'roll') return '现在不能掷骰子';
      if (p.jail > 0) { p.jail--; addLog(state, `玩家${seat + 1} 在监狱中停一回合`); nextTurn(state); return null; }
      state.dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
      const steps = state.dice[0] + state.dice[1];
      addLog(state, `玩家${seat + 1} 掷出 ${state.dice[0]}+${state.dice[1]}=${steps}`);
      move(state, seat, steps);
      resolveTile(state, seat);
      if (state.over) return null;
      if (state.phase === 'end') { nextTurn(state); }
      return null;
    }

    if (a.op === 'buy') {
      if (state.phase !== 'buy') return '现在不能购买';
      const tile = state.board[p.pos];
      p.money -= tile.price;
      tile.owner = seat;
      addLog(state, `玩家${seat + 1} 购买了【${tile.name}】（-${tile.price}）`);
      nextTurn(state);
      return null;
    }

    if (a.op === 'skip') {
      if (state.phase !== 'buy') return '无效操作';
      addLog(state, `玩家${seat + 1} 放弃购买`);
      nextTurn(state);
      return null;
    }
    return '未知操作';
  },

  view(state, seat) {
    return {
      board: state.board,
      players: state.players,
      turn: state.turn, phase: state.phase, dice: state.dice,
      me: seat,
      winner: state.winner, over: state.over, log: state.log,
    };
  },

  // 电脑策略：自动掷骰，遇到无主地直接购买
  bot(state, seat) {
    if (state.phase === 'roll') return { op: 'roll' };
    if (state.phase === 'buy') return { op: 'buy' };
    return { op: 'skip' };
  },
};
