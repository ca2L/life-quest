// 人生周格子算法：借鉴 LifeProgress / Life-Progress-Visualization 的核心模型。
// 把一生按周切成格子，已度过 / 未来用不同状态标记，并附带人生阶段语义。

function parseDate(str) {
  if (!str) return null
  const parts = String(str).split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null
  const d = new Date(parts[0], parts[1] - 1, parts[2])
  return isNaN(d.getTime()) ? null : d
}

const STAGES = [
  { max: 12, name: '童年', desc: '探索世界' },
  { max: 18, name: '少年', desc: '寻找方向' },
  { max: 25, name: '青年', desc: '建立自我' },
  { max: 40, name: '壮年', desc: '深耕事业' },
  { max: 60, name: '中年', desc: '承担责任' },
  { max: 999, name: '长者', desc: '传承智慧' },
]

function stageOf(age) {
  for (let i = 0; i < STAGES.length; i++) {
    if (age < STAGES[i].max) return STAGES[i]
  }
  return STAGES[STAGES.length - 1]
}

// 人生阶段里程碑：把一生切成 6 个阶段节点，用于全景的「人生长卷」横向刻度。
// 每个阶段有年龄区间、名称、副标题，以及相对 grid 的状态（done/current/future）。
function buildLifeMilestones(grid) {
  if (!grid) return []
  const ranges = [
    { name: '童年', subtitle: '探索世界', from: 0, to: 12 },
    { name: '少年', subtitle: '寻找方向', from: 12, to: 18 },
    { name: '青年', subtitle: '建立自我', from: 18, to: 25 },
    { name: '壮年', subtitle: '深耕事业', from: 25, to: 40 },
    { name: '中年', subtitle: '承担责任', from: 40, to: 60 },
    { name: '长者', subtitle: '传承智慧', from: 60, to: grid.targetAge },
  ]
  const age = grid.currentAge
  return ranges
    .filter((r) => r.from < grid.targetAge)
    .map((r) => {
      const to = Math.min(r.to, grid.targetAge)
      let state = 'future'
      if (age >= to) state = 'done'
      else if (age >= r.from) state = 'current'
      return {
        name: r.name,
        subtitle: r.subtitle,
        label: `${r.from}–${to}`,
        state,
        percent: Math.max(0, Math.min(100, Math.round(((Math.min(age, to) - r.from) / Math.max(1, to - r.from)) * 100))),
      }
    })
}

function buildLifeGrid(birthday, targetAge) {
  const birth = parseDate(birthday)
  const age = Math.max(1, Math.min(120, Number(targetAge) || 80))
  if (!birth) return null

  const now = new Date()
  const totalWeeks = age * 52
  const livedMs = Math.max(0, now.getTime() - birth.getTime())
  const livedDays = Math.floor(livedMs / 86400000)
  const livedWeeks = Math.max(0, Math.min(totalWeeks, Math.floor(livedDays / 7)))
  const yearsLived = Math.floor(livedDays / 365.25)
  const remainingWeeks = totalWeeks - livedWeeks
  const currentYearIndex = Math.floor(livedWeeks / 52)
  const weekInYear = livedWeeks % 52
  const currentAge = Math.floor(livedDays / 365.25)
  const stage = stageOf(currentAge)

  // 十年聚焦视图的窗口：保证当前年龄落在可见范围内。
  let decadeStart = Math.floor(currentYearIndex / 10) * 10
  if (decadeStart + 10 > age) decadeStart = Math.max(0, age - 10)
  const decadeEnd = Math.min(age, decadeStart + 10)

  return {
    totalWeeks,
    livedWeeks,
    remainingWeeks,
    yearsLived,
    percent: Math.round((livedWeeks / totalWeeks) * 1000) / 10,
    birthday,
    targetAge: age,
    currentYearIndex,
    weekInYear,
    currentAge,
    stage,
    decadeStart,
    decadeEnd,
  }
}

