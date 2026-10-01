// 游戏大厅服务器：HTTP 静态服务 + WebSocket 房间管理
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const GAMES = {
  sanguosha: { name: '三国杀', mod: require('./games/sanguosha') },
  uno: { name: 'UNO', mod: require('./games/uno') },
  monopoly: { name: '大富翁', mod: require('./games/monopoly') },
  mahjong: { name: '麻将', mod: require('./games/mahjong') },
  majiang_text: { name: '文字麻将', mod: require('./games/majiang_text') },
  doudizhu: { name: '斗地主', mod: require('./games/doudizhu') },
  guandan: { name: '掼蛋', mod: require('./games/guandan') },
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(__dirname, 'public', path.normalize(p).replace(/^([.][.][/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store', // 禁用缓存，保证每次加载最新代码
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

let nextPlayerId = 1;
let nextRoomId = 1000;
let nextBotId = -1; // 电脑玩家使用负数 ID
const rooms = new Map(); // id -> room
const tokenToPlayer = new Map(); // 浏览器持久 token -> playerId（刷新/重开后找回身份）

// 昵称/头像清洗：昵称限12字、去换行；头像仅允许 emoji 或 dataURL 图片（限长）
function cleanName(s) { s = ('' + (s ?? '')).trim().replace(/[\r\n\t]/g, ' '); return s.slice(0, 12); }
function cleanAvatar(s) {
  s = '' + (s ?? '');
  if (s.length > 40000) return '';
  if (s.startsWith('data:image/')) return s;
  // emoji/符号：去掉换行与危险字符，限 8 个字符
  return s.replace(/[\r\n\t<>]/g, '').slice(0, 8);
}
// 电脑玩家头像与昵称（按序号循环）
const BOT_AVATARS = ['🤖', '🐼', '🦊', '🐯', '🐸', '🐵', '🐰', '🐨'];
function botProfile(id) {
  const n = -id;
  return { name: '电脑' + n, avatar: BOT_AVATARS[(n - 1) % BOT_AVATARS.length] };
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function roomInfo(room) {
  return {
    id: room.id, game: room.game, gameName: GAMES[room.game].name,
    max: GAMES[room.game].mod.maxPlayers,
    players: room.players.map(p => ({
      id: p.id, seat: p.seat, online: !!p.ws, bot: !!p.bot,
      name: p.bot ? (p.name || botProfile(p.id).name) : (p.name || '玩家' + p.id),
      avatar: p.bot ? (p.avatar || botProfile(p.id).avatar) : (p.avatar || ''),
    })),
    started: room.started, host: room.host, paused: !!room.paused,
    over: !!(room.state && room.state.over),
  };
}

function broadcastRoom(room) {
  const info = roomInfo(room);
  for (const p of room.players) if (p.ws) send(p.ws, { t: 'room', room: info });
}

function broadcastState(room) {
  if (room.paused) return;
  for (const p of room.players) {
    if (!p.ws) continue;
    send(p.ws, { t: 'state', s: GAMES[room.game].mod.view(room.state, p.seat) });
  }
  scheduleBots(room);
}

// 找出当前需要行动的电脑座位；没有则返回 -1
function botToAct(room) {
  const st = room.state;
  if (!st || st.over) return -1;
  if (st.pending) {
    const pl = room.players[st.pending.to];
    return pl && pl.bot ? st.pending.to : -1;
  }
  if (st.claim) {
    for (const s of Object.keys(st.claim.asks)) {
      const seat = +s;
      if (room.players[seat] && room.players[seat].bot && st.claim.responses[seat] === undefined) return seat;
    }
    return -1;
  }
  const pl = room.players[st.turn];
  return pl && pl.bot ? st.turn : -1;
}

// 调度电脑行动：每次只安排一个，行动后经 broadcastState 链式触发下一个
const BOT_DELAY = process.env.BOT_DELAY !== undefined ? +process.env.BOT_DELAY : 650;
function clearTimers(room) {
  clearTimeout(room.botTimer);
  clearTimeout(room.turnTimer);
}
function scheduleBots(room) {
  clearTimers(room);
  // 回合并行限时：支持 timeoutAction 的游戏（斗地主/掼蛋）25 秒超时自动行动
  const mod0 = GAMES[room.game].mod;
  if (room.state && !room.state.over && !room.paused && typeof mod0.timeoutAction === 'function') {
    const ts = room.state.turnStart, tseat = room.state.turn;
    room.turnTimer = setTimeout(() => {
      if (!room.state || room.state.over || room.paused) return;
      if (room.state.turn !== tseat || room.state.turnStart !== ts) return; // 已换回合
      room.state.log.push(`玩家${tseat + 1} 超时未行动，自动处理`);
      const err = mod0.act(room.state, tseat, mod0.timeoutAction(room.state, tseat));
      if (err) console.log('[timer] 动作被拒:', err);
      broadcastState(room);
    }, 25500);
  }
  const seat = botToAct(room);
  if (seat < 0) return;
  room.botTimer = setTimeout(() => {
    const mod = GAMES[room.game].mod;
    if (typeof mod.bot !== 'function' || !room.state || room.state.over) return;
    const a = mod.bot(room.state, seat);
    if (a) {
      const err = mod.act(room.state, seat, a);
      if (err) console.log(`[bot] ${room.game} seat${seat} 动作被拒:`, err, JSON.stringify(a));
    }
    broadcastState(room);
  }, BOT_DELAY + Math.random() * Math.min(600, BOT_DELAY));
}

function leaveRoom(client) {
  const room = client.roomId ? rooms.get(client.roomId) : null;
  if (!room) return;
  const p = room.players.find(x => x.id === client.playerId);
  if (p) p.ws = null;
  client.roomId = null;
  // 游戏进行中时，离线不销毁房间（保留游戏进度），并自动暂停等待回归
  if (room.started && !room.state?.over) {
    if (!room.paused) {
      room.paused = true;
      clearTimers(room);
      for (const q of room.players) if (q.ws) send(q.ws, { t: 'paused', paused: true });
    }
    broadcastRoom(room);
    broadcastLobby();
    return;
  }
  // 没有任何在线人类玩家时销毁房间（电脑不算）
  if (!room.players.some(x => x.ws && !x.bot)) {
    clearTimers(room);
    rooms.delete(room.id);
    return;
  }
  if (!room.started) {
    // 未开始：移掉线的人类，电脑保留
    room.players = room.players.filter(x => x.ws || x.bot);
    room.players.forEach((x, i) => (x.seat = i));
    if (room.host === client.playerId) {
      const h = room.players.find(x => x.ws && !x.bot);
      if (h) room.host = h.id;
    }
  }
  broadcastRoom(room);
  broadcastLobby();
}

function addBot(room) {
  const max = GAMES[room.game].mod.maxPlayers;
  if (room.players.length >= max) return false;
  const id = nextBotId--;
  room.players.push({ id, seat: room.players.length, ws: null, bot: true, ...botProfile(id) });
  return true;
}

function broadcastLobby() {
  const list = [...rooms.values()].map(roomInfo);
  for (const ws of wss.clients) if (ws.readyState === 1 && !ws._client.roomId) send(ws, { t: 'lobby', rooms: list });
}

// 恢复玩家连接：发房间信息 + 游戏状态 + 暂停标志（暂停时 broadcastState 不会发，需直接下发）
function rejoinRoom(ws, client, room, player) {
  player.ws = ws;
  client.roomId = room.id;
  send(ws, { t: 'room', room: roomInfo(room) });
  send(ws, { t: 'chatLog', msgs: room.chat || [] });
  if (room.started && room.state) {
    send(ws, { t: 'state', s: GAMES[room.game].mod.view(room.state, player.seat) });
    if (room.paused) send(ws, { t: 'paused', paused: true });
  }
  broadcastRoom(room);
  broadcastLobby();
}

wss.on('connection', ws => {
  const client = { playerId: nextPlayerId++, roomId: null, name: '', avatar: '' };
  ws._client = client;
  send(ws, { t: 'me', id: client.playerId, name: '玩家' + client.playerId, avatar: '' });
  broadcastLobby();

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'hello') {
      // 用持久 token 找回身份：刷新/重开浏览器后恢复原 playerId 并自动回房
      const oldId = tokenToPlayer.get(m.token);
      if (typeof oldId === 'number' && oldId !== client.playerId) {
        // 若旧连接还开着（刷新竞态），把它作废，避免其 close 事件误伤新连接
        for (const c of wss.clients) {
          if (c !== ws && c._client.playerId === oldId) {
            c._client.roomId = null;
            c._client.playerId = -1;
            try { send(c, { t: 'replaced' }); c.close(); } catch {}
          }
        }
        client.playerId = oldId;
      } else {
        tokenToPlayer.set(m.token, client.playerId);
      }
      // 接收浏览器保存的昵称/头像
      client.name = cleanName(m.name) || ('玩家' + client.playerId);
      client.avatar = cleanAvatar(m.avatar);
      send(ws, { t: 'me', id: client.playerId, name: client.name, avatar: client.avatar });
      // 该身份若在某个房间里（中途掉线/退出），自动恢复，并同步资料
      for (const room of rooms.values()) {
        const p = room.players.find(x => x.id === client.playerId);
        if (p) {
          p.name = client.name; p.avatar = client.avatar;
          rejoinRoom(ws, client, room, p); return;
        }
      }
      broadcastLobby();
      return;
    }

    // 随时修改昵称/头像（大厅或房间内均可）
    if (m.t === 'profile') {
      client.name = cleanName(m.name) || ('玩家' + client.playerId);
      client.avatar = cleanAvatar(m.avatar);
      send(ws, { t: 'me', id: client.playerId, name: client.name, avatar: client.avatar });
      const room = client.roomId ? rooms.get(client.roomId) : null;
      if (room) {
        const p = room.players.find(x => x.id === client.playerId);
        if (p) { p.name = client.name; p.avatar = client.avatar; }
        broadcastRoom(room);
      }
      broadcastLobby();
      return;
    }

    if (m.t === 'create') {
      if (client.roomId) leaveRoom(client);
      const g = GAMES[m.game] ? m.game : 'uno';
      const room = {
        id: nextRoomId++, game: g, host: client.playerId,
        players: [{ id: client.playerId, seat: 0, ws, name: client.name || ('玩家' + client.playerId), avatar: client.avatar || '' }],
        started: false, state: null, chat: [],
      };
      rooms.set(room.id, room);
      client.roomId = room.id;
      send(ws, { t: 'room', room: roomInfo(room) });
      broadcastLobby();
      return;
    }

    if (m.t === 'join') {
      if (client.roomId) leaveRoom(client);
      const room = rooms.get(m.roomId);
      if (!room) return send(ws, { t: 'error', msg: '房间不存在' });
      const max = GAMES[room.game].mod.maxPlayers;
      // 检查是否是重新加入（玩家已在房间中）
      const existing = room.players.find(p => p.id === client.playerId);
      if (existing) {
        rejoinRoom(ws, client, room, existing);
        return;
      }
      if (room.players.length >= max) return send(ws, { t: 'error', msg: '房间已满' });
      if (room.started && !room.paused) return send(ws, { t: 'error', msg: '游戏已开始' });
      room.players.push({ id: client.playerId, seat: room.players.length, ws, name: client.name || ('玩家' + client.playerId), avatar: client.avatar || '' });
      client.roomId = room.id;
      send(ws, { t: 'chatLog', msgs: room.chat || [] });
      broadcastRoom(room);
      broadcastLobby();
      return;
    }

    if (m.t === 'leave') { leaveRoom(client); broadcastLobby(); return; }

    if (m.t === 'deleteRoom') {
      const room = rooms.get(m.roomId);
      if (!room) return;
      // 房主可删；房主离线时房间成员也可删；没有任何真人在线时任何人都可删（避免僵尸房间）
      const isMember = room.players.some(p => p.id === client.playerId);
      const hostOnline = room.players.some(p => p.id === room.host && p.ws);
      const anyHumanOnline = room.players.some(p => p.ws && !p.bot);
      if (!(room.host === client.playerId || (isMember && !hostOnline) || !anyHumanOnline)) {
        return send(ws, { t: 'error', msg: '只有房主可以删除房间' });
      }
      clearTimers(room);
      // 通知房间内所有在线玩家回大厅
      for (const p of room.players) {
        if (p.ws) {
          send(p.ws, { t: 'roomDeleted', roomId: room.id });
          if (p.ws._client) p.ws._client.roomId = null;
        }
      }
      rooms.delete(room.id);
      broadcastLobby();
      return;
    }

    if (m.t === 'addBot' || m.t === 'fillBots') {
      const room = rooms.get(client.roomId);
      if (!room || room.started) return;
      if (room.host !== client.playerId) return send(ws, { t: 'error', msg: '只有房主可以添加电脑' });
      if (m.t === 'addBot') addBot(room);
      else while (addBot(room)) { /* 填满 */ }
      broadcastRoom(room);
      broadcastLobby();
      return;
    }

    if (m.t === 'switchGame') {
      const room = rooms.get(client.roomId);
      if (!room || room.started) return;
      if (room.host !== client.playerId) return send(ws, { t: 'error', msg: '只有房主可以切换游戏' });
      if (!GAMES[m.game]) return;
      const max = GAMES[m.game].mod.maxPlayers;
      // 超员时自动移除多余电脑
      while (room.players.length > max) {
        const idx = room.players.map(p => !!p.bot).lastIndexOf(true);
        if (idx < 0) return send(ws, { t: 'error', msg: `当前人数超过${GAMES[m.game].name}上限（${max}人）` });
        room.players.splice(idx, 1);
      }
      room.players.forEach((x, i) => (x.seat = i));
      room.game = m.game;
      broadcastRoom(room);
      broadcastLobby();
      return;
    }

    if (m.t === 'start') {
      const room = rooms.get(client.roomId);
      if (!room) return;
      const mod = GAMES[room.game].mod;
      if (room.started && !(room.state && room.state.over)) return;
      if (room.players.length !== mod.maxPlayers) return send(ws, { t: 'error', msg: `需要满 ${mod.maxPlayers} 人才能开始（可添加电脑玩家）` });
      clearTimers(room);
      room.started = true;
      room.state = mod.init(room.players, room.state); // 传入旧局：跨局累计积分/荒番延续（其他游戏忽略此参数）
      broadcastRoom(room);
      broadcastState(room);
      broadcastLobby();
      return;
    }

    if (m.t === 'act') {
      const room = rooms.get(client.roomId);
      if (!room || !room.started || !room.state || room.paused) return;
      const p = room.players.find(x => x.id === client.playerId);
      if (!p) return;
      const mod = GAMES[room.game].mod;
      const err = mod.act(room.state, p.seat, m.a || {});
      if (err) send(ws, { t: 'error', msg: err });
      else broadcastState(room);
      return;
    }

    if (m.t === 'chat') {
      const room = client.roomId ? rooms.get(client.roomId) : null;
      if (!room) return;
      const p = room.players.find(x => x.id === client.playerId);
      if (!p) return;
      const text = ('' + (m.text ?? '')).trim().replace(/[\r\n\t]/g, ' ').replace(/[<>]/g, '').slice(0, 40);
      if (!text) return;
      const msg = { seat: p.seat, name: p.name || ('玩家' + p.id), avatar: p.avatar || '', text, time: Date.now() };
      room.chat.push(msg);
      if (room.chat.length > 50) room.chat.shift(); // 只留存最近 50 条
      for (const q of room.players) if (q.ws) send(q.ws, { t: 'chat', msg });
      return;
    }

    if (m.t === 'pause') {
      const room = rooms.get(client.roomId);
      if (!room || !room.started || !room.state || room.state.over) return;
      room.paused = !room.paused;
      if (room.paused) clearTimers(room);
      else {
        if (room.state.turnStart) room.state.turnStart = Date.now(); // 恢复后重新计时
        broadcastState(room); // 下发最新状态（含新的计时起点），内部会重新调度
      }
      for (const p of room.players) if (p.ws) send(p.ws, { t: 'paused', paused: room.paused });
      return;
    }

    if (m.t === 'quitGame') {
      const room = rooms.get(client.roomId);
      if (!room || !room.started) return;
      const p = room.players.find(x => x.id === client.playerId);
      if (!p) return;
      // 标记离线但不离开房间
      p.ws = null;
      client.roomId = null;
      // 游戏已结束且没有在线人类玩家时，直接销毁房间（避免僵尸房间堆积）
      if (room.state && room.state.over && !room.players.some(x => x.ws && !x.bot)) {
        clearTimers(room);
        rooms.delete(room.id);
        broadcastLobby();
        return;
      }
      // 游戏进行中才暂停；已结束的不用暂停
      if (!(room.state && room.state.over) && !room.paused) {
        room.paused = true;
        clearTimers(room);
        for (const q of room.players) if (q.ws) send(q.ws, { t: 'paused', paused: true });
      }
      broadcastRoom(room);
      broadcastLobby();
      return;
    }
  });

  ws.on('close', () => { leaveRoom(client); broadcastLobby(); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`游戏大厅已启动: http://0.0.0.0:${PORT}`);
  console.log(`本机访问: http://localhost:${PORT}`);
});
