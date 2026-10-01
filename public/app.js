/* 游戏大厅前端：大厅/房间/7 个游戏渲染 */
const $ = id => document.getElementById(id);
const GAMES = [
  ['sanguosha', '三国杀'], ['uno', 'UNO'], ['monopoly', '大富翁'],
  ['mahjong', '麻将'], ['majiang_text', '文字麻将'], ['doudizhu', '斗地主'], ['guandan', '掼蛋'],
];
const GAME_NAME = Object.fromEntries(GAMES);

let ws, myId = null, myRoom = null, mySeat = -1, lastState = null, sel = new Set();
let myName = localStorage.getItem('playerName') || '';
let myAvatar = localStorage.getItem('playerAvatar') || '';
let gameStartTime = null;
let isPaused = false;
let replaced = false; // 身份被其他窗口接管时不再自动重连
// 房间发言：消息留存（服务器保存最近 50 条），切换房间时清空
let chatMsgs = [], chatRoomId = null, chatOpen = false;

// 持久身份 token：刷新/重开浏览器后仍能找回房间继续游戏
let myToken = localStorage.getItem('playerToken');
if (!myToken) {
  myToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('playerToken', myToken);
}

function connect() {
  replaced = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ t: 'hello', token: myToken, name: myName, avatar: myAvatar });
  ws.onclose = () => {
    if (replaced) { toast('此页面已在其他窗口打开，本页已断开'); return; }
    toast('连接断开，3秒后重连…'); setTimeout(connect, 3000);
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'me') {
      myId = m.id;
      if (m.name) myName = m.name;
      if (typeof m.avatar === 'string') myAvatar = m.avatar;
      renderMeChip();
    }
    else if (m.t === 'lobby') {
      // 自愈：若我"所在"的房间已不存在（被删除等），清理状态确保回到大厅
      if (myRoom && !m.rooms.some(r => r.id === myRoom.id)) {
        myRoom = null; lastState = null; isPaused = false; gameStartTime = null;
        $('pauseOverlay').classList.add('hidden');
      }
      renderLobby(m.rooms);
    }
    else if (m.t === 'room') {
      myRoom = m.room;
      if (chatRoomId !== m.room.id) { chatMsgs = []; chatRoomId = m.room.id; }
      renderRoom();
      // 回到房间页时重置暂停状态
      isPaused = false;
      $('pauseOverlay').classList.add('hidden');
    }
    else if (m.t === 'state') {
      const wasOver = lastState && lastState.over;
      lastState = m.s; sel.clear(); showPage('game'); renderGame();
      if (!wasOver && lastState.over) saveHistory();
      $('gameActions').classList.remove('hidden');
    }
    else if (m.t === 'paused') {
      isPaused = m.paused;
      $('pauseOverlay').classList.toggle('hidden', !isPaused);
      $('gameStatus').textContent = isPaused ? '⏸️ 已暂停' : '';
      $('pauseBtn').textContent = isPaused ? '▶️ 继续' : '⏸️ 暂停';
    }
    else if (m.t === 'roomDeleted') {
      // 房间被删除：如果我正在该房间，回大厅
      if (myRoom && myRoom.id === m.roomId) {
        myRoom = null; lastState = null; isPaused = false; gameStartTime = null;
        $('pauseOverlay').classList.add('hidden');
        showPage('lobby');
        toast('房间已被删除');
      }
    }
    else if (m.t === 'replaced') { replaced = true; }
    else if (m.t === 'chatLog') {
      if (myRoom && chatRoomId !== myRoom.id) chatMsgs = [];
      if (myRoom) chatRoomId = myRoom.id;
      chatMsgs = Array.isArray(m.msgs) ? m.msgs : [];
      renderChatPanel();
    }
    else if (m.t === 'chat') {
      chatMsgs.push(m.msg);
      if (chatMsgs.length > 50) chatMsgs.shift();
      renderChatPanel();
    }
    else if (m.t === 'error') { toast(m.msg); }
  };
}

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
function showPage(p) {
  ['lobby', 'room', 'game'].forEach(x => $(x).classList.toggle('hidden', x !== p));
  // 斗地主游戏页：切换成斗地主背景图，其它页面用大厅默认背景
  const isDDZGame = p === 'game' && myRoom && myRoom.game === 'doudizhu';
  document.body.classList.toggle('bg-ddz', isDDZGame);
}
function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

/* ---------- 昵称 / 头像（仅支持上传自定义图片，圆角方形） ---------- */
// 头像渲染：dataURL 图片用 img；无头像时用昵称首字占位（电脑仍可显示 emoji）
function avatarInner(av, name) {
  if (av && av.startsWith('data:image/')) return `<img src="${av}" alt="">`;
  if (av) return esc(av); // 电脑玩家的 emoji
  return esc((name || '玩').trim()[0] || '玩');
}
function avatarHtml(av, cls = 'ava', name) { return `<span class="${cls}">${avatarInner(av, name)}</span>`; }
function playerBySeat(seat) { return myRoom && myRoom.players.find(x => x.seat === seat); }
function nameOf(seat) {
  const p = playerBySeat(seat);
  if (p) return p.name || (p.bot ? '电脑' : ('玩家' + (seat + 1)));
  return '玩家' + (seat + 1);
}
function avatarOf(seat) {
  const p = playerBySeat(seat);
  return p ? (p.avatar || (p.bot ? '🤖' : '')) : '';
}
// 大厅左上角「我的资料」小芯片
function renderMeChip() {
  const chip = $('meChip');
  const name = myName || (myId ? '玩家' + myId : '…');
  if (chip) chip.innerHTML = `${avatarHtml(myAvatar, 'ava sm', name)}<span class="me-name">${esc(name)}</span>`;
}

/* ---- 图片裁剪：方形框内拖动 + 缩放，保存时输出 160px 方形头像 ---- */
const crop = { img: null, W: 0, H: 0, base: 1, zoom: 1, ox: 0, oy: 0, box: 220 };
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 直接用像素宽高 + left/top 定位（不使用 transform 的百分比位移，避免大图被移到框外）
function cropRender() {
  if (!crop.img) return;
  const s = crop.base * crop.zoom;
  const dw = crop.W * s, dh = crop.H * s;
  const el = $('cropImg');
  el.style.width = dw + 'px';
  el.style.height = dh + 'px';
  el.style.left = ((crop.box - dw) / 2 + crop.ox) + 'px';
  el.style.top = ((crop.box - dh) / 2 + crop.oy) + 'px';
  // 预览同步
  const pv = $('profileAvaPreview');
  if (pv) pv.innerHTML = `<img src="${exportCrop()}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:22%">`;
}
// 打开文件 → 载入裁剪器
function loadCropFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('请选择图片文件'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      crop.img = img; crop.W = img.naturalWidth; crop.H = img.naturalHeight;
      // cover 铺满方形裁剪框所需的最小缩放（自然像素→裁剪框CSS像素）
      crop.base = Math.max(crop.box / crop.W, crop.box / crop.H);
      crop.zoom = 1; crop.ox = 0; crop.oy = 0;
      const el = $('cropImg');
      el.style.transform = '';
      el.src = url;
      $('cropWrap').classList.remove('hidden');
      $('cropZoom').value = 1;
      cropRender();
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}
// 输出裁剪结果：160×160 jpeg dataURL
function exportCrop() {
  const s = crop.base * crop.zoom;
  const sx = crop.W / 2 - crop.box / (2 * s) - crop.ox / s;
  const sy = crop.H / 2 - crop.box / (2 * s) - crop.oy / s;
  const sw = crop.box / s, sh = crop.box / s;
  const size = 160;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(crop.img, sx, sy, sw, sh, 0, 0, size, size);
  return cv.toDataURL('image/jpeg', 0.85);
}
// 绑定裁剪器拖动（鼠标 + 触摸）
function bindCropDrag() {
  const box = $('cropBox');
  let dragging = false, sx = 0, sy = 0, ox0 = 0, oy0 = 0;
  const move = (cx, cy) => {
    const s = crop.base * crop.zoom;
    const dw = crop.W * s, dh = crop.H * s;
    crop.ox = clamp(ox0 + cx - sx, (crop.box - dw) / 2, (dw - crop.box) / 2);
    crop.oy = clamp(oy0 + cy - sy, (crop.box - dh) / 2, (dh - crop.box) / 2);
    cropRender();
  };
  box.addEventListener('pointerdown', e => {
    if (!crop.img) return;
    dragging = true; sx = e.clientX; sy = e.clientY; ox0 = crop.ox; oy0 = crop.oy;
    box.setPointerCapture(e.pointerId);
  });
  box.addEventListener('pointermove', e => { if (dragging) move(e.clientX, e.clientY); });
  box.addEventListener('pointerup', () => { dragging = false; });
  box.addEventListener('pointercancel', () => { dragging = false; });
}
// 个人资料弹窗
function openProfile() {
  $('profileName').value = myName || '';
  crop.img = null;
  $('cropWrap').classList.add('hidden');
  $('profileAvaPreview').innerHTML = avatarInner(myAvatar, myName || '玩家');
  $('profileModal').classList.remove('hidden');
}
function closeProfile() { $('profileModal').classList.add('hidden'); }
function saveProfile(name, avatar) {
  myName = (name || '').trim().slice(0, 12) || (myId ? '玩家' + myId : '玩家');
  myAvatar = avatar || '';
  localStorage.setItem('playerName', myName);
  localStorage.setItem('playerAvatar', myAvatar);
  send({ t: 'profile', name: myName, avatar: myAvatar });
  renderMeChip();
}

