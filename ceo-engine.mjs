export const GIFTS = {
  coffee: { name: '续命咖啡', names: ['优雅续命', '超大杯续命', '野心那么大杯'], tag: '咖啡越喝越离谱', color: '#e5ae77' },
  wind: { name: '下班的风', names: ['发型有想法', '报表起飞', '全公司放飞'], tag: '让她的报表先下班', color: '#a6d9e8' },
  party: { name: '派对礼炮', names: ['礼花试探', '椅子自己会跳', '总裁彻底放飞'], tag: '高冷总裁，原地开趴', color: '#e7b4d6' },
};
export const INTENTS = {
  leave: { name: '下班', text: '下班？先把这份……算了，明天再说。' },
  raise: { name: '涨薪', text: '涨薪的建议，我听见了。先给你点个赞。' },
  praise: { name: '夸夸', text: '眼光不错。这句话，可以再说一遍。' },
  dance: { name: '跳舞', text: '想看我跳舞？先把音乐关了。' },
  hello: { name: '打招呼', text: '新来的？坐。今天允许你拆一次台。' },
};
export function classify(text) {
  if (/下班|放假|休息|回家|摸鱼|别卷|不干|加班/.test(text)) return 'leave';
  if (/涨薪|加薪|工资|奖金|红包|钱/.test(text)) return 'raise';
  if (/漂亮|好看|美|帅|喜欢|爱你|女神|气质|夸/.test(text)) return 'praise';
  if (/跳|舞|扭|蹦|嗨|唱|音乐/.test(text)) return 'dance';
  if (/你好|嗨|哈喽|来了|在吗|总裁|老板|hello/i.test(text)) return 'hello';
  return null;
}
// Events enter at this boundary; the rest of the engine only receives normalized data.
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !['gift', 'comment'].includes(raw.kind)) return null;
  if (typeof raw.actor !== 'string' || !raw.actor.trim() || raw.actor.length > 40) return null;
  const actor = raw.actor.trim().slice(0, 16);
  if (raw.kind === 'gift') return Object.hasOwn(GIFTS, raw.gift) ? { kind: 'gift', actor, gift: raw.gift } : null;
  if (typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 160) return null;
  return { kind: 'comment', actor, text: raw.text.trim() };
}
export class Round {
  constructor() {
    this.phase = 'ready'; this.elapsed = 0; this.score = 0; this.queue = []; this.active = null;
    this.receipts = []; this.comments = []; this.combo = {}; this.actorVotes = new Map(); this.votes = {};
    this.actors = new Set(); this.giftCount = 0; this.commentCount = 0; this.performed = 0;
    this.replyAt = 0; this.won = false; this.sequence = 0; this.aftermath = {}; this.giftStreak = 0;
  }
  start() { if (this.phase === 'ready') this.phase = 'playing'; }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || this.phase !== 'playing') return;
    this.elapsed = Math.min(90, this.elapsed + seconds);
    if (this.elapsed >= 90) this.phase = 'closing';
  }
  submit(raw) {
    const event = normalize(raw);
    if (!event) return { ok: false, reason: '内容无效，请重新输入。' };
    if (this.phase !== 'playing') return { ok: false, reason: '这轮已停止接收互动，等她演完就揭晓结果。' };
    this.actors.add(event.actor);
    if (event.kind === 'comment') {
      const intent = classify(event.text); this.commentCount++;
      const vote = intent && this.elapsed - (this.actorVotes.get(event.actor) ?? -10) >= 3;
      if (vote) { this.actorVotes.set(event.actor, this.elapsed); this.votes[intent] = (this.votes[intent] || 0) + 1; }
      const row = { ...event, intent, id: ++this.sequence, vote: !!vote };
      this.comments.push(row); if (this.comments.length > 60) this.comments.shift();
      return { ok: true, ...row, message: intent ? `收到${event.actor}的「${INTENTS[intent].name}」${vote ? '，她会挑呼声最高的话回应' : '，同一人 3 秒计一次呼声'}` : '收到这句话；试试“下班”“涨薪”“跳舞”或夸她，能触发对应回应。' };
    }
    this.giftCount++;
    const previous = this.combo[event.gift];
    const level = previous && this.elapsed - previous.at <= 12 ? Math.min(3, previous.level + 1) : 1;
    this.combo[event.gift] = { level, at: this.elapsed };
    const receipt = { id: ++this.sequence, actor: event.actor, gift: event.gift, level, state: 'queued' };
    this.receipts.push(receipt);
    // One waiting performance per gift kind, retaining every donor receipt.
    let group = this.queue.find(item => item.gift === event.gift);
    if (group) { group.level = Math.max(group.level, level); group.receipts.push(receipt); }
    else { group = { kind: 'gift', gift: event.gift, level, receipts: [receipt] }; this.queue.push(group); }
    return { ok: true, receipt, level, merged: group.receipts.length > 1, message: `${GIFTS[event.gift].names[level - 1]} · Lv.${level} ${this.active || this.queue.length > 1 ? '已排入演出' : '准备出演'}` };
  }
  next() {
    if (this.active || !['playing', 'closing'].includes(this.phase)) return null;
    if (this.phase === 'playing' && this.elapsed - this.replyAt >= 6 && Object.keys(this.votes).length && (!this.queue.length || this.giftStreak >= 2)) {
      const [intent, count] = Object.entries(this.votes).sort((a, b) => b[1] - a[1])[0];
      this.votes = {}; this.replyAt = this.elapsed; this.giftStreak = 0;
      this.active = { kind: 'reply', intent, count };
      return this.active;
    }
    if (this.queue.length) {
      this.giftStreak++;
      this.active = this.queue.shift();
      for (const receipt of this.active.receipts) receipt.state = 'playing';
      return this.active;
    }
    if (this.phase === 'closing') { this.phase = 'ended'; return null; }
    return null;
  }
  finish() {
    const group = this.active; if (!group) return;
    if (group.kind === 'gift') {
      for (const receipt of group.receipts) receipt.state = 'done';
      this.performed += group.receipts.length;
      this.aftermath[group.gift] = Math.max(this.aftermath[group.gift] || 0, group.level);
    }
    if (!group.scored) this.peak();
    this.active = null;
    return group;
  }
  peak() {
    const group = this.active; if (!group || group.scored) return;
    group.scored = true;
    this.score = Math.min(100, this.score + (group.kind === 'gift' ? [9, 17, 26][group.level - 1] : Math.min(16, group.count * 3 + 3)));
    this.won ||= this.score >= 100;
  }
  get left() { return Math.max(0, Math.ceil(90 - this.elapsed)); }
  get pending() { return this.receipts.filter(row => row.state !== 'done').length; }
}
