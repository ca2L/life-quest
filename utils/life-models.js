/**
 * 人生模型层：关系熵 + 人生资产负债表
 *
 * 设计原则（重要，别改）：
 *  1. 纯函数，不依赖 wx / 云 SDK，可在 node 里直接跑验证。
 *  2. **不编造数据**。没有记录的维度明说「未建立」，用代理指标时必须标注 basis。
 *  3. 输出「判断」而不是指标堆砌；措辞克制，不做压力监控。
 *  4. 「休息」记为资产而非缺席：打卡中断的天数按休整处理，不扣分。
 */

// ── 通用日期工具（字符串比较，避免时区把日期算偏一天）──────────────────
function pad(n) { return String(n).padStart(2, '0') }
function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
function parseDay(s) {
  const t = String(s || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7)), d = Number(t.slice(8, 10))
  return Date.UTC(y, m - 1, d)
}
function daysBetween(from, to) {
  const a = parseDay(from), b = parseDay(to)
  if (a == null || b == null) return 0
  return Math.round((b - a) / 86400000)
}
function todayOr(arg) {
  return arg || dateStr(new Date())
}
function yearOf(s) {
  const t = String(s || '').slice(0, 10)
  return /^\d{4}/.test(t) ? Number(t.slice(0, 4)) : null
}

// 同行人员可能是 JSON 数组字符串、逗号分隔字符串或真数组
function peopleList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') {
    const t = v.trim()
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t)
        if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
      } catch (e) { /* 落到下面按分隔符拆 */ }
    }
    return t.split(/[,，、;；]/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }
function num(n) { return Number(n) || 0 }

// 饱和映射：早期增长明显、后期不爆表，避免「记了 3 年就永远 100 分」
function saturate(raw, scale) {
  if (!scale) return 0
  return clamp(Math.round(100 * (1 - Math.exp(-Math.max(0, raw) / scale))), 0, 100)
}

// ── 一、关系熵：带时间衰减的活跃度模型 ────────────────────────────────
/**
 * 亲密度不随时间下降，但「活跃度」会。用指数衰减 exp(-days/tau)：
 *  tau 随亲密度变长（关系越深，越经得起时间），初识 45 天、灵魂羁绊 225 天。
 * entropy = (1 - activity) * 100，越高表示越久没联系。
 * 最后一次见面 = max(相识日期, 该角色出现在足迹 people 里的最晚 occurred_at)。
 */