/* ---------- 历史记录 ---------- */
function saveHistory() {
  if (!myRoom || !lastState || !lastState.over) return;
  const history = JSON.parse(localStorage.getItem('gameHistory') || '[]');
  const gameName = GAME_NAME[myRoom.game] || myRoom.game;
  const startTime = gameStartTime ? new Date(gameStartTime).toLocaleString() : '未知';
  const endTime = new Date().toLocaleString();
  let result = '平局';
  if (lastState.winner >= 0 || lastState.winSide) {
    if (myRoom.game === 'guandan') {
      result = (lastState.winner === (mySeat % 2)) ? '胜利' : '失败';
    } else if (myRoom.game === 'doudizhu' && lastState.winSide) {
      // 四人斗地主按阵营：任一农民出完即农民胜
      const amLandlord = lastState.landlord === mySeat;
      result = (lastState.winSide === 'landlord' ? amLandlord : !amLandlord) ? '胜利' : '失败';
    } else {
      result = (lastState.winner === mySeat) ? '胜利' : '失败';
    }
  }
  history.unshift({ game: gameName, startTime, endTime, result });
  localStorage.setItem('gameHistory', JSON.stringify(history.slice(0, 100)));
  gameStartTime = null;
}

function showHistory() {
  const history = JSON.parse(localStorage.getItem('gameHistory') || '[]');
  const box = $('historyList');
  if (!history.length) {
    box.innerHTML = '<p style="color:#888;text-align:center">暂无游戏记录</p>';
  } else {
    box.innerHTML = history.map(h => `
      <div style="background:#0f3460;border-radius:8px;padding:12px;margin-bottom:8px;font-size:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <b>${esc(h.game)}</b>
          <span style="color:${h.result === '胜利' ? '#2a2' : h.result === '失败' ? '#e94560' : '#aaa'}">${h.result}</span>
        </div>
        <div style="color:#999;font-size:12px">开始：${esc(h.startTime)}</div>
        <div style="color:#999;font-size:12px">结束：${esc(h.endTime)}</div>
      </div>`).join('');
  }
  $('historyModal').classList.remove('hidden');
}

/* ---------- 大厅 ---------- */
function renderLobby(rooms) {
  if (!myRoom) showPage('lobby');
  const box = $('roomList');
  if (!rooms.length) { box.innerHTML = '<p class="hint">暂无房间，创建一个吧</p>'; return; }
  box.innerHTML = rooms.map(r => {
    // 检查是否是我之前在的房间（玩家id在房间中，无论在线与否都可回去）
    const isMyOldRoom = r.players.some(p => p.id === myId);
    const canJoin = !r.started || isMyOldRoom;
    const status = r.over ? '·已结束' : r.started ? (r.paused ? '·已暂停' : '·进行中') : '';
    // 房主可删除；房主离线时成员也可删除；没有真人在线时任何人都可删除
    const hostOnline = r.players.some(p => p.id === r.host && p.online);
    const anyHumanOnline = r.players.some(p => p.online && !p.bot);
    const canDelete = r.host === myId || (isMyOldRoom && !hostOnline) || !anyHumanOnline;
    return `
    <div class="room-item">
      <div class="info"><span class="tag">#${r.id}</span>${esc(r.gameName)} ${r.players.length}/${r.max} ${status}${isMyOldRoom && r.started ? '（可重新加入）' : ''}</div>
      <div style="display:flex;gap:8px">
        <button onclick="joinRoom(${r.id})" ${!canJoin ? 'disabled' : ''}>${isMyOldRoom && r.started ? '重新加入' : '加入'}</button>
        ${canDelete ? `<button onclick="deleteRoom(${r.id}, this)" style="background:#7a2b3a">删除</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
window.joinRoom = id => send({ t: 'join', roomId: id });
// 两次点击确认删除（不用原生 confirm，避免内置浏览器弹窗异常）
window.deleteRoom = (id, btn) => {
  if (btn.dataset.armed) { send({ t: 'deleteRoom', roomId: id }); return; }
  btn.dataset.armed = '1';
  const old = btn.textContent;
  btn.textContent = '确认删除？';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = old; } }, 3000);
};

/* ---------- 房间 ---------- */
function isBot(seat) {
  const p = myRoom && myRoom.players.find(x => x.seat === seat);
  return !!(p && p.bot);
}

function renderRoom() {
  if (!myRoom) { showPage('lobby'); return; }
  const started = myRoom.started && !(lastState && lastState.over);
  if (!started) showPage('room');
  $('roomTitle').textContent = GAME_NAME[myRoom.game];
  $('roomIdText').textContent = myRoom.id;
  $('roomGameSelect').value = myRoom.game;
  const me = myRoom.players.find(p => p.id === myId);
  mySeat = me ? me.seat : -1;
  const isHost = myRoom.host === myId;
  let html = '';
  for (let i = 0; i < myRoom.max; i++) {
    const p = myRoom.players.find(x => x.seat === i);
    if (p) {
      const tags = (p.bot ? '<span class="badge">电脑</span>' : '')
        + (p.id === myRoom.host ? '<span class="badge">房主</span>' : '')
        + (p.online ? '' : '<span class="badge">离线</span>');
      html += `<div class="slot">${avatarHtml(p.avatar || (p.bot ? '🤖' : ''), 'ava', p.name || ('玩家' + (i + 1)))}<span class="slot-name">${esc(p.name || ('玩家' + (i + 1)))}${p.id === myId ? '（我）' : ''}</span> ${tags}</div>`;
    } else {
      html += `<div class="slot empty">等待加入…${isHost ? '<br><button data-addbot style="margin-top:6px;padding:4px 12px;font-size:13px">＋ 添加电脑</button>' : ''}</div>`;
    }
  }
  $('playerSlots').innerHTML = html;
  document.querySelectorAll('[data-addbot]').forEach(b => b.onclick = () => send({ t: 'addBot' }));
  $('startBtn').disabled = myRoom.players.length !== myRoom.max;
  $('startBtn').textContent = lastState && lastState.over ? '再来一局' : '开始游戏';
}

/* ---------- 游戏渲染 ---------- */
function seatLabel(s) {
  return `${nameOf(s)}${s === mySeat ? '(我)' : ''}`;
}

function opponentsBar(s, extra) {
  const n = s.counts ? s.counts.length : (s.players ? s.players.length : 4);
  let html = '<div class="opponents">';
  for (let i = 0; i < n; i++) {
    if (i === mySeat) continue;
    const dead = s.players && s.players[i] && s.players[i].alive === false;
    const cnt = s.counts ? ` · ${s.counts[i]}张` : '';
    const hp = s.players && s.players[i] && s.players[i].hp !== undefined ? ` · ${s.players[i].hp}血` : '';
    html += `<div class="opp ${s.turn === i ? 'active' : ''} ${dead ? 'dead' : ''}" data-seat="${i}">${avatarHtml(avatarOf(i), 'ava xs', nameOf(i))}${seatLabel(i)}${cnt}${hp}${extra ? extra(i) : ''}</div>`;
  }
  return html + '</div>';
}

