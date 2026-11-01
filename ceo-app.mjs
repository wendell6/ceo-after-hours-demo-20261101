import { Round, GIFTS, INTENTS } from './ceo-engine.mjs';
const $ = id => document.getElementById(id);
let game = new Round(), manifest, sound = true, paused = false, running = false, busy = false;
let activeFilm = $('filmA'), spareFilm = $('filmB'), voiceSource = null, audioContext = null;
let sceneToken = 0, lastTick = 0, lastRender = 0, crowdOn = false, crowdClock = 0, taskClock = 0, resultShown = false;
const media = new Map(), audioData = new Map(), audioBuffers = new Map();
const feedRows = [], pendingTimers = new Set();
const crowdNames = ['小林', '打工人阿南', '可可', '晚风', '一颗桃', '阿橙', '小周', '月亮', '小北', '圆圆', '栗子', '阿西'].map(x => `模拟·${x}`);
const crowdLines = ['总裁下班啦', '老板，该涨薪了', '今天好漂亮', '跳一个嘛', '不加班了，回家吧', '总裁你好'];
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => $('toast').hidden = true, 3000); }
function later(fn, ms) { const timer = setTimeout(() => { pendingTimers.delete(timer); fn(); }, ms); pendingTimers.add(timer); }
function name() { return $('nickname').value.trim().slice(0, 16) || '路过的你'; }
function line(text, context = '') { $('line').textContent = `“${text}”`; $('lineContext').textContent = context; }
function addFeed(actor, text, gift = false) {
  feedRows.unshift({ actor, text, gift }); feedRows.splice(18);
  $('feed').replaceChildren(...feedRows.map(row => { const li = document.createElement('li'); if (row.gift) li.className = 'gift-row'; const who = document.createElement('span'); who.className = 'who'; who.textContent = row.actor; li.append(who, document.createTextNode(row.text)); return li; }));
}
function setControls() {
  const can = running && !paused && game.phase === 'playing';
  document.querySelectorAll('[data-gift],[data-comment],#send,#comment,#crowd,#burst').forEach(el => el.disabled = !can);
  $('pause').disabled = !running || resultShown; $('pause').textContent = paused ? '▶ 继续' : 'Ⅱ 暂停';
  $('mobileDock').hidden = !can;
}
function render() {
  $('seconds').textContent = game.left; $('score').textContent = game.score; $('scoreFill').style.width = `${game.score}%`;
  $('mood').textContent = game.won ? '下班成功！她终于破功了' : game.score >= 65 ? '嘴上说不，身体很诚实' : game.score >= 30 ? '她快要绷不住了' : '高冷值，暂时在线';
  $('queueStatus').textContent = game.phase === 'closing' ? `停止接收 · 还有 ${game.pending} 份出演中` : game.pending ? `${game.pending} 份礼物合并演出` : running ? '接住了，就会给回应' : '等你开场';
  const groups = [...(game.active && game.active.kind !== 'opening' ? [game.active] : []), ...game.queue];
  $('queue').replaceChildren(...groups.map((g, i) => { const el = document.createElement('span'); el.className = g === game.active ? 'current' : ''; el.textContent = g.kind === 'gift' ? `${g === game.active ? '▶' : '待演'} ${GIFTS[g.gift].name} Lv.${g.level} · ${g.receipts.length}份` : `回应「${INTENTS[g.intent].name}」`; return el; }));
  for (const key of Object.keys(GIFTS)) {
    const combo = game.combo[key], alive = combo && game.elapsed - combo.at <= 12 && running;
    document.querySelector(`[data-gift="${key}"]`).dataset.combo = alive ? combo.level : 0;
    document.querySelector(`[data-level="${key}"]`).textContent = alive ? combo.level >= 3 ? 'Lv.3 满级 · 再加戏 ↗' : `Lv.${combo.level} → 再送升 ${combo.level + 1} 级` : '送一份 ↗';
    document.querySelector(`.mobile-gift[data-gift="${key}"] small`).textContent = alive ? combo.level >= 3 ? 'Lv.3 反差拉满' : `Lv.${combo.level} · 再送升级` : '连送升级';
  }
  $('souvenirs').replaceChildren(...Object.entries(game.aftermath).map(([key, level]) => { const el = document.createElement('span'); el.textContent = `${['', 'Ⅰ', 'Ⅱ', 'Ⅲ'][level]} ${GIFTS[key].names[level - 1]}`; return el; }));
  setControls();
}
async function speak(key) {
  if (voiceSource) { voiceSource.stop(); voiceSource = null; }
  if (!sound || !audioContext) return;
  if (!audioBuffers.has(key)) audioBuffers.set(key, await audioContext.decodeAudioData(audioData.get(key).slice(0)));
  const source = audioContext.createBufferSource(); source.buffer = audioBuffers.get(key); const gain = audioContext.createGain(); gain.gain.value = .9; source.connect(gain).connect(audioContext.destination); source.start(); voiceSource = source;
}
function chime(level) {
  if (!sound || !audioContext) return;
  const at = audioContext.currentTime;
  [0, 1, ...(level === 3 ? [2, 3] : [])].forEach((step) => { const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.type = 'sine'; osc.frequency.value = [440, 554.37, 659.25, 880][step]; gain.gain.setValueAtTime(0, at + step * .08); gain.gain.linearRampToValueAtTime(.045, at + step * .08 + .01); gain.gain.exponentialRampToValueAtTime(.0001, at + step * .08 + .35); osc.connect(gain).connect(audioContext.destination); osc.start(at + step * .08); osc.stop(at + step * .08 + .36); });
}
async function film(key, loop = false) {
  const token = ++sceneToken, next = spareFilm;
  next.src = media.get(key); next.loop = loop; next.muted = true; next.currentTime = 0;
  const available = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('演出加载超时')); }, 12000);
    function cleanup() { clearTimeout(timer); next.removeEventListener('canplay', ready); next.removeEventListener('error', failed); }
    function ready() { cleanup(); resolve(); }
    function failed() { cleanup(); reject(new Error('视频无法播放')); }
    next.addEventListener('canplay', ready, { once: true }); next.addEventListener('error', failed, { once: true }); next.load();
  });
  await available; if (token !== sceneToken) return;
  await next.play(); if (paused) next.pause();
  const previous = activeFilm; next.classList.add('current'); previous.classList.remove('current'); activeFilm = next; spareFilm = previous;
  later(() => { if (spareFilm === previous) previous.pause(); }, 250);
}
function decoration(key, level) {
  $('stage').dataset.effect = `${key}${level}`; $('effects').replaceChildren();
  // Light confetti supplements, rather than replaces, the filmed performance.
  if (key === 'party' && level >= 2) {
    for (let i = 0; i < (level === 3 ? 24 : 10); i++) { const p = document.createElement('i'); p.style.cssText = `--x:${(i * 37) % 100}%;--r:${i * 31}deg;--color:${['#ebc48a', '#c09ac0', '#98c2cf'][i % 3]};--dur:${3.6 + (i % 4) * .5}s;--delay:${-(i % 6) * .6}s`; $('effects').append(p); }
  }
}
async function perform(group) {
  busy = true; taskClock = 0;
  try {
    if (group.kind === 'gift') {
      const key = `${group.gift}${group.level}`;
      await film(key); group.duration = manifest.clips[key].duration;
      const actors = [...new Set(group.receipts.map(x => x.actor))];
      $('impactFrom').textContent = `${actors.slice(0, 2).join('、')}${actors.length > 2 ? ` 等 ${actors.length} 人` : ''} · ${group.receipts.length} 份模拟礼物`;
      $('impactTitle').textContent = GIFTS[group.gift].names[group.level - 1]; $('impactLevel').textContent = `LEVEL 0${group.level} / ${group.level === 3 ? '反差拉满' : '再送一次，继续升级'}`; $('impact').hidden = false;
      $('giftReceipt').textContent = `正在出演「${GIFTS[group.gift].names[group.level - 1]}」· 这一场接住 ${group.receipts.length} 份模拟礼物`;
      line(manifest.voices[key].text, `${GIFTS[group.gift].name} · Lv.${group.level}`); decoration(group.gift, group.level); chime(group.level);
      await speak(key); addFeed('沈总', `出演「${GIFTS[group.gift].names[group.level - 1]}」· 接住 ${group.receipts.length} 份`, true);
    } else {
      group.duration = Math.max(4, manifest.voices[group.intent].duration + .5);
      line(INTENTS[group.intent].text, `回应「${INTENTS[group.intent].name}」· ${group.count} 次呼声`);
      await speak(group.intent); addFeed('沈总', INTENTS[group.intent].text);
    }
    busy = false;
  } catch (error) {
    busy = false; pause(true); $('pauseOverlay').querySelector('p').textContent = `${error.message}，这份礼物仍然保留。点继续重试。`; group.retry = true;
  }
}
function submit(event) {
  if (paused) return;
  const result = game.submit(event);
  if (!result.ok) { toast(result.reason); return; }
  if (event.kind === 'gift') { $('giftReceipt').textContent = result.message; addFeed(event.actor, `送出 ${GIFTS[event.gift].name} → Lv.${result.level}`, true); if (!event.actor.startsWith('模拟·')) chime(1); if (window.matchMedia('(max-width:630px)').matches) toast(result.message); }
  else { $('replyReceipt').textContent = result.message; addFeed(event.actor, event.text); }
  render();
}
function crowdBurst() {
  for (let i = 0; i < 50; i++) submit({ kind: 'comment', actor: crowdNames[i % 12], text: crowdLines[i % 6] });
  for (let i = 0; i < 9; i++) submit({ kind: 'gift', actor: crowdNames[i], gift: Object.keys(GIFTS)[i % 3] });
  $('giftReceipt').textContent = '9 份礼物已合为 3 组最高档演出；每位参与者都已记下。'; toast('50 条评论 + 9 份礼物已进入本轮，看看她能不能撑住。');
}
async function start() {
  if (running) return;
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume();
  game = new Round(); game.start(); running = true; paused = false; busy = false; resultShown = false; crowdOn = false; crowdClock = 0; taskClock = 0; feedRows.length = 0;
  $('feed').replaceChildren(); $('entry').hidden = true; $('result').hidden = true; $('pauseOverlay').hidden = true; $('impact').hidden = true; $('effects').replaceChildren(); $('crowd').textContent = '加入 12 位模拟观众'; $('stage').dataset.effect = 'none';
  $('replyReceipt').textContent = '试试发“总裁，下班啦”，免费评论也能让她破功。'; $('giftReceipt').textContent = '同一种礼物，12 秒内连送三次，能看到三个不同档位。';
  line(manifest.voices.welcome.text, '已开场 · 评论或礼物都能拆台'); addFeed('沈总', '已入座。今晚谁先出招？'); await speak('welcome');
  // The opening is held as one performance, so rapid first gifts cannot cut her off.
  game.active = { kind: 'opening', duration: manifest.voices.welcome.duration + .2, scored: true };
  await film('idle', true); lastTick = performance.now(); render();
  if (window.matchMedia('(max-width:630px)').matches) $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function finishRound() {
  resultShown = true; running = false; crowdOn = false; $('impact').hidden = true; $('effects').replaceChildren(); $('stage').dataset.effect = 'none';
  const voice = game.won ? 'win' : 'end'; line(manifest.voices[voice].text, '本场收官'); await speak(voice);
  $('resultKicker').textContent = game.won ? '高冷人设，今天休息' : '她还在努力维持体面';
  $('resultTitle').textContent = game.won ? '准点下班，批准。' : '差一点，她就破功了。';
  $('resultCopy').textContent = `破功 ${game.score}/100 · ${game.commentCount} 条评论。${game.won ? '你们把一场加班，变成了下班派对。' : '下轮试试连送同一种礼物，或召唤模拟观众一起拆台。'}`;
  $('resultGifts').textContent = game.performed; $('resultPeople').textContent = game.actors.size; render();
  later(() => { $('result').hidden = false; }, 2400);
}
async function pause(value = !paused) {
  if (!running) return;
  paused = value; $('pauseOverlay').hidden = !paused;
  if (paused) { activeFilm.pause(); if (audioContext?.state === 'running') await audioContext.suspend(); }
  else { if (audioContext?.state === 'suspended') await audioContext.resume(); if (game.active?.retry) { delete game.active.retry; await perform(game.active); } else await activeFilm.play(); }
  lastTick = performance.now(); render();
}
function frame(time) {
  const dt = Math.min(.1, Math.max(0, (time - lastTick) / 1000)); lastTick = time;
  if (running && !paused && !busy) {
    game.advance(dt);
    if (game.active) {
      taskClock += dt;
      const group = game.active;
      if (taskClock >= group.duration * .48 && group.kind !== 'opening') game.peak();
      if (taskClock >= group.duration) {
        if (group.kind === 'opening') game.active = null;
        else { game.finish(); if (group.kind === 'gift') $('giftReceipt').textContent = `「${GIFTS[group.gift].names[group.level - 1]}」已演完 · 本轮已接住 ${game.performed} 份`; }
        $('impact').hidden = true; $('effects').replaceChildren(); $('stage').dataset.effect = 'none'; taskClock = 0;
        const next = game.next();
        if (next) perform(next);
        else { busy = true; film('idle', true).then(() => { busy = false; }).catch(error => { busy = false; pause(true); toast(error.message); }); }
      }
    } else { const next = game.next(); if (next) perform(next); }
    if (game.phase === 'ended' && !resultShown) finishRound();
    if (crowdOn && game.phase === 'playing') { crowdClock += dt; if (crowdClock > 2) { crowdClock = 0; const i = Math.floor(game.elapsed / 2); submit({ kind: 'comment', actor: crowdNames[i % 12], text: crowdLines[i % 6] }); if (i % 4 === 0) submit({ kind: 'gift', actor: crowdNames[(i + 3) % 12], gift: Object.keys(GIFTS)[i % 3] }); } }
    if (time - lastRender >= 100) { render(); lastRender = time; }
  }
  requestAnimationFrame(frame);
}
async function share() {
  const url = new URL('ceo.html', location.href).href;
  try { await navigator.clipboard.writeText(url); toast('试玩链接已复制，可以发给朋友了。'); }
  catch { const input = document.createElement('input'); input.value = url; $('toast').replaceChildren(document.createTextNode('复制这个链接：'), input); $('toast').hidden = false; input.select(); }
}
async function prepare() {
  $('start').disabled = true;
  try {
    const response = await fetch('ceo-premium/manifest.json'); if (!response.ok) throw new Error('素材清单暂时不可用'); manifest = await response.json();
    if (Object.keys(manifest.clips).length !== 10 || Object.keys(manifest.voices).length !== 17) throw new Error('演出素材还在准备');
    const entries = Object.entries(manifest.clips); let completed = 0;
    // Three concurrent downloads keep mobile startup predictable; clips are small H.264 files.
    const jobs = [...entries.map(([key, value]) => async () => { const r = await fetch(value.file); if (!r.ok) throw new Error('演出视频加载失败'); media.set(key, URL.createObjectURL(await r.blob())); completed++; $('loading').textContent = `角色演出准备 ${completed} / ${entries.length}`; }), ...Object.entries(manifest.voices).map(([key, value]) => async () => { const r = await fetch(value.file); if (!r.ok) throw new Error('配音加载失败'); audioData.set(key, await r.arrayBuffer()); })];
    await Promise.all(Array.from({ length: 3 }, async () => { while (jobs.length) await jobs.shift()(); }));
    await film('idle', true); $('start').disabled = false; $('start').textContent = '进入她的办公室 →'; $('loading').textContent = '点击开启声音 · 90 秒 · 所有礼物免费模拟';
  } catch (error) { $('start').disabled = false; $('start').textContent = '重新准备演出 ↻'; $('loading').textContent = `${error.message}，请点上方重试。`; manifest = null; }
}
$('start').addEventListener('click', () => manifest ? start() : prepare());
$('again').addEventListener('click', start);
$('pause').addEventListener('click', () => pause()); $('resume').addEventListener('click', () => pause(false));
$('sound').addEventListener('click', async () => { sound = !sound; $('sound').textContent = sound ? '声音开 ◖' : '声音关 ◗'; $('sound').setAttribute('aria-pressed', String(sound)); if (!sound && voiceSource) { voiceSource.stop(); voiceSource = null; } if (sound && audioContext?.state === 'suspended' && !paused) await audioContext.resume(); });
document.querySelectorAll('[data-gift]').forEach(button => button.addEventListener('click', () => submit({ kind: 'gift', actor: name(), gift: button.dataset.gift })));
document.querySelectorAll('[data-comment]').forEach(button => button.addEventListener('click', () => submit({ kind: 'comment', actor: name(), text: button.dataset.comment })));
$('commentForm').addEventListener('submit', event => { event.preventDefault(); const text = $('comment').value.trim(); if (!text) return; submit({ kind: 'comment', actor: name(), text }); $('comment').value = ''; });
$('mobileTalk').addEventListener('click', () => { $('mobileForm').hidden = !$('mobileForm').hidden; if (!$('mobileForm').hidden) $('mobileComment').focus(); });
$('mobileForm').addEventListener('submit', event => { event.preventDefault(); const text = $('mobileComment').value.trim(); if (!text) return; submit({ kind:'comment', actor:name(), text }); $('mobileComment').value = ''; $('mobileForm').hidden = true; $('mobileComment').blur(); toast('评论收到了，留意她的回应。'); });
$('crowd').addEventListener('click', () => { crowdOn = !crowdOn; $('crowd').textContent = crowdOn ? '暂停模拟观众' : '加入 12 位模拟观众'; toast(crowdOn ? '12 位模拟观众会轮流发表评论和送礼。' : '模拟观众已暂停。'); });
$('burst').addEventListener('click', crowdBurst);
['shareTop', 'shareResult'].forEach(id => $(id).addEventListener('click', share));
document.addEventListener('visibilitychange', () => { if (document.hidden && running && !paused) pause(true); });
window.addEventListener('pagehide', () => { for (const url of media.values()) URL.revokeObjectURL(url); });
requestAnimationFrame(frame); prepare();