function buildRelationshipEntropy(options) {
  const opt = options || {}
  const characters = Array.isArray(opt.characters) ? opt.characters : []
  const footprints = Array.isArray(opt.footprints) ? opt.footprints : []
  const today = todayOr(opt.today)
  const dismissed = opt.dismissed && typeof opt.dismissed === 'object' ? opt.dismissed : {}

  // 预先按名字建「最晚同行日期」索引，避免每个角色都扫一遍全量足迹
  const lastSeenByName = {}
  footprints.forEach((f) => {
    const day = String(f.occurred_at || f.created_at || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
    peopleList(f.people).forEach((name) => {
      if (!lastSeenByName[name] || day > lastSeenByName[name]) lastSeenByName[name] = day
    })
  })

  const rows = characters.map((c) => {
    const name = String(c.name || '').trim()
    if (!name) return null
    const metDate = String(c.metDate || c.met_date || '').slice(0, 10)
    const seen = lastSeenByName[name] || ''
    const lastSeenAt = seen && (!metDate || seen > metDate) ? seen : (metDate || '')
    const daysSince = lastSeenAt ? Math.max(0, daysBetween(lastSeenAt, today)) : null
    const intimacy = num(c.intimacy)
    const tau = 45 + clamp(intimacy / 300, 0, 1) * 180
    const activity = daysSince == null ? 0.5 : Math.exp(-daysSince / tau)
    const entropy = clamp(Math.round((1 - activity) * 100), 0, 100)

    let tier = 'active'
    if (daysSince == null) tier = 'unknown'
    else if (entropy >= 70 && daysSince >= 21) tier = 'quiet'
    else if (entropy >= 45 && daysSince >= 21) tier = 'soft'

    // 措辞克制：不出现「应该」「该」「别忘了」，不做评价
    let hint = ''
    if (tier === 'quiet') hint = `和 ${name} 有 ${daysSince} 天没见了。若刚好想起，可以打个招呼。`
    else if (tier === 'soft') hint = `和 ${name} 有些日子没见了，顺其自然就好。`
    else if (tier === 'unknown') hint = `${name} 还没记下相识日期，补上后才知道过了多久。`

    return {
      id: c.id,
      name,
      relation: c.relation || '',
      intimacy,
      lastSeenAt,
      daysSince,
      tau: Math.round(tau),
      entropy,
      tier,
      hint,
      dismissed: !!dismissed[c.id || name],
    }
  }).filter(Boolean)

  rows.sort((a, b) => (b.entropy - a.entropy) || ((b.daysSince || 0) - (a.daysSince || 0)))
  return {
    today,
    rows,
    // 只推一条，且必须可关闭；避免变成一列「你该联系谁」的压力清单
    reminder: pickEntropyReminder(rows, today),
  }
}

function pickEntropyReminder(rows, today) {
  const key = todayOr(today)
  const candidates = (rows || []).filter((r) => (
    (r.tier === 'quiet' || r.tier === 'soft') && !r.dismissed
  ))
  return candidates.length ? candidates[0] : null
}

// ── 二、人生资产负债表 ────────────────────────────────────────────────
/**
 * 五个账户按用户提案命名，但**逐一标注数据基础**：
 *  - growth   成长：XP / 完成任务 / 打卡            → measured（真实）
 *  - health   健康：以作息节奏代理                  → proxy（无生理数据）
 *  - relation 关系：角色卡 / 亲密度 / 同行足迹      → proxy（亲密度是主观值）
 *  - skill    技能：学习类主线 + 书架阅读           → proxy（无认证数据）
 *  - finance  财务：当前完全无记录                  → none（不估算、不编造）
 *
 * 折旧与复利：
 *  - 关系 / 技能按年折旧 ×0.88（久不维护会自然贬值）
 *  - 成长按年复利 ×1.03（累计经验不会消失，还会增值）
 *  - 健康只看最近 90 天的节奏，天然滚动，不做跨年累计
 *  - 休整天数不扣分：中断只影响「连续性」，不减存量
 */
const ACCOUNT_META = [
  { key: 'growth', name: '成长', icon: '✦', basis: 'measured', label: '真实记录',
    desc: '累计 XP、完成的主线、打卡次数', scale: 700, compound: 1.03 },
  { key: 'health', name: '健康', icon: '◌', basis: 'proxy', label: '作息代理',
    desc: '最近 90 天的打卡节奏与休整天数（无睡眠/运动数据）', scale: 45, decay: 1 },
  { key: 'relation', name: '关系', icon: '♡', basis: 'proxy', label: '主观代理',
    desc: '角色卡数量、亲密度、同行足迹（亲密度为主观赋值）', scale: 320, decay: 0.88 },
  { key: 'skill', name: '技能', icon: '⌘', basis: 'proxy', label: '学习代理',
    desc: '成长类主线完成数、书架阅读卡片（无技能认证数据）', scale: 60, decay: 0.88 },
  { key: 'finance', name: '财务', icon: '◇', basis: 'none', label: '未建立',
    desc: '当前没有任何财务记录，不估算、不编造', scale: 0 },
]

function distinctPlaces(footprints) {
  const places = new Set(), countries = new Set()
  footprints.forEach((f) => {
    const p = String(f.location_name || '').trim()
    if (p) places.add(p)
    const c = String(f.country || '').trim()
    if (c) countries.add(c)
  })
  return { places: places.size, countries: countries.size }
}

function buildBalanceSheet(options) {
  const opt = options || {}
  const profile = opt.profile || {}
  const quests = Array.isArray(opt.quests) ? opt.quests : []
  const checkins = Array.isArray(opt.checkins) ? opt.checkins : []
  const footprints = Array.isArray(opt.footprints) ? opt.footprints : []
  const characters = Array.isArray(opt.characters) ? opt.characters : []
  const today = todayOr(opt.today)
  const thisYear = Number(today.slice(0, 4))

  // 年份切片：从有记录的最早一年到今年，最多展示 12 年
  const allDates = []
  checkins.forEach((c) => allDates.push(c.checkin_date || c.created_at))
  footprints.forEach((f) => allDates.push(f.occurred_at || f.created_at))
  quests.forEach((q) => allDates.push(q.created_at))
  const years = allDates.map(yearOf).filter((y) => y && y <= thisYear)
  const firstYear = years.length ? Math.min.apply(null, years) : thisYear
  const startYear = Math.max(firstYear, thisYear - 11)
  const yearList = []
  for (let y = startYear; y <= thisYear; y++) yearList.push(y)

  const places = distinctPlaces(footprints)
  const totalIntimacy = characters.reduce((s, c) => s + num(c.intimacy), 0)
  const companionFootprints = footprints.filter((f) => peopleList(f.people).length > 0).length
  const learningQuests = quests.filter((q) => (
    q.status === 'done' && /成长|学习|技能|阅读|growth|study/i.test(String(q.chapter || '') + String(q.quest_type || '') + String(q.title || ''))
  )).length
  const readCards = clamp(num(opt.readCards), 0, 999)

  const rawByKey = {
    growth: num(profile.xp) + quests.filter((q) => q.status === 'done').length * 25 + checkins.length * 8,
    health: 0, // 每年单独算最近 90 天
    relation: characters.length * 30 + totalIntimacy * 0.6 + companionFootprints * 12,
    skill: learningQuests * 20 + readCards * 1.5,
    finance: 0,
  }

  // 按年累计存量：成长复利，关系/技能折旧，健康只看当年节奏
  const series = []
  let stock = { growth: 0, health: 0, relation: 0, skill: 0 }
  yearList.forEach((y) => {
    const inYear = (d) => yearOf(d) === y
    const yearCheckins = checkins.filter((c) => inYear(c.checkin_date || c.created_at))
    const yearQuests = quests.filter((q) => q.status === 'done' && inYear(q.created_at))
    const yearFootprints = footprints.filter((f) => inYear(f.occurred_at || f.created_at))

    // 成长：当年新增后按年复利
    const growthAdd = num(profile.xp) * (y === thisYear ? 1 : 0) * 0 // XP 是累计量，不按年拆
      + yearQuests.length * 25 + yearCheckins.length * 8
    stock.growth = y === yearList[0]
      ? growthAdd
      : stock.growth * 1.03 + growthAdd

    // 关系：当年新增角色/足迹后折旧
    const relAdd = characters.filter((c) => inYear(c.createdAt || c.created_at)).length * 30
      + yearFootprints.filter((f) => peopleList(f.people).length > 0).length * 12
    stock.relation = y === yearList[0] ? relAdd : stock.relation * 0.88 + relAdd

    // 技能：当年完成的学习类主线后折旧
    const skillAdd = yearQuests.filter((q) => /成长|学习|技能|阅读|growth|study/i.test(String(q.chapter || '') + String(q.quest_type || '') + String(q.title || ''))).length * 20
    stock.skill = y === yearList[0] ? skillAdd : stock.skill * 0.88 + skillAdd

    // 健康：最近 90 天节奏。休整天数不扣分，只算「有记录的日子」
    const yearStart = `${y}-01-01`
    const yearEnd = y === thisYear ? today : `${y}-12-31`
    const activeDays = new Set()
    yearCheckins.forEach((c) => {
      const d = String(c.checkin_date || c.created_at || '').slice(0, 10)
      if (d >= yearStart && d <= yearEnd) activeDays.add(d)
    })
    // 今年的「最近 90 天」，往年均按全年节奏折算
    const windowDays = y === thisYear ? 90 : Math.max(1, daysBetween(yearStart, yearEnd))
    const recent = [...activeDays].filter((d) => daysBetween(d, yearEnd) <= windowDays).length
    stock.health = recent

    const values = {
      growth: saturate(stock.growth, 700),
      health: saturate(stock.health, 45),
      relation: saturate(stock.relation, 320),
      skill: saturate(stock.skill, 60),
    }
    const established = Object.keys(values)
    const netWorth = Math.round(established.reduce((s, k) => s + values[k], 0) / established.length)
    series.push({ year: y, values, netWorth, checkins: yearCheckins.length, footprints: yearFootprints.length })
  })

  const last = series[series.length - 1] || { values: {}, netWorth: 0, year: thisYear }
  const prev = series.length > 1 ? series[series.length - 2] : null

  const accounts = ACCOUNT_META.map((m) => {
    const value = m.basis === 'none' ? null : (last.values[m.key] || 0)
    const delta = prev && value != null ? value - (prev.values[m.key] || 0) : 0
    return Object.assign({}, m, {
      value,
      delta,
      raw: Math.round(rawByKey[m.key] || 0),
      trend: delta > 3 ? 'up' : delta < -3 ? 'down' : 'flat',
    })
  })

  // 判断，而不是指标复述
  const ranked = accounts.filter((a) => a.value != null).slice().sort((a, b) => b.value - a.value)
  const strongest = ranked[0]
  const weakest = ranked[ranked.length - 1]
  const judgments = []
  if (strongest && weakest && strongest.key !== weakest.key) {
    judgments.push(`资本集中在「${strongest.name}」，「${weakest.name}」最薄。补最薄的一块，比继续加码最强的那块更划算。`)
  }
  const rel = accounts.find((a) => a.key === 'relation')
  if (rel && rel.value != null) {
    judgments.push(`关系资本按年折旧 12%：不维护会自然贬值，一次同行或一条故事线就能补回来。`)
  }
  if (prev) {
    const diff = last.netWorth - prev.netWorth
    judgments.push(diff >= 0
      ? `净值比上一年 +${diff}，主要来自累计型账户的复利。`
      : `净值比上一年 ${diff}，多是折旧型账户自然回落，不代表这一年过得不好。`)
  }
  const restDays = checkins.length ? Math.max(0, 90 - new Set(checkins.map((c) => String(c.checkin_date || '').slice(0, 10))).size) : 0
  judgments.push(`休息记为资产：最近 90 天里约 ${restDays} 天没有打卡，按休整计入，未扣任何分。`)
  judgments.push(`财务账户未建立。若以后要启用，需要新增一张只有本人可见的收支/资产表——在此之前不估算、不编造。`)

  const caveats = [
    '健康 / 关系 / 技能是代理指标，分别以作息节奏、主观亲密度、学习类主线代替，不等于真实体检、社交质量或能力认证。',
    '财务账户当前无任何数据，不参与净值计算；净值是其余四个账户的等权平均。',
    '折旧与复利系数（关系/技能 ×0.88、成长 ×1.03）是模型假设，用于呈现趋势，不是精算结果。',
  ]

  return {
    asOf: today,
    accounts,
    netWorth: last.netWorth,
    series,
    judgments,
    caveats,
    places,
    totalIntimacy,
    companionFootprints,
    readCards,
    learningQuests,
  }
}

module.exports = {
  dateStr,
  daysBetween,
  peopleList,
  buildRelationshipEntropy,
  pickEntropyReminder,
  buildBalanceSheet,
  ACCOUNT_META,
  saturate,
}