/* 圆桌布局：对手围坐在牌桌四周（按座次顺序），自己在下方；centerHTML 为牌桌中央内容；insideFelt 为桌面内附加内容（如出牌区） */
function tableRing(s, centerHTML, extra, insideFelt, opts) {
  const n = s.counts ? s.counts.length : (s.players ? s.players.length : 4);
  const posMap = { 2: ['st-top'], 3: ['st-topleft', 'st-topright'], 4: ['st-left', 'st-top', 'st-right'] };
  const pos = posMap[n] || posMap[4];
  const showCnt = !opts || opts.showCnt !== false;
  const cardBack = opts && opts.cardBack;
  const compact = opts && opts.compact; // 扑克紧凑模式：座位框缩小，张数/倒计时并入框内
  let seats = '', badges = '', clocks = '';
  for (let k = 1; k < n; k++) {
    const i = (mySeat + k) % n;
    const dead = s.players && s.players[i] && s.players[i].alive === false;
    const cnt = (showCnt && s.counts) ? ` · ${s.counts[i]}张` : '';
    const hp = s.players && s.players[i] && s.players[i].hp !== undefined ? ` · ${s.players[i].hp}血` : '';
    const hasClock = s.turn === i && !s.over && s.turnStart && s.phase !== 'bid';
    if (compact) {
      // 紧凑座位：框内只有 [头像(角色文字角标)] + 名字；
      // 张数=独立牌背组件（上方座位在框左侧，左右座位在框下方）；
      // 倒计时=独立闹钟组件（数字在闹钟内，上方座位在框右侧，左右座位在框上方）
      const role = opts.roleOf ? opts.roleOf(i) : '';
      const roleHtml = role ? `<i class="role-mark ${role === '地主' ? 'rm-land' : 'rm-farm'}">${role}</i>` : '';
      const sub = extra ? extra(i) : '';
      const posName = pos[k - 1];
      const isTop = posName === 'st-top' || posName === 'st-topleft' || posName === 'st-topright';
      const cntZero = s.counts && s.counts[i] === 0;
      const cntChip = (showCnt && s.counts)
        ? `<span class="cnt-chip ${isTop ? 'cc-left' : 'cc-below'}${cntZero ? ' zero' : ''}">${cntZero ? '完' : s.counts[i]}</span>` : '';
      const alarmHtml = hasClock
        ? `<span class="seat-alarm ${isTop ? 'al-right' : 'al-above'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="5.6" cy="5.4" r="2.2"/><circle cx="18.4" cy="5.4" r="2.2"/><path d="M8.6 4.2 7.4 2.9M15.4 4.2l1.2-1.3"/><circle cx="12" cy="13.4" r="7"/><path d="M9.2 19.4 7.9 21.6M14.8 19.4l1.3 2.2"/></svg><span class="alarm-num" data-clock="${s.turnStart}" data-to="${s.turnTimeout || 25}"></span></span>`
        : '';
      const leftExtras = isTop ? cntChip + alarmHtml : '';
      const bottomExtras = isTop ? '' : alarmHtml + cntChip;
      seats += `<div class="seat cseat ${posName} ${s.turn === i ? 'active' : ''} ${dead ? 'dead' : ''}" data-seat="${i}">${leftExtras}<span class="seat-ava">${avatarInner(avatarOf(i), nameOf(i))}${roleHtml}</span><span class="seat-txt">${seatLabel(i)}${sub}</span>${bottomExtras}</div>`;
      continue;
    }
    seats += `<div class="seat ${pos[k - 1]} ${s.turn === i ? 'active' : ''} ${dead ? 'dead' : ''}" data-seat="${i}"><span class="seat-ava">${avatarInner(avatarOf(i), nameOf(i))}</span><span class="seat-txt">${seatLabel(i)}${cnt}${hp}${extra ? extra(i) : ''}</span></div>`;
    // 牌背张数组件：独立于座位框，定位在座位下方
    if (cardBack && s.counts) badges += `<div class="cnt-badge cb-${pos[k - 1].replace('st-','')}">${s.counts[i]}</div>`;
    // 倒计时闹钟：独立组件，定位在座位框侧方（左上座位的右侧、右上座位的左侧）
    if (hasClock) clocks += `<div class="clock-badge clk-${pos[k - 1].replace('st-','')}" data-clock="${s.turnStart}" data-to="${s.turnTimeout || 25}"></div>`;
  }
  // 叫分标签 / 出牌停留区放在纯 2D 重合层，与桌面精确对齐、文字竖直清晰
  const layer2D = (insideFelt || (opts && opts.bidTags))
    ? `<div class="zone-layer ${n === 4 ? 'sq' : ''}">${insideFelt || ''}${(opts && opts.bidTags) || ''}</div>` : '';
  // 座位/牌背/倒计时留在 3D 倾斜桌面内；中央内容放在纯 2D 层，避免小牌被 3D 合成栅格化后发虚
  return `<div class="table"><div class="felt ${n === 4 ? 'sq' : ''}">${seats}${badges}${clocks}</div>${layer2D}<div class="pile-area ${n === 4 ? 'pile-sq' : ''}">${centerHTML}</div></div>`;
}

function actionButtons(btns) {
  return `<div class="actions">` + btns.map(b =>
    `<button class="${b.cls || ''}" data-act="${esc(b.act)}" ${b.dis ? 'disabled' : ''}>${esc(b.label)}</button>`).join('') + '</div>';
}

function bindActs(payloadFn) {
  document.querySelectorAll('[data-act]').forEach(b => {
    b.onclick = () => {
      if (isPaused) return;
      const op = b.dataset.act;
      const extra = payloadFn ? payloadFn(op, b) : {};
      if (extra === false) return;
      send({ t: 'act', a: { op, ...extra } });
    };
  });
}

