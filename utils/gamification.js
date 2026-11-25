// 游戏化引擎：连击、成就徽章、暴击奖励。
// 设计来源：Octalysis 八轴（成就 / 稀缺 / 不可预测 / 损失厌恶）+ Hook 可变奖励。

const CHAPTERS = [
  { key: '序章', name: '序章', subtitle: '故事开始的地方', icon: '01' },
  { key: '第一章 · 启程', name: '第一章 · 启程', subtitle: '离开舒适区', icon: '02' },
  { key: '第二章 · 成长', name: '第二章 · 成长', subtitle: '积累与沉淀', icon: '03' },
  { key: '第三章 · 深耕', name: '第三章 · 深耕', subtitle: '把事做到极致', icon: '04' },
  { key: '第四章 · 收获', name: '第四章 · 收获', subtitle: '兑现长期主义', icon: '05' },
  { key: '终章 · 传说', name: '终章 · 传说', subtitle: '写下你的传奇', icon: '06' },
]

const LEVEL_TITLES = [
  '见习冒险者', '新手旅人', '进阶行者', '资深探索者',
  '人生赢家', '传奇勇者', '传说主宰', '不朽传说',
]

// 连续打卡：以今天或昨天为锚点向前数连续天数；今天未打卡不算断。
function calcStreak(checkins) {
  const days = new Set()
  ;(checkins || []).forEach((c) => {
    if (c && c.checkin_date) days.add(String(c.checkin_date).slice(0, 10))
  })
  if (!days.size) return { current: 0, best: 0 }

  const sorted = Array.from(days).sort()
  let best = 0
  let run = 0
  let prev = null
  sorted.forEach((day) => {
    if (prev && dayDiff(prev, day) === 1) run += 1
    else run = 1
    if (run > best) best = run
    prev = day
  })

  const today = dateKey(new Date())
  const yesterday = dateKey(offsetDay(new Date(), -1))
  let anchor = days.has(today) ? today : (days.has(yesterday) ? yesterday : null)
  let current = 0
  while (anchor && days.has(anchor)) {
    current += 1
    anchor = dateKey(offsetDay(parseDay(anchor), -1))
  }
  return { current, best }
}

function parseDay(str) {
  const parts = String(str).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return new Date()
  return new Date(parts[0], parts[1] - 1, parts[2])
}

function dateKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function offsetDay(d, n) {
  const out = new Date(d.getTime())
  out.setDate(out.getDate() + n)
  return out
}

function dayDiff(a, b) {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86400000)
}

// 可变奖励：多数 1 倍，小概率暴击。避免每次固定 XP 带来的钝化。
function rollReward(baseXp) {
  const base = Math.max(1, Number(baseXp) || 1)
  const roll = Math.random()
  let multiplier = 1
  let label = ''
  if (roll < 0.01) { multiplier = 3; label = '传说暴击' }
  else if (roll < 0.09) { multiplier = 2; label = '双倍暴击' }
  else if (roll < 0.28) { multiplier = 1.5; label = '幸运加成' }
  return {
    xp: Math.round(base * multiplier),
    multiplier,
    label,
    crit: multiplier > 1,
  }
}

// 成就徽章：基于已有数据派生，不额外建表。
function buildBadges(ctx) {
  const quests = ctx.quests || []
  const checkins = ctx.checkins || []
  const profile = ctx.profile || {}
  const streak = ctx.streak || { current: 0, best: 0 }
  const level = ctx.level || 1
  const done = quests.filter((q) => q.status === 'done')
  const doneMain = done.filter((q) => q.quest_type === 'main').length
  const doneSide = done.filter((q) => q.quest_type === 'side').length

  // 借鉴小黑盒统计页：每个成就带「完成度百分比 + 进度条」，而非只有已解锁/未解锁。
  // current/target 由现有数据派生，前端不手填。
  const defs = [
    { id: 'first', name: '初出茅庐', desc: '完成第一个任务', icon: '✦', group: '启程', current: done.length, target: 1 },
    { id: 'time', name: '时间旅人', desc: '设置生日，开启人生地图', icon: '钟', group: '启程', current: profile.birthday ? 1 : 0, target: 1 },
    { id: 'streak7', name: '持之以恒', desc: '连续打卡 7 天', icon: '火', group: '精进', current: streak.best, target: 7 },
    { id: 'checkin30', name: '百炼成钢', desc: '累计打卡 30 次', icon: '卅', group: '精进', current: checkins.length, target: 30 },
    { id: 'main3', name: '主线先锋', desc: '完成 3 个主线任务', icon: '剑', group: '精进', current: doneMain, target: 3 },
    { id: 'side5', name: '支线大师', desc: '完成 5 个支线任务', icon: '星', group: '精进', current: doneSide, target: 5 },
    { id: 'lv5', name: '升级达人', desc: '达到 Lv.5', icon: 'Ⅴ', group: '传说', current: level, target: 5 },
    { id: 'planner', name: '人生规划师', desc: '创建 10 个任务', icon: '图', group: '传说', current: quests.length, target: 10 },
    { id: 'lv10', name: '满级传说', desc: '达到 Lv.10', icon: '冠', group: '传说', current: level, target: 10 },
  ].map((b) => {
    const pct = Math.min(100, Math.round((b.current / Math.max(1, b.target)) * 100))
    return Object.assign({}, b, { unlocked: b.current >= b.target, progress: pct })
  })
  const unlocked = defs.filter((b) => b.unlocked)
  return { list: defs, unlockedCount: unlocked.length, total: defs.length, recent: unlocked.slice(-3) }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function chapterStats(quests) {
  return CHAPTERS.map((ch) => {
    const items = quests.filter((q) => (q.chapter || '序章') === ch.key)
    const done = items.filter((q) => q.status === 'done').length
    return Object.assign({}, ch, {
      total: items.length,
      done,
      percent: items.length ? Math.round((done / items.length) * 100) : 0,
      active: items.filter((q) => q.status !== 'done').length,
    })
  })
}

module.exports = {
  CHAPTERS,
  LEVEL_TITLES,
  calcStreak,
  rollReward,
  buildBadges,
  greeting,
  chapterStats,
  dateKey,
}
