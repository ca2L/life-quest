/**
 * 同行统计 · 唯一数据源 = 真实足迹记录
 *
 * 背景：世界页角色卡以前显示的是角色表里的 meet_count 计数器，
 * 它由示例数据（6 次 / 12 次）和「勾选一次 +1」累加而来，
 * 既可能凭空出现，也会和真实足迹对不上，属于虚假数据。
 *
 * 现在改为直接扫 footprints 表的 people 字段：
 *  - 一段足迹里出现某人 1 次，就算 1 段共同足迹；同一段里重复名字去重。
 *  - 主角「我 / 自己 / 本人」不计入同行（沿用全站约定）。
 *  - 只认角色卡里存在的名字；未建档的同行者单独列出，不混进任何角色。
 *  - 每次都返回可核对的明细记录，页面上能逐条看到依据。
 */
const { peopleList } = require('./life-models')

const SELF_NAMES = ['我', '自己', '本人']

function clean(s) { return String(s == null ? '' : s).trim() }

function isSelfName(name) {
  return SELF_NAMES.indexOf(name) >= 0
}

/** 一段足迹里的同行者（去重 + 去掉主角） */
function footprintPeople(f) {
  const seen = {}
  const out = []
  peopleList(f && f.people).forEach((raw) => {
    const name = clean(raw)
    if (!name || isSelfName(name) || seen[name]) return
    seen[name] = true
    out.push(name)
  })
  return out
}

function dateOf(f) {
  return clean(f && (f.occurred_at || f.created_at)).slice(0, 10)
}

/**
 * @param {Array} characters 角色卡（含 id/name/relation）
 * @param {Array} footprints 真实足迹（含 id/title/people/occurred_at/location_name）
 * @param {Object} options { isSelf(character), recordLimit }
 * @returns {{ rows, byName, totalLinks, footprintsWithPeople, charactersWithRecords, unlinkedNames, unlinkedCount }}
 */
function buildCompanionStats(characters, footprints, options) {
  const opt = options || {}
  const chars = Array.isArray(characters) ? characters : []
  const feet = Array.isArray(footprints) ? footprints : []
  const limit = Math.max(1, Number(opt.recordLimit) || 8)
  const isSelf = typeof opt.isSelf === 'function'
    ? opt.isSelf
    : (c) => !!(c && (c.relation === '主角' || clean(c.name) === '我'))

  const charNames = {}
  chars.forEach((c) => {
    if (isSelf(c)) return
    const name = clean(c && c.name)
    if (name) charNames[name] = true
  })

  const byName = {}
  let totalLinks = 0
  let footprintsWithPeople = 0
  feet.forEach((f) => {
    const day = dateOf(f)
    const place = clean(f && f.location_name)
    const title = clean(f && f.title) || '无标题'
    const people = footprintPeople(f)
    if (people.length) footprintsWithPeople += 1
    people.forEach((name) => {
      totalLinks += 1
      let s = byName[name]
      if (!s) {
        s = byName[name] = {
          name, count: 0, firstAt: '', lastAt: '', places: {}, records: [],
        }
      }
      s.count += 1
      if (day) {
        if (!s.firstAt || day < s.firstAt) s.firstAt = day
        if (!s.lastAt || day > s.lastAt) s.lastAt = day
      }
      if (place) s.places[place] = true
      s.records.push({
        id: f && f.id != null ? f.id : '',
        title,
        date: day,
        place,
      })
    })
  })

  const rows = chars.map((c) => {
    const name = clean(c && c.name)
    const self = isSelf(c)
    const s = name && !self ? byName[name] : null
    const records = s
      ? s.records.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit)
      : []
    const count = s ? s.count : 0
    return {
      id: c && c.id != null ? c.id : '',
      name,
      isSelf: self,
      meetCount: count,
      meetText: count ? '🤝 同行 ' + count + ' 段足迹' : '🤝 还没有共同足迹',
      firstMetAt: s ? s.firstAt : '',
      lastMetAt: s ? s.lastAt : '',
      lastMetText: s && s.lastAt ? '最近 ' + s.lastAt : '',
      placesCount: s ? Object.keys(s.places).length : 0,
      totalRecords: count,
      records,
      sharedOpen: false,
    }
  })

  const unlinkedNames = Object.keys(byName)
    .filter((name) => !charNames[name])
    .map((name) => ({ name, count: byName[name].count }))
    .sort((a, b) => b.count - a.count)

  return {
    rows,
    byName,
    totalLinks,
    footprintsWithPeople,
    charactersWithRecords: rows.filter((r) => !r.isSelf && r.meetCount > 0).length,
    unlinkedNames,
    unlinkedCount: unlinkedNames.reduce((s, x) => s + x.count, 0),
  }
}

module.exports = {
  SELF_NAMES,
  footprintPeople,
  buildCompanionStats,
}