function renderGame() {
  const s = lastState;
  if (!s || !myRoom) return;
  if (!gameStartTime && !s.over) gameStartTime = Date.now();
  const gn = $('gameName');
  if (myRoom.game === 'doudizhu') gn.innerHTML = '<img class="ddz-title-img" src="%E6%96%97%E5%9C%B0%E4%B8%BB%E6%A0%87%E9%A2%98.png" alt="斗地主">';
  else gn.textContent = GAME_NAME[myRoom.game];
  $('gameStatus').textContent = s.over ? '已结束' : (s.turn !== undefined ? (s.turn === mySeat ? '轮到你' : `等待${seatLabel(s.turn)}`) : '');
  $('gameActions').classList.toggle('hidden', s.over);
  const r = RENDER[myRoom.game];
  if (r) r(s);
  if (s.over) {
    window._ddzDealt = false; // 重置发牌动画标记，下局重新播放
    window._ddzDealing = false;
    $('gameActions').classList.add('hidden');
    let result = '流局/平局';
    let settleBox = '';
    if (s.winner >= 0 || s.winSide) {
      if (myRoom.game === 'doudizhu' && s.winSide) {
        const amLandlord = s.landlord === mySeat;
        const myWin = s.winSide === 'landlord' ? amLandlord : !amLandlord;
        result = s.winSide === 'landlord'
          ? (myWin ? '🎉 地主胜利！（你赢了）' : '🎩 地主胜利！（你输了）')
          : (myWin ? '🎉 农民同盟胜利！（你赢了）' : '🌾 农民同盟胜利！（你输了）');
        // 本局结算明细：叫分 × 倍数、各家加减分与累计积分
        if (s.settle) {
          const st = s.settle;
          const rows = st.deltas.map((d, i) => {
            const role = i === s.landlord ? '🎩地主' : '🌾农民';
            return `<span class="st-cell ${i === mySeat ? 'me' : ''}">${seatLabel(i)} ${role}<b>${d > 0 ? '+' : ''}${d}</b><small>累计 ${s.scores[i]}</small></span>`;
          }).join('');
          settleBox = `<div class="settle-box">
            <div class="settle-head">${st.reason === 'baodao' ? '报到不打 · ' : ''}叫 ${st.bid} 分 × ${st.mult} 倍</div>
            <div class="settle-row">${rows}</div>
          </div>`;
        }
      }
      if (myRoom.game === 'guandan') {
      const myTeam = mySeat % 2;
      const winTeam = s.winSide === 'teamA' ? 0 : 1;
      result = (winTeam === myTeam) ? '🎉 你方获胜！' : '对方获胜';
      // 掼蛋结算面板：显示名次、升级、进贡信息
      if (s.settle) {
        const st = s.settle;
        const lvName = v => v === 14 ? 'A' : v === 13 ? 'K' : v === 12 ? 'Q' : v === 11 ? 'J' : v;
        const rankNames = ['头游', '二游', '三游', '末游'];
        const rankRows = st.finished.map((seat, i) => {
          const isMe = seat === mySeat;
          const isMate = seat % 2 === myTeam;
          return `<span class="st-cell ${isMe ? 'me' : ''}">${rankNames[i]} ${seatLabel(seat)}${isMe ? '（我）' : isMate ? '（队友）' : ''}</span>`;
        }).join('');
        const upTxt = st.levelUp > 0 ? `升 ${st.levelUp} 级（${lvName(st.oldLevel)} → ${lvName(st.newLevel)}）` : '不升级';
        const ddTxt = st.doubleDown ? '　<span style="color:#e94560">双下！</span>' : '';
        const aWinTxt = st.isAWin ? '<div style="font-size:15px;color:#ffd166;margin-top:6px">🏆 打到 A 并获胜，通关成功！</div>' : '';
        settleBox = `<div class="settle-box">
          <div class="settle-head">${st.winTeam === 0 ? '一三队' : '二四队'}获胜 · ${upTxt}${ddTxt}</div>
          <div class="settle-row">${rankRows}</div>${aWinTxt}
        </div>`;
      }
    } else result = (s.winner === mySeat) ? '🎉 你赢了！' : `${seatLabel(s.winner)} 获胜`;
  }
  const isHost = myRoom.host === myId;
  $('board').insertAdjacentHTML('beforeend', `
    ${settleBox}
    <div class="actions" style="margin-top:14px">
      <span style="font-size:18px;align-self:center">${result}</span>
      <button class="primary" data-end="restart" ${isHost ? '' : 'disabled'}>${isHost ? '再来一局' : '等待房主开始'}</button>
      <button data-end="back">退出房间</button>
    </div>`);
  document.querySelector('[data-end="restart"]').onclick = () => send({ t: 'start' });
  document.querySelector('[data-end="back"]').onclick = () => { send({ t: 'quitGame' }); myRoom = null; lastState = null; isPaused = false; gameStartTime = null; showPage('lobby'); };
  }
  // 回合倒计时显示：每0.5秒刷新所有 [data-clock] 元素
  clearInterval(window._clockTimer);
  if (document.querySelector('[data-clock]')) {
    const tick = () => {
      document.querySelectorAll('[data-clock]').forEach(el => {
        const left = Math.ceil(+el.dataset.to - (Date.now() - +el.dataset.clock) / 1000);
        el.textContent = Math.max(0, left);
        const color = left <= 5 ? '#e94560' : '#ffd166';
        el.style.color = color;
        const box = el.closest('.seat-alarm');
        if (box) box.style.color = color;
      });
    };
    tick();
    window._clockTimer = setInterval(tick, 500);
  }
}

const RENDER = {};

/* ---------- UNO ---------- */
const UNO_V = { S: '禁', V: '转', D2: '+2', W: '变色', W4: '+4' };
const UNO_C = { R: '红', Y: '黄', G: '绿', B: '蓝', W: '' };
function unoCard(c, i, selSet) {
  return `<div class="card ${c.c} ${selSet.has(c.id) ? 'sel' : ''}" data-idx="${i}">${UNO_V[c.v] || c.v}<small>${UNO_C[c.c]}</small></div>`;
}
RENDER.uno = s => {
  // 牌桌中央：抽牌堆（背面叠放）+ 弃牌摊开（最近7张铺开保留，最右为堆顶）
  const back = '<span class="card W">UNO</span>';
  const drawPile = `<div class="pile-cards"><span class="pc" style="transform:rotate(-5deg)">${back}</span><span class="pc" style="transform:rotate(4deg)">${back}</span></div>`;
  const rot = [-8, 5, -3, 9, -6, 2, 7];
  const recent = s.recent && s.recent.length ? s.recent : (s.top ? [s.top] : []);
  const discardPile = recent.length
    ? `<div class="fan-cards" style="flex-wrap:nowrap;align-items:flex-end">${recent.map((c, i) => `<span class="card ${c.c} ${i === recent.length - 1 ? 'new' : ''}" style="transform:rotate(${rot[i % 7]}deg)">${UNO_V[c.v] || c.v}<small>${UNO_C[c.c]}</small></span>`).join('')}</div>`
    : '';
  const center = `<div style="display:flex;gap:20px;justify-content:center;align-items:center">${drawPile}${discardPile}</div>`
    + `<div style="margin-top:6px">当前颜色：<b>${{ R: '红', Y: '黄', G: '绿', B: '蓝' }[s.color] || ''}</b>　剩余${s.deckCount}张 ${s.dir === -1 ? '⟲逆时针' : ''}</div>`;
  let html = tableRing(s, center);
  html += `<div class="hand">${s.hand.map((c, i) => unoCard(c, i, sel)).join('')}</div>`;
  const my = s.turn === mySeat && !s.over;
  if (s.needColor) {
    html += actionButtons(['R', 'Y', 'G', 'B'].map(c => ({ act: 'color:' + c, label: { R: '红色', Y: '黄色', G: '绿色', B: '蓝色' }[c], cls: 'primary' })));
  } else {
    html += actionButtons([
      { act: 'play', label: '出牌', cls: 'primary', dis: !my || sel.size !== 1 },
      { act: 'draw', label: '摸牌', dis: !my },
    ]);
  }
  $('board').innerHTML = html;
  bindHand(true);
  bindActs(op => {
    if (op === 'play') return { idx: [...sel][0] };
    if (op.startsWith('color:')) return { op: 'color', color: op.split(':')[1] };
  });
};

// single=true 时为单选模式（麻将/UNO）：点新牌自动取消旧牌，再点一次取消选中
function bindHand(single) {
  document.querySelectorAll('.hand .card, .hand .tile').forEach(el => {
    el.onclick = () => {
      if (isPaused) return;
      const idx = +el.dataset.idx;
      if (single) {
        if (sel.has(idx)) sel.clear();
        else { sel.clear(); sel.add(idx); }
      } else {
        if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
      }
      renderGame(); // 重新渲染：刷新选中样式和所有按钮的可用状态（修复麻将"打出所选"不启用等问题）
    };
  });
}

/* ---------- 三国杀 ---------- */
const SGS_N = { sha: '杀', shan: '闪', tao: '桃' };
const SGS_CLS = { sha: '', shan: 'G', tao: 'R' };
let sgsTarget = -1;
RENDER.sanguosha = s => {
  const center = s.pending
    ? `⚔️ ${seatLabel(s.pending.from)} 对 ${seatLabel(s.pending.to)} 使用【杀】，等待响应…`
    : `牌堆剩 ${s.deckCount} 张`;
  let html = tableRing(s, center);
  html += `<div class="center-area" style="min-height:auto;margin:6px 0">你的体力：${s.players[mySeat].hp}/4${s.usedSha ? '（已出杀）' : ''}　<span style="color:#888;font-size:13px">点击桌边座位选择目标</span></div>`;
  html += `<div class="hand">${s.hand.map((c, i) => `<div class="card ${SGS_CLS[c.k]} ${sel.has(i) ? 'sel' : ''}" data-idx="${i}">${SGS_N[c.k]}</div>`).join('')}</div>`;
  const my = s.turn === mySeat && !s.over && !s.pending;
  if (s.needResponse) {
    const hasShan = s.hand.some(c => c.k === 'shan');
    html += actionButtons([
      { act: 'shan', label: '出闪', cls: 'primary', dis: !hasShan },
      { act: 'hurt', label: '承受伤害' },
    ]);
  } else {
    html += actionButtons([
      { act: 'sha', label: sgsTarget >= 0 ? `杀 → 玩家${sgsTarget + 1}` : '出杀（先点上方目标）', cls: 'primary', dis: !my || sgsTarget < 0 || s.usedSha || !s.hand.some(c => c.k === 'sha') },
      { act: 'tao', label: '吃桃', dis: !my || !s.hand.some(c => c.k === 'tao') || s.players[mySeat].hp >= 4 },
      { act: 'end', label: '结束回合', dis: !my },
    ]);
  }
  $('board').innerHTML = html;
  document.querySelectorAll('.seat').forEach(el => {
    el.onclick = () => {
      document.querySelectorAll('.seat').forEach(x => x.style.outline = '');
      el.style.outline = '2px solid #ff0';
      sgsTarget = +el.dataset.seat;
      renderGame();
    };
  });
  // 重渲染后恢复目标高亮
  if (sgsTarget >= 0) {
    const t = document.querySelector(`.seat[data-seat="${sgsTarget}"]`);
    if (t) t.style.outline = '2px solid #ff0';
  }
  if (s.pending && s.pending.to !== mySeat) sgsTarget = -1;
  bindActs(op => { if (op === 'sha') { const t = sgsTarget; sgsTarget = -1; return { to: t }; } });
};

