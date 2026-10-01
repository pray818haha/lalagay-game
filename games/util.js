// 通用工具
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addLog(state, msg) {
  state.log.push(msg);
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
}

module.exports = { shuffle, addLog };