// 全景数据：按「十年」分组的块视图。每个十年块含 10 个小格（每年一格），
// 比「每年一条横带」可读性高得多，也避免了 6240 个周格子的卡顿。
function buildDecadeBlocks(grid) {
  if (!grid) return []
  const blocks = []
  const totalDecades = Math.ceil(grid.targetAge / 10)
  for (let d = 0; d < totalDecades; d++) {
    const startAge = d * 10
    const endAge = Math.min(startAge + 10, grid.targetAge)
    const years = []
    for (let age = startAge; age < endAge; age++) {
      const livedInYear = Math.max(0, Math.min(52, grid.livedWeeks - age * 52))
      let state = 'future'
      if (livedInYear >= 52) state = 'lived'
      else if (livedInYear > 0) state = 'partial'
      if (age === grid.currentYearIndex) state = 'now'
      years.push({ age, state, pct: Math.round((livedInYear / 52) * 100) })
    }
    // 该十年整体完成度
    const decadesLived = Math.max(0, Math.min(10, (grid.livedWeeks - startAge * 52) / 52))
    blocks.push({
      label: `${startAge}–${endAge - 1}`,
      startAge,
      stage: stageOf(startAge).name,
      isCurrent: grid.currentYearIndex >= startAge && grid.currentYearIndex < endAge,
      pct: Math.round((decadesLived / years.length) * 100),
      years,
    })
  }
  return blocks
}

// 十年视图的降级数据：52 个真实周格子 × N 年（canvas 不可用时使用）。
function buildDecadeRows(grid) {
  if (!grid) return []
  const rows = []
  for (let year = grid.decadeStart; year < grid.decadeEnd; year++) {
    const cells = []
    for (let w = 0; w < 52; w++) {
      const index = year * 52 + w
      const lived = index < grid.livedWeeks
      const isNow = year === grid.currentYearIndex && w === grid.weekInYear
      cells.push(isNow ? 'now' : lived ? 'lived' : 'future')
    }
    rows.push({ year, label: String(year), cells })
  }
  return rows
}

// 方案 B：足迹时间轴。把十年窗口内的足迹按年龄聚合到年份节点，
// 让「十年」从单纯的时间流逝，变成「这十年发生了什么」的故事线。
// 分类色标与足迹页 CATEGORIES 保持一致。
const CATEGORY_META = {
  life: { icon: '✨', color: '#7c6cf0' },
  food: { icon: '🍜', color: '#e8804a' },
  fun: { icon: '🎮', color: '#d4537e' },
  travel: { icon: '✈️', color: '#3d9be9' },
  growth: { icon: '🌱', color: '#57a83c' },
  work: { icon: '💼', color: '#b07b1f' },
  family: { icon: '👨', color: '#1d9e75' },
  love: { icon: '💗', color: '#e0557a' },
}

function buildFootprintTimeline(grid, footprints) {
  if (!grid) return { years: [], total: 0, activeYears: 0 }
  const birthYear = parseDate(grid.birthday) ? parseDate(grid.birthday).getFullYear() : null
  const byAge = {}
  let total = 0
  ;(footprints || []).forEach((f) => {
    if (!f || !f.occurred_at) return
    const y = Number(String(f.occurred_at).slice(0, 4))
    if (!Number.isFinite(y) || birthYear == null) return
    const age = y - birthYear
    if (age < grid.decadeStart || age >= grid.decadeEnd) return
    if (!byAge[age]) byAge[age] = []
    const meta = CATEGORY_META[f.category] || CATEGORY_META.life
    byAge[age].push({
      title: f.title || '一段回忆',
      location: f.location_name || '',
      icon: meta.icon,
      color: meta.color,
      category: f.category || 'life',
    })
    total += 1
  })

  const years = []
  for (let age = grid.decadeStart; age < grid.decadeEnd; age++) {
    const items = (byAge[age] || []).slice().sort((a, b) => 0)
    let state = 'future'
    if (age < grid.currentYearIndex) state = 'lived'
    else if (age === grid.currentYearIndex) state = 'now'
    years.push({
      age,
      state,
      count: items.length,
      marks: items.slice(0, 4),
      more: Math.max(0, items.length - 4),
    })
  }
  return {
    years,
    total,
    activeYears: years.filter((y) => y.count > 0).length,
  }
}

function buildDecadeTimeline(grid, footprints) {
  return buildFootprintTimeline(grid, footprints)
}

module.exports = { buildLifeGrid, buildDecadeBlocks, buildDecadeRows, buildFootprintTimeline, buildDecadeTimeline, buildLifeMilestones, stageOf }