/* ---------- 大富翁 ---------- */
const PAWN = ['🔴', '🔵', '🟢', '🟡'];
const OWN = ['A', 'B', 'C', 'D'];
RENDER.monopoly = s => {
  const me = s.players[mySeat];
  let html = `<div class="mono-info">${s.players.map((p, i) => `${PAWN[i]}玩家${i + 1}${i === mySeat ? '(我)' : ''}💰${p.money}${p.alive ? '' : '💀'}`).join('　')}</div>`;
  html += `<div class="dice">🎲 ${s.dice[0]} + ${s.dice[1]}</div>`;
  // 环形摆格：上边 0-6，右边 7-12，下边 13-18（倒序），左边 19-23（倒序）简化为 4 行网格
  html += '<div class="mono-board">';
  for (let i = 0; i < 24; i++) {
    const t = s.board[i];
    const pawns = s.players.map((p, pi) => p.alive && p.pos === i ? PAWN[pi] : '').join('');
    const own = t.owner !== undefined ? `owned-${OWN[t.owner]}` : '';
    html += `<div class="cell ${own}">${i === 0 ? '🚩' : ''}${esc(t.name)}${t.price ? `<br>${t.price}` : ''}<div class="pawns">${pawns}</div></div>`;
  }
  html += '</div>';
  const my = s.turn === mySeat && !s.over;
  html += actionButtons([
    { act: 'roll', label: '掷骰子', cls: 'primary', dis: !my || s.phase !== 'roll' },
    { act: 'buy', label: '购买此地', dis: !my || s.phase !== 'buy' },
    { act: 'skip', label: '放弃购买', dis: !my || s.phase !== 'buy' },
  ]);
  $('board').innerHTML = html;
  bindActs();
};

/* ---------- 麻将 / 文字麻将 ---------- */
const MJ_NAME = [];
for (let i = 0; i < 9; i++) MJ_NAME[i] = (i + 1) + '万';
for (let i = 9; i < 18; i++) MJ_NAME[i] = (i - 8) + '条';
for (let i = 18; i < 27; i++) MJ_NAME[i] = (i - 17) + '筒';
MJ_NAME[27] = '东'; MJ_NAME[28] = '南'; MJ_NAME[29] = '西'; MJ_NAME[30] = '北'; MJ_NAME[31] = '中'; MJ_NAME[32] = '发'; MJ_NAME[33] = '白';

function mjTile(t, i, textMode) {
  const honor = t >= 27 ? 'honor' : '';
  const cls = sel.has(i) ? 'sel' : '';
  if (textMode) return `<span class="tile ${honor} ${cls}" data-idx="${i}" style="width:auto;padding:0 6px">${MJ_NAME[t]}</span>`;
  return `<div class="tile ${honor} ${cls}" data-idx="${i}">${MJ_NAME[t]}</div>`;
}

function renderMahjong(s, textMode) {
  // 牌桌中央：牌墙/认领提示 + 各家弃牌按玩家分行铺开保留（模拟真实牌河）
  const rot = [-8, 5, -3, 9, -6, 2, 7, -4];
  let pile = '';
  for (let i = 0; i < 4; i++) {
    if (!s.discards[i] || !s.discards[i].length) continue;
    pile += `<div style="display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:1px;margin-top:3px">`
      + `<span style="font-size:11px;color:#bbb;margin-right:3px">${seatLabel(i)}</span>`
      + s.discards[i].map((t, j) => `<span class="tile ${t >= 27 ? 'honor' : ''}" style="width:21px;height:28px;font-size:10px;margin:0;transform:rotate(${rot[(i * 7 + j) % 8]}deg)">${MJ_NAME[t]}</span>`).join('')
      + `</div>`;
  }
  const tip = s.claim
    ? `💡 ${seatLabel(s.claim.from)} 打出【${MJ_NAME[s.claim.tile]}】${s.claim.my ? '，你可以选择：' : '，等待响应…'}`
    : `牌墙剩 ${s.wallCount} 张`;
  let html = tableRing(s, `<div>${tip}</div>${pile}`);
  for (let i = 0; i < 4; i++) {
    if (s.melds[i].length) html += `<div class="meld-row">${seatLabel(i)} 副露: ${s.melds[i].map(m => (m.type === 'angang' ? '🀫🀫🀫🀫' : m.tiles.map(t => MJ_NAME[t]).join(''))).join(' ')}</div>`;
  }
  html += `<div class="hand">${s.hand.map((t, i) => mjTile(t, i, textMode)).join('')}</div>`;
  const my = s.turn === mySeat && !s.over && !s.claim;
  const btns = [];
  if (s.claim && s.claim.my) {
    if (s.claim.my.hu) btns.push({ act: 'claim:hu', label: '胡', cls: 'primary' });
    if (s.claim.my.gang) btns.push({ act: 'claim:gang', label: '杠' });
    if (s.claim.my.peng) btns.push({ act: 'claim:peng', label: '碰' });
    if (s.claim.my.chi && s.claim.my.chi.length) s.claim.my.chi.forEach(cb => btns.push({ act: 'claim:chi:' + cb.join(','), label: `吃 ${MJ_NAME[cb[0]]}${MJ_NAME[cb[1]]}` }));
    btns.push({ act: 'claim:pass', label: '过' });
  } else {
    btns.push({ act: 'draw', label: '摸牌', cls: 'primary', dis: !my || s.phase !== 'draw' });
    btns.push({ act: 'discard', label: '打出所选', dis: !my || s.phase !== 'play' || sel.size !== 1 });
    if (s.canSelfHu) btns.push({ act: 'hu', label: '胡！', cls: 'primary' });
    if (s.angangs && s.angangs.length) s.angangs.forEach(t => btns.push({ act: 'angang:' + t, label: `暗杠${MJ_NAME[t]}` }));
  }
  html += actionButtons(btns);
  $('board').innerHTML = html;
  bindHand(true);
  bindActs(op => {
    if (op === 'discard') return { tile: s.hand[[...sel][0]] };
    if (op.startsWith('claim:')) {
      const p = op.split(':');
      if (p[1] === 'chi') return { op: 'chi', combo: p[2].split(',').map(Number) };
      return { op: p[1] };
    }
    if (op.startsWith('angang:')) return { op: 'angang', tile: +op.split(':')[1] };
  });
}
RENDER.mahjong = s => renderMahjong(s, false);
RENDER.majiang_text = s => renderMahjong(s, true);

/* ---------- 斗地主 / 掼蛋 ---------- */
// 发牌动画：真实建模牌堆放在绿色桌面上，向四家飞牌；结束后手牌从牌堆飞入排列
function dealAnim() {
  const felt = document.querySelector('.felt');
  if (!felt) { window._ddzDealt = false; return; }
  const r = felt.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  const overlay = document.createElement('div');
  overlay.className = 'deal-overlay';

  // 真实建模牌堆：多层叠放模拟厚度
  const stack = document.createElement('div');
  stack.className = 'deal-stack';
  stack.style.left = cx + 'px';
  stack.style.top = cy + 'px';
  let sh = '';
  for (let s = 0; s < 7; s++) sh += `<div class="stack-card" style="transform:translate(${-s*0.4}px,${-s*1.3}px);box-shadow:0 ${1+s*0.6}px ${2+s*0.5}px rgba(0,0,0,.45)"></div>`;
  stack.innerHTML = sh;
  overlay.appendChild(stack);
  document.body.appendChild(overlay);
  window._ddzDealing = true;

  // 隐藏手牌，发牌完成后飞入
  const hand = document.getElementById('pkHand');
  if (hand) hand.style.visibility = 'hidden';

  // 四家方向（相对牌桌中心的像素偏移）：左 / 上 / 右 / 下（我）
  const targets = [
    { x: -r.width * 0.34, y: -r.height * 0.02 },
    { x: 0, y: -r.height * 0.30 },
    { x: r.width * 0.34, y: -r.height * 0.02 },
    { x: 0, y: r.height * 0.44 },
  ];
  let i = 0;
  const total = 20;
  const iv = setInterval(() => {
    if (i >= total) {
      clearInterval(iv);
      // 牌堆淡出
      stack.style.transition = 'opacity .3s';
      stack.style.opacity = '0';
      window._ddzDealing = false;
      // 手牌依次从牌堆方向飞入排列
      const h = document.getElementById('pkHand');
      if (h) {
        h.style.visibility = '';
        h.classList.add('hand-deal-in');
        h.querySelectorAll('.card').forEach((c, idx) => { c.style.animationDelay = (idx * 0.035) + 's'; });
        setTimeout(() => {
          h.classList.remove('hand-deal-in');
          h.querySelectorAll('.card').forEach(c => { c.style.animationDelay = ''; });
        }, 1200);
      }
      setTimeout(() => overlay.remove(), 400);
      return;
    }
    const t = targets[i % 4];
    const card = document.createElement('div');
    card.className = 'deal-card';
    card.style.left = cx + 'px';
    card.style.top = cy + 'px';
    card.style.setProperty('--tx', t.x + 'px');
    card.style.setProperty('--ty', t.y + 'px');
    overlay.appendChild(card);
    i++;
  }, 60);
}
const PK_V = v => v === 16 ? '小王' : v === 17 ? '大王' : ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' }[v] || v);
const PK_S = ['♠', '♥', '♣', '♦'];
// 简洁牌面：仅左上/右下（倒置）双角标，中间空白；大小王中间贴图 + 左侧竖排 JOKER
function jokerArt(v) {
  const img = v === 16 ? 'cards/%E5%B0%8F%E7%8E%8B.png' : 'cards/%E5%A4%A7%E7%8E%8B.png';
  return `<span class="jk-word${v === 17 ? ' red' : ''}">J<br>O<br>K<br>E<br>R</span><img class="face-img joker-img" src="${img}" alt="${v === 16 ? '小王' : '大王'}">`;
}
function pkCard(c, i) {
  const red = c.s === 1 || c.s === 3;
  const selCls = sel.has(i) ? ' sel' : '';
  // 掼蛋：级牌（逢人配）高亮金边
  const wildCls = (myRoom && myRoom.game === 'guandan' && lastState && c.v === (lastState.level === 2 ? 15 : lastState.level) && c.v < 16) ? ' wild' : '';
  if (c.v >= 16) return `<div class="card joker${selCls}" data-idx="${i}">${jokerArt(c.v)}</div>`;
  const label = PK_V(c.v), suit = PK_S[c.s];
  return `<div class="card ${red ? 'red' : ''}${selCls}${wildCls}" data-idx="${i}"><div class="corner tl">${label}<small>${suit}</small></div><div class="corner br">${label}<small>${suit}</small></div></div>`;
}

// 扑克手牌叠排：目标每张盖住前一张约15%（角标"10"完整露出）；空间不足时最多压到62%；
// 仍然放不下则整排等比缩小，保证所有牌完整显示在界面边界内（缩放后不做负边距补偿，避免遮挡下方按钮）
function reflowPokerHand() {
  const handEl = $('pkHand');
  if (!handEl) return;
  const cards = handEl.children;
  const n = cards.length;
  // 先重置上一次的缩放再测量真实尺寸
  handEl.style.transform = '';
  handEl.style.marginBottom = '';
  if (n <= 1) { handEl.style.setProperty('--overlap', '0px'); return; }
  const rect = cards[0].getBoundingClientRect();
  const cw = rect.width || 46;
  const board = $('board');
  const cs = getComputedStyle(board);
  const avail = board.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0) - 8; // 内容宽并留 8px 余量
  let margin = -cw * 0.15;                        // 目标重叠 15%
  let total = cw + (n - 1) * (cw + margin);
  if (total > avail) {                            // 加大重叠，最多遮住 62%（露出 38% 给角标，保证"10"不被压）
    margin = Math.max(-cw * 0.62, (avail - cw) / (n - 1) - cw);
    total = cw + (n - 1) * (cw + margin);
  }
  handEl.style.setProperty('--overlap', `${margin}px`);
  // 还放不下：整排以底边为中心等比缩小（不做负边距补偿，保证与下方按钮不重叠）
  if (total > avail + 1) {
    const k = Math.max(0.45, avail / total);
    handEl.style.transformOrigin = 'bottom center';
    handEl.style.transform = `scale(${k})`;
  }
}
addEventListener('resize', () => { if ($('game') && !$('game').classList.contains('hidden')) reflowPokerHand(); });

function renderPoker(s, isGuandan) {
  // 出牌记录中单张牌的着色文字：红桃/方块红色，黑桃/梅花与小王白色，大王红色
  const logCard = c => {
    if (c.v >= 16) {
      const big = c.v === 17;
      return `<span class="lc ${big ? 'r' : ''}">${big ? '大王' : '小王'}</span>`;
    }
    const red = c.s === 1 || c.s === 3;
    return `<span class="lc ${red ? 'r' : ''}">${PK_V(c.v)}${PK_S[c.s]}</span>`;
  };
  const mini = (c, isNew) => {
    const red = c.s === 1 || c.s === 3;
    if (c.v >= 16) return `<span class="card joker${isNew ? ' new' : ''}">${jokerArt(c.v)}</span>`;
    const label = PK_V(c.v), suit = PK_S[c.s];
    return `<span class="card ${red ? 'red' : ''}${isNew ? ' new' : ''}"><span class="corner tl">${label}<small>${suit}</small></span><span class="corner br">${label}<small>${suit}</small></span></span>`;
  };
  let center = '';
  if (!isGuandan && s.phase === 'bid') {
    // 叫地主阶段：中央只放标题与明王/荒番信息；各家叫分显示在对应座位框内侧
    let markHtml = '';
    if (s.markedCard) {
      const c = s.markedCard;
      const cardHtml = `<span class="bottom-cards mark-inline">${mini(c)}</span>`;
      markHtml = s.mult && s.mult.mingwang
        ? `<div class="bid-mark">标记牌：${cardHtml}<b style="color:#ff6b6b">明王！积分翻倍</b></div>`
        : `<div class="bid-mark dim">标记牌：${cardHtml}（未标到王）</div>`;
    }
    const hf = s.mult && s.mult.huangfan ? '<div style="font-size:12px;margin-top:3px;color:#ffd166">🏵 荒番局：积分翻倍</div>' : '';
    center = `<div class="bid-title">📢 叫地主</div><div class="bid-sub">1 / 2 / 3 分，叫 3 分立即当地主</div>${hf}${markHtml}`;
  } else if (!isGuandan && s.phase === 'declare') {
    // 地主报到/摊打抉择阶段
    const tip = s.baodaoEligible
      ? '你满足<b style="color:#ffd166">报到</b>条件（四张王或 7 张以上炸弹）：可【报到不打】直接得分，也可【报到开打】积分翻倍（7 张以上炸弹不可拆开）'
      : '可选择【摊打】：摊打后本局积分翻倍';
    center = `<div class="declare-title">🎩 ${seatLabel(s.landlord)} 成为地主（${s.maxBid} 分，获得 8 张底牌）</div>`
      + (s.turn === mySeat ? `<div class="declare-tip">${tip}</div>`
        : `<div class="declare-wait">等待地主选择报到 / 摊打…</div>`);
  } else {
    // 出牌阶段：中央只保留最新一手牌（出牌历史已移除，改为右侧发言面板）
    const plays = s.plays || [];
    const latestOnly = plays.length
      ? `<div class="spread">${plays[plays.length - 1].cards.map(c => mini(c, true)).join('')}</div>`
      : '<div class="empty-tip">（还没有人出牌）</div>';
    if (isGuandan) {
      center = `<div class="ddz-gd-level">级牌 <b>${s.levelName || s.level}</b>${s.doubleDown ? '　<span style="color:#e94560">双下局</span>' : ''}</div>` + latestOnly;
    } else {
      center = latestOnly;
    }
  }
  // 座位框附加小字（斗地主不再显示剩余炸弹数）
  let extra;
  if (!isGuandan) {
    extra = () => '';
  } else {
    extra = i => `<small class="seat-sub">${s.finished.includes(i) ? '第' + (s.finished.indexOf(i) + 1) + '名' : (i % 2 === mySeat % 2 ? '队友' : '对方')}</small>`;
  }
  // 角色角标（斗地主定地主后：头像右下角文字"地主/农民"）
  const roleOf = !isGuandan && s.landlord >= 0
    ? i => (i === s.landlord ? '地主' : '农民')
    : null;
  // 本轮出牌：各家行动后出的牌（或"不出"）停留在各自座位名称旁，直到该轮结束自动清空
  let playZone = '';
  if (Array.isArray(s.table) && s.table.length && !s.over) {
    const n = s.counts.length;
    const rel = seat => (seat - mySeat + n) % n; // 0=我 1=下家(右) 2=对家(上) 3=上家(左)
    const zoneMap = {
      3: ['pz-bottom', 'pz-topleft', 'pz-topright'],
      4: ['pz-bottom', 'pz-left', 'pz-top', 'pz-right'],
    };
    const zc = zoneMap[n];
    if (zc) {
      playZone = s.table.map(a => {
        const inner = a.cards && a.cards.length
          ? `<div class="fan-cards">${a.cards.map(mini).join('')}</div>`
          : `<div class="pass-tag">不出</div>`;
        return `<div class="play-zone ${zc[rel(a.seat)]}">${inner}</div>`;
      }).join('');
    }
  }
  // 叫分阶段：各家"不叫/1分/2分/3分/…"标签显示在框对应的牌桌内侧
  let bidTags = '';
  if (!isGuandan && s.phase === 'bid') {
    const n = s.counts.length;
    const rel = seat => (seat - mySeat + n) % n;
    const tagMap = { 3: ['bt-bottom', 'bt-tl', 'bt-tr'], 4: ['bt-bottom', 'bt-left', 'bt-top', 'bt-right'] };
    const tc = tagMap[n];
    if (tc) {
      bidTags = Array.from({ length: n }, (_, i) => {
        const b = s.bids ? s.bids[i] : undefined;
        let cls = 'wait', txt = '…';
        if (b === 0) { cls = 'pass'; txt = '不叫'; }
        else if (b === 1) { cls = 'b1'; txt = '1分'; }
        else if (b === 2) { cls = 'b2'; txt = '2分'; }
        else if (b === 3) { cls = 'b3'; txt = '3分'; }
        return `<div class="bid-tag ${tc[rel(i)]} ${cls}">${txt}</div>`;
      }).join('');
    }
  }
  const ringOpts = { showCnt: true, compact: true, roleOf, bidTags };
  const tableHtml = tableRing(s, center, extra, playZone, ringOpts);
  // 发言记录面板（标题固定为"发言记录"）
  const chatPanelHtml = `<div class="chat-panel"><div class="chat-panel-title">发言记录</div><div class="chat-list" id="chatList"></div></div>`;
  // 积分/倍数信息行
  let infoHtml = '';
  if (!isGuandan) {
    const M = s.mult || {};
    const multNow = (M.huangfan ? 2 : 1) * (M.mingwang ? 2 : 1) * (M.touliao ? 2 : 1) * (M.tanda ? 2 : 1) * (M.baodao ? 2 : 1);
    const badges = [['huangfan', '🏵荒番'], ['mingwang', '明王'], ['touliao', '⚡头撩'], ['tanda', '📖摊打'], ['baodao', '📢报到']]
      .filter(([k]) => M[k]).map(([, t]) => `<span class="mult-badge">${t}</span>`).join('');
    const scoreLine = Array.isArray(s.scores)
      ? s.scores.map((v, i) => `${i === mySeat ? '我' : nameOf(i)}${s.landlord === i ? '🎩' : ''} ${v > 0 ? '+' : ''}${v}`).join('　')
      : '';
    infoHtml = `<div class="ddz-info"><span class="ddz-scores">🏆 ${scoreLine}</span><span class="ddz-mults">本局 ×${multNow}　${badges}</span></div>`;
  } else {
    // 掼蛋：顶部信息栏显示当前级牌、两队对抗、我的队伍
    const myTeamName = mySeat % 2 === 0 ? '一三队' : '二四队';
    const mateSeat = (mySeat + 2) % 4;
    const lvName = s.levelName || s.level;
    const gdLine = `级牌 <b style="color:#ffd166">${lvName}</b>（逢人配）　我方：${myTeamName}（你 & ${nameOf(mateSeat)}）`;
    infoHtml = `<div class="ddz-info"><span class="ddz-scores">🎴 ${gdLine}</span></div>`;
  }
  let html;
  if (!isGuandan) {
    // 斗地主：界面上方一行——底牌在左、发言记录在右；其下积分行；再下牌桌
    const bcItems = s.phase === 'bid'
      ? Array.from({ length: s.bottomCnt || 8 }, () => '<span class="card W"></span>')
      : (s.bottom || []).map(c => mini(c));
    const half = Math.ceil(bcItems.length / 2);
    const bc = `<div class="bc-row">${bcItems.slice(0, half).join('')}</div><div class="bc-row">${bcItems.slice(half).join('')}</div>`;
    html = `<div class="ddz-top"><div class="bottom-cards two-row"><span class="bottom-label">底牌${s.phase === 'bid' ? '' : '（归地主）'}</span>${bc}</div>${chatPanelHtml}</div>`
      + infoHtml
      + `<div class="ddz-main">${tableHtml}</div>`;
  } else {
    // 掼蛋：信息行 + 牌桌（左）与发言记录（右）
    html = infoHtml + `<div class="ddz-wrapper"><div class="ddz-main">${tableHtml}</div>${chatPanelHtml}</div>`;
  }
  // 我这一侧：头像右下角文字角标；张数同样用牌背组件；轮到我时显示独立闹钟
  let myRole = '';
  if (!isGuandan && s.landlord >= 0) {
    myRole = s.landlord === mySeat
      ? '<i class="role-mark rm-land">地主</i>'
      : '<i class="role-mark rm-farm">农民</i>';
  }
  const myClock = (s.turn === mySeat && !s.over && s.turnStart && s.phase !== 'bid')
    ? `<span class="seat-alarm my-alarm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="5.6" cy="5.4" r="2.2"/><circle cx="18.4" cy="5.4" r="2.2"/><path d="M8.6 4.2 7.4 2.9M15.4 4.2l1.2-1.3"/><circle cx="12" cy="13.4" r="7"/><path d="M9.2 19.4 7.9 21.6M14.8 19.4l1.3 2.2"/></svg><span class="alarm-num" data-clock="${s.turnStart}" data-to="${s.turnTimeout || 25}"></span></span>` : '';
  const handHide = window._ddzDealing ? ' style="visibility:hidden"' : '';
  html += `<div class="my-bar"${window._ddzDealing ? ' style="visibility:hidden"' : ''}><span class="seat-ava my-ava">${avatarInner(myAvatar, myName)}${myRole}</span><span class="my-bar-name">${esc(myName || ('玩家' + (mySeat + 1)))}</span><button class="chat-toggle" id="chatBtn" type="button">💬</button><span class="cnt-chip my-cnt-chip">${s.hand.length}</span>${myClock}</div>`;
  // 发言输入条（点击 💬 展开）
  html += `<div class="chat-bar" id="chatBar"><input id="chatInput" maxlength="40" placeholder="说点什么…（回车发送）"><button id="chatSend" type="button">发送</button></div>`;
  html += `<div class="hand pk-hand" id="pkHand"${handHide}>${s.hand.map((c, i) => pkCard(c, i)).join('')}</div>`;
  if (!isGuandan && s.phase === 'bid') {
    const myBid = s.turn === mySeat && !s.over;
    html += actionButtons([
      { act: 'bid:0', label: '不叫', dis: !myBid },
      { act: 'bid:1', label: '1分', cls: 'primary', dis: !myBid || s.maxBid >= 1 },
      { act: 'bid:2', label: '2分', cls: 'primary', dis: !myBid || s.maxBid >= 2 },
      { act: 'bid:3', label: '3分', cls: 'primary', dis: !myBid || s.maxBid >= 3 },
    ]);
  } else if (!isGuandan && s.phase === 'declare') {
    // 地主出牌前抉择：报到不打 / 报到开打 / 摊打（倍数可叠加）
    const myDeclare = s.turn === mySeat && !s.over;
    if (myDeclare && s.baodaoEligible) {
      html += actionButtons([
        { act: 'baodaoPass', label: '报到不打（直接得分）' },
        { act: 'declare', label: '报到开打（翻倍）', cls: 'primary' },
        { act: 'declareTanda', label: '报到+摊打（×4）' },
      ]);
    } else if (myDeclare) {
      html += actionButtons([
        { act: 'declare', label: '正常出牌', cls: 'primary' },
        { act: 'declareTanda', label: '摊打（积分翻倍）' },
      ]);
    } else {
      html += '<div class="actions" style="opacity:.7"><span style="align-self:center">等待地主选择…</span></div>';
    }
  } else if (!isGuandan && s.phase !== 'over') {
    const my = s.turn === mySeat && !s.over;
    html += actionButtons([
      { act: 'play', label: `出牌（已选${sel.size}张）`, cls: 'primary', dis: !my || sel.size === 0 },
      { act: 'pass', label: '不出', dis: !my || s.mustPlay },
    ]);
  } else if (isGuandan) {
    const my = s.turn === mySeat && !s.over;
    html += actionButtons([
      { act: 'play', label: `出牌（已选${sel.size}张）`, cls: 'primary', dis: !my || sel.size === 0 },
      { act: 'pass', label: '不出', dis: !my || s.mustPlay },
    ]);
  }
  $('board').innerHTML = html;
  // 发牌动画：斗地主进 bid 阶段、掼蛋进 play 阶段（第一局开始时）播放
  const dealPhase = isGuandan ? 'play' : 'bid';
  if (s.phase === dealPhase && !window._ddzDealt) {
    window._ddzDealt = true;
    setTimeout(dealAnim, 30);
  }
  reflowPokerHand();
  bindHand();
  renderChatPanel();
  bindChat();
  bindActs(op => {
    if (op === 'play') { const ids = [...sel].map(i => s.hand[i].id); sel.clear(); return { ids }; }
    if (op.startsWith('bid:')) return { op: 'bid', score: +op.split(':')[1] };
    if (op === 'declareTanda') return { op: 'declare', tanda: true };
    if (op === 'baodaoPass') return { op: 'baodao_pass' };
    // 'declare' 无需附加参数
  });
}
RENDER.doudizhu = s => renderPoker(s, false);
RENDER.guandan = s => renderPoker(s, true);

/* ---------- 房间发言 ---------- */
function renderChatPanel() {
  const el = $('chatList');
  if (!el) return;
  if (!chatMsgs.length) {
    el.innerHTML = '<div class="chat-empty">还没有发言<br>点下方 💬 说点什么</div>';
    return;
  }
  el.innerHTML = chatMsgs.map(msg => {
    const mine = mySeat >= 0 && msg.seat === mySeat;
    return `<div class="chat-row ${mine ? 'mine' : ''}">${avatarHtml(msg.avatar || '', 'ava xs', msg.name || '玩家')}<div class="chat-bubble"><span class="chat-name">${esc(msg.name || '玩家')}</span><span class="chat-text">${esc(msg.text)}</span></div></div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}
function bindChat() {
  const bar = $('chatBar');
  const btn = $('chatBtn');
  const input = $('chatInput');
  const sendBtn = $('chatSend');
  if (!bar || !btn || !input || !sendBtn) return;
  if (chatOpen) bar.classList.add('show');
  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    send({ t: 'chat', text });
    input.value = '';
  };
  btn.onclick = () => {
    chatOpen = !chatOpen;
    bar.classList.toggle('show', chatOpen);
    if (chatOpen) input.focus();
  };
  sendBtn.onclick = doSend;
  input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } };
}

/* ---------- 事件绑定 ---------- */
let selectedGame = 'doudizhu';
window.addEventListener('DOMContentLoaded', () => {
  const opts = GAMES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  $('roomGameSelect').innerHTML = opts;
  // 大厅：7 个游戏按钮
  const grid = $('gameBtnGrid');
  const ICONS = { uno: 'uno%E5%9B%BE%E6%A0%87.png', doudizhu: '%E6%96%97%E5%9C%B0%E4%B8%BB%E5%9B%BE%E6%A0%87.png' };
  grid.innerHTML = GAMES.map(([k, n]) => ICONS[k]
    ? `<button class="game-btn uno-btn" data-game="${k}"><img src="${ICONS[k]}" alt=""><span>${n}</span></button>`
    : `<button class="game-btn" data-game="${k}">${n}</button>`).join('');
  grid.querySelectorAll('.game-btn').forEach(btn => {
    btn.onclick = () => {
      selectedGame = btn.dataset.game;
      grid.querySelectorAll('.game-btn').forEach(b => b.classList.toggle('selected', b === btn));
    };
  });
  grid.querySelector(`.game-btn[data-game="${selectedGame}"]`).classList.add('selected');
  $('createBtn').onclick = () => { send({ t: 'create', game: selectedGame }); };
  $('switchBtn').onclick = () => { send({ t: 'switchGame', game: $('roomGameSelect').value }); };
  $('fillBotsBtn').onclick = () => send({ t: 'fillBots' });
  $('startBtn').onclick = () => send({ t: 'start' });
  $('leaveBtn').onclick = () => { send({ t: 'leave' }); myRoom = null; lastState = null; showPage('lobby'); };
  $('historyBtn').onclick = () => showHistory();
  $('historyClose').onclick = () => $('historyModal').classList.add('hidden');
  $('historyModal').onclick = e => { if (e.target === $('historyModal')) $('historyModal').classList.add('hidden'); };
  $('pauseBtn').onclick = () => send({ t: 'pause' });
  $('resumeBtn').onclick = () => send({ t: 'pause' });
  $('quitBtn').onclick = () => { send({ t: 'quitGame' }); myRoom = null; lastState = null; isPaused = false; gameStartTime = null; showPage('lobby'); };

  // ---- 个人资料：昵称 + 上传裁剪头像（圆角方形） ----
  bindCropDrag();
  let chosenAvatar = myAvatar;
  $('meChip').onclick = () => { chosenAvatar = myAvatar; openProfile(); };
  $('profileClose').onclick = closeProfile;
  $('profileCancel').onclick = closeProfile;
  $('profileModal').onclick = e => { if (e.target === $('profileModal')) closeProfile(); };
  $('cropZoom').addEventListener('input', e => {
    if (!crop.img) return;
    crop.zoom = +e.target.value;
    // 以画面中心为锚点缩放，避免偏移出界
    const sNew = crop.base * crop.zoom;
    crop.ox = clamp(crop.ox, (crop.box - crop.W * sNew) / 2, (crop.W * sNew - crop.box) / 2);
    crop.oy = clamp(crop.oy, (crop.box - crop.H * sNew) / 2, (crop.H * sNew - crop.box) / 2);
    cropRender();
  });
  $('avatarUpload').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try { await loadCropFile(file); } catch (err) { toast(err.message || '图片读取失败'); }
    e.target.value = '';
  };
  $('profileSave').onclick = () => {
    // 若正在裁剪，输出裁剪结果；预览同步更新
    if (crop.img) chosenAvatar = exportCrop();
    saveProfile($('profileName').value, chosenAvatar);
    closeProfile();
    toast('资料已保存');
  };
  // 昵称变化时，未上传头像的首字占位实时更新
  $('profileName').addEventListener('input', e => {
    if (!crop.img) $('profileAvaPreview').innerHTML = avatarInner(chosenAvatar, e.target.value || '玩家');
  });
  renderMeChip();
  connect();
});
