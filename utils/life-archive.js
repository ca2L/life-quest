/**
 * 人生存档聚合层：把云端表 + 本地存储编译成一份可迁移、可切片的标准化快照。
 *
 * 所有下游功能（年报 / 原声带 / 关系熵 / 资产负债表 / 导出）都只依赖这里，
 * 不各自去读表，避免同一份数据在不同页面算出不同结果。
 *
 * 设计原则：
 *  - 云端读取失败不抛错，降级到「已有本地数据 + 明确标记」，页面永远有内容可看。
 *  - 支持 sources 注入，方便在 node 里做纯数据验证。
 *  - 导出的是开放格式（JSON + 自包含 HTML），不依赖本 App 才能读。
 */

const musicLib = require('./music-library')
const { daysBetween } = require('./life-models')
const { footprintPeople } = require('./companion-stats')
const bookshelf = require('./bookshelf')

const SCHEMA = 'life-quest/archive@1'
const CHAR_KEY = 'lq_characters_v1'
const TRACK_MAP_KEY = 'footprintTracks'   // footprintId → trackId（记录足迹时当时在听的歌）
const DISMISS_KEY = 'lifeEntropyDismissed'
// 历史遗留：lifeReadCards 从未被写入过，readCards 以前恒为 0。
// 现在 readCards 直接取「我的书架」里 status=read 的真实本数。
const READ_KEY = 'lifeReadCards'

// ── 本地存储读写（全部带兜底，storage 不可用不致命）────────────────────
function lsGet(key, fallback) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(key)
      return v === '' || v == null ? fallback : v
    }
  } catch (e) { /* 忽略 */ }
  return fallback
}
function lsSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(key, value)
    }
  } catch (e) { /* 忽略 */ }
}

function readTrackMap() {
  const v = lsGet(TRACK_MAP_KEY, {})
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}
function bindFootprintTrack(footprintId, trackId) {
  if (!footprintId) return
  const map = readTrackMap()
  if (trackId) map[footprintId] = trackId
  else delete map[footprintId]
  lsSet(TRACK_MAP_KEY, map)
}
function unbindFootprintTrack(footprintId) {
  const map = readTrackMap()
  delete map[footprintId]
  lsSet(TRACK_MAP_KEY, map)
}
function readDismissed() {
  const v = lsGet(DISMISS_KEY, {})
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}
function dismissEntropy(id, today) {
  if (!id) return
  const map = readDismissed()
  map[id] = today || ''
  lsSet(DISMISS_KEY, map)
}

function readLocalCharacters() {
  const v = lsGet(CHAR_KEY, [])
  return Array.isArray(v) ? v : []
}

function defaultSources() {
  const store = require('./store')
  return {
    profile: () => store.profileAccess.list(),
    quests: () => store.questAccess.list(),
    checkins: () => store.checkinAccess.list(),
    footprints: () => store.footprintAccess.list(),
    characters: () => store.characterAccess.list(),
  }
}

/** 拉全量数据。返回 { schema, exportedAt, profile, quests, ... , errors, degraded } */
async function collectArchive(sources) {
  const src = sources || defaultSources()
  const results = await Promise.all([
    Promise.resolve().then(src.profile).catch((e) => ({ error: e })),
    Promise.resolve().then(src.quests).catch((e) => ({ error: e })),
    Promise.resolve().then(src.checkins).catch((e) => ({ error: e })),
    Promise.resolve().then(src.footprints).catch((e) => ({ error: e })),
    Promise.resolve().then(src.characters).catch((e) => ({ error: e })),
  ])
  const keys = ['profile', 'quests', 'checkins', 'footprints', 'characters']
  const data = {}
  const errors = []
  results.forEach((r, i) => {
    const err = r && r.error
    data[keys[i]] = err ? [] : (Array.isArray(r && r.data) ? r.data : [])
    if (err) errors.push(keys[i] + '：' + ((err && err.message) || '读取失败'))
  })

  // 云端角色与本地角色按名字合并去重（本地优先，因为角色卡本来就以本地为准）
  const cloudChars = data.characters || []
  const localChars = readLocalCharacters()
  const merged = localChars.slice()
  const seen = {}
  merged.forEach((c) => { seen[String(c.name || '').trim()] = true })
  cloudChars.forEach((c) => {
    const name = String(c.name || '').trim()
    if (name && !seen[name]) { merged.push(c); seen[name] = true }
  })

  const profile = (data.profile && data.profile[0]) || {}
  const musicTracks = musicLib.loadTracks()
  const musicState = lsGet('lifeMusicState', {}) || {}
  const books = bookshelf.loadBooks()
  const readCards = books.filter((b) => b.status === 'read').length

  return {
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    generatedBy: '人生主线任务 · 人生存档',
    profile,
    quests: data.quests || [],
    checkins: data.checkins || [],
    footprints: data.footprints || [],
    characters: merged,
    musicTracks,
    musicState,
    books,
    readCards,
    local: {
      footprintCountries: lsGet('footprintCountries', {}) || {},
      footprintTracks: readTrackMap(),
      lifeMusicTracks: lsGet(musicLib.TRACKS_KEY, []) || [],
      lifeBookshelf: books,
      characters: localChars,
      lifeEntropyDismissed: readDismissed(),
    },
    errors,
    degraded: errors.length > 0,
  }
}

/** 有记录的年份，倒序（今年永远在列，即使还没记录） */
function yearsOf(archive) {
  const set = {}
  const add = (d) => {
    const t = String(d || '').slice(0, 10)
    if (/^\d{4}/.test(t)) set[Number(t.slice(0, 4))] = true
  }
  ;(archive.checkins || []).forEach((c) => add(c.checkin_date || c.created_at))
  ;(archive.footprints || []).forEach((f) => add(f.occurred_at || f.created_at))
  ;(archive.characters || []).forEach((c) => add(c.metDate || c.met_date || c.createdAt))
  ;(archive.quests || []).forEach((q) => add(q.created_at))
  ;(archive.books || []).forEach((b) => add(b.finishedAt || b.createdAt))
  const thisYear = new Date().getFullYear()
  set[thisYear] = true
  return Object.keys(set).map(Number).sort((a, b) => b - a)
}

function dayOf(d) { return String(d || '').slice(0, 10) }
function inYear(d, y) { return dayOf(d).slice(0, 4) === String(y) }

/** 单年切片：年报与原声带共用 */
function buildYearSnapshot(archive, year) {
  const y = Number(year)
  const checkins = (archive.checkins || []).filter((c) => inYear(c.checkin_date || c.created_at, y))
  const questsDone = (archive.quests || []).filter((q) => q.status === 'done' && inYear(q.created_at, y))
  const footprints = (archive.footprints || []).filter((f) => inYear(f.occurred_at || f.created_at, y))
  const newCharacters = (archive.characters || []).filter((c) => inYear(c.metDate || c.met_date || c.createdAt, y))
  // 已读书目按真实「读完日期」归年；没填完成日的书不硬塞进任何一年
  const booksRead = (archive.books || []).filter((b) => b.status === 'read' && inYear(b.finishedAt, y))

  const places = {}, countries = {}, companions = {}, moods = {}, months = {}
  footprints.forEach((f) => {
    const p = String(f.location_name || '').trim()
    if (p) places[p] = (places[p] || 0) + 1
    const c = String(f.country || '').trim()
    if (c) countries[c] = (countries[c] || 0) + 1
    const m = String(f.mood || '').trim()
    if (m) moods[m] = (moods[m] || 0) + 1
    const mo = dayOf(f.occurred_at).slice(5, 7)
    if (mo) months[mo] = (months[mo] || 0) + 1
    // 与世界页角色卡同源：主角不计入、同一段足迹同名只算一次
    footprintPeople(f).forEach((n) => { companions[n] = (companions[n] || 0) + 1 })
  })
  const topOf = (obj) => {
    const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a])
    return keys.length ? { name: keys[0], count: obj[keys[0]] } : null
  }

  const trackMap = (archive.local && archive.local.footprintTracks) || {}
  const tracksById = {}
  ;(archive.musicTracks || []).forEach((t) => { tracksById[t.id] = t })
  const trackCounts = {}
  footprints.forEach((f) => {
    const tid = trackMap[f.id]
    if (tid && tracksById[tid]) {
      const n = tracksById[tid].name
      trackCounts[n] = (trackCounts[n] || 0) + 1
    }
  })

  return {
    year: y,
    checkins: checkins.length,
    questsDone: questsDone.length,
    quests: questsDone,
    footprints: footprints.length,
    footprintList: footprints,
    newCharacters: newCharacters.length,
    characterList: newCharacters,
    booksRead,
    booksReadCount: booksRead.length,
    bookMinutes: booksRead.reduce((s, b) => s + (Number(b.minutes) || 0), 0),
    places: Object.keys(places).length,
    countries: Object.keys(countries).length,
    countryList: Object.keys(countries),
    topPlace: topOf(places),
    topMood: topOf(moods),
    topCompanion: topOf(companions),
    topTrack: topOf(trackCounts),
    months: Array.from({ length: 12 }, (_, i) => months[String(i + 1).padStart(2, '0')] || 0),
    hasData: checkins.length + questsDone.length + footprints.length + newCharacters.length + booksRead.length > 0,
  }
}

// ── 人生原声带：足迹 × 音乐 ──────────────────────────────────────────
/**
 * 优先用「保存足迹时记录的那首歌」；没有记录时按 addedAt 日期就近推断，
 * 并明确标注 inferred=true —— 不把推断伪装成事实。
 */
function buildSoundtrack(archive) {
  const tracks = (archive.musicTracks || []).filter((t) => t && t.kind !== 'video')
  const byId = {}
  tracks.forEach((t) => { byId[t.id] = t })
  const trackMap = (archive.local && archive.local.footprintTracks) || {}

  const dated = tracks.filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(String(t.addedAt || '').slice(0, 10)))
  const nearestTrack = (day) => {
    if (!day || !dated.length) return null
    let best = null, bestGap = Infinity
    dated.forEach((t) => {
      const gap = Math.abs(daysBetween(String(t.addedAt).slice(0, 10), day))
      if (gap < bestGap) { bestGap = gap; best = t }
    })
    // 超过 30 天不硬凑，宁可显示「那年还没记下歌」
    return bestGap <= 30 ? best : null
  }

  const items = (archive.footprints || []).map((f) => {
    const day = dayOf(f.occurred_at || f.created_at)
    const bound = trackMap[f.id] && byId[trackMap[f.id]]
    const inferredTrack = bound ? null : nearestTrack(day)
    return {
      id: f.id,
      day,
      year: day.slice(0, 4),
      place: String(f.location_name || '').trim(),
      country: String(f.country || '').trim(),
      title: String(f.title || '').trim(),
      trackName: bound ? bound.name : (inferredTrack ? inferredTrack.name : ''),
      trackId: bound ? bound.id : (inferredTrack ? inferredTrack.id : ''),
      inferred: !bound && !!inferredTrack,
      bound: !!bound,
    }
  }).sort((a, b) => b.day.localeCompare(a.day))

  // 按年：这一年最常出现的歌
  const byYear = {}
  // 按国家/地点：点亮时该放哪首
  const byCountry = {}
  items.forEach((it) => {
    if (it.trackName) {
      if (!byYear[it.year]) byYear[it.year] = {}
      byYear[it.year][it.trackName] = (byYear[it.year][it.trackName] || 0) + 1
      const key = it.country || it.place || '未标注地点'
      if (!byCountry[key]) byCountry[key] = {}
      byCountry[key][it.trackName] = (byCountry[key][it.trackName] || 0) + 1
    }
  })
  const topOf = (obj) => {
    const ks = Object.keys(obj || {}).sort((a, b) => obj[b] - obj[a])
    return ks.length ? { name: ks[0], count: obj[ks[0]] } : null
  }
  const yearTracks = Object.keys(byYear).sort((a, b) => b.localeCompare(a)).map((y) => ({
    year: y, top: topOf(byYear[y]), total: Object.values(byYear[y]).reduce((s, n) => s + n, 0),
  }))
  const countryTracks = Object.keys(byCountry).map((k) => ({
    country: k, top: topOf(byCountry[k]), footprints: items.filter((i) => (i.country || i.place || '未标注地点') === k).length,
  })).sort((a, b) => b.footprints - a.footprints)

  const withSong = items.filter((i) => i.trackName).length
  return {
    items,
    yearTracks,
    countryTracks,
    total: items.length,
    withSong,
    boundCount: items.filter((i) => i.bound).length,
    inferredCount: items.filter((i) => i.inferred).length,
    coverage: items.length ? Math.round((withSong / items.length) * 100) : 0,
  }
}

// ── 导出：开放格式 ────────────────────────────────────────────────────
function buildArchiveJson(archive) {
  const payload = {
    schema: archive.schema,
    exportedAt: archive.exportedAt,
    generatedBy: archive.generatedBy,
    note: '开放格式，可自行迁移。cloudPath 仅为云端对象路径，不含签名 token；本地文件路径仅在本机有效。',
    counts: {
      quests: (archive.quests || []).length,
      checkins: (archive.checkins || []).length,
      footprints: (archive.footprints || []).length,
      characters: (archive.characters || []).length,
      musicTracks: (archive.musicTracks || []).length,
      books: (archive.books || []).length,
    },
    data: {
      profile: archive.profile || {},
      quests: archive.quests || [],
      checkins: archive.checkins || [],
      footprints: archive.footprints || [],
      characters: archive.characters || [],
      musicTracks: archive.musicTracks || [],
      musicState: archive.musicState || {},
      books: archive.books || [],
      local: archive.local || {},
    },
    warnings: archive.errors || [],
  }
  return JSON.stringify(payload, null, 2)
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 自包含年册 HTML：无外部依赖，双击即可在浏览器打开，也可打印成册 */
function buildYearbookHtml(archive, snapshots) {
  const years = (snapshots || []).slice().sort((a, b) => b.year - a.year)
  const name = (archive.profile && archive.profile.owner_name) || '我'
  const totalFoot = (archive.footprints || []).length
  const totalCheck = (archive.checkins || []).length
  const totalChars = (archive.characters || []).length
  const totalBooks = (archive.books || []).filter((b) => b.status === 'read').length
  const sections = years.map((s) => {
    const bits = []
    if (s.footprints) bits.push(`走过 <b>${s.places}</b> 个地方，点亮 <b>${s.countries}</b> 个国家`)
    if (s.questsDone) bits.push(`完成 <b>${s.questsDone}</b> 条主线`)
    if (s.checkins) bits.push(`留下 <b>${s.checkins}</b> 次打卡`)
    if (s.newCharacters) bits.push(`认识 <b>${s.newCharacters}</b> 个人`)
    if (s.booksReadCount) bits.push(`读完 <b>${s.booksReadCount}</b> 本书`)
    const extras = []
    if (s.booksReadCount) extras.push(`读过：${s.booksRead.slice(0, 6).map((b) => esc(b.title)).join(' · ')}`)
    if (s.topPlace) extras.push(`最常去：${esc(s.topPlace.name)}（${s.topPlace.count} 次）`)
    if (s.topCompanion) extras.push(`最常同行：${esc(s.topCompanion.name)}`)
    if (s.topTrack) extras.push(`那年反复听：${esc(s.topTrack.name)}`)
    if (s.topMood) extras.push(`最常的心情：${esc(s.topMood.name)}`)
    const bars = s.months.map((n, i) => `<div class="mb"><div class="mb-bar" style="height:${Math.max(3, Math.min(52, n * 12))}px"></div><span>${i + 1}</span></div>`).join('')
    return `<section class="year">
      <div class="y-head"><span class="y-num">${s.year}</span><span class="y-tag">${s.hasData ? '有记录的一年' : '留白的一年'}</span></div>
      <p class="y-line">${bits.length ? bits.join('，') + '。' : '这一年没有留下记录。留白也是人生的一部分。'}</p>
      ${extras.length ? `<p class="y-extra">${extras.join('　·　')}</p>` : ''}
      <div class="months">${bars}</div>
    </section>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}的人生年册 · 人生主线任务</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f5fb;color:#17152b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7}
.wrap{max-width:760px;margin:0 auto;padding:40px 24px 80px}
.cover{background:linear-gradient(135deg,#1a1633,#3a2f7a);color:#fff;border-radius:28px;padding:56px 40px;margin-bottom:32px}
.cover .eyebrow{font-size:12px;letter-spacing:.22em;opacity:.7}.cover h1{font-size:38px;margin:14px 0 8px;line-height:1.25}
.cover .sub{opacity:.82;font-size:15px}.cover .stats{display:flex;gap:28px;margin-top:32px;flex-wrap:wrap}
.cover .stat b{display:block;font-size:26px}.cover .stat span{font-size:12px;opacity:.72}
h2{font-size:20px;margin:36px 0 16px;padding-left:12px;border-left:4px solid #7c6cf0}
.year{background:#fff;border-radius:20px;padding:24px 26px;margin-bottom:16px;box-shadow:0 4px 18px rgba(26,22,51,.05)}
.y-head{display:flex;align-items:baseline;gap:12px}.y-num{font-size:28px;font-weight:800;color:#7c6cf0}.y-tag{font-size:12px;color:#a09ab8}
.y-line{margin:10px 0 6px;font-size:15px}.y-extra{margin:0;color:#6f6b88;font-size:13px}
.months{display:flex;align-items:flex-end;gap:6px;height:70px;margin-top:18px}
.mb{flex:1;text-align:center;font-size:10px;color:#b5b0c8}.mb-bar{background:linear-gradient(#9b8cf5,#7c6cf0);border-radius:4px 4px 0 0;margin-bottom:4px}
.note{background:#fff8ee;border:1px solid #f2e2c4;border-radius:16px;padding:18px 20px;color:#8a6d3b;font-size:13px;margin-top:32px}
.foot{text-align:center;color:#a09ab8;font-size:12px;margin-top:28px}
@media print{body{background:#fff}.year{box-shadow:none;border:1px solid #eee;break-inside:avoid}.cover{break-after:page}}
</style></head><body><div class="wrap">
<div class="cover">
  <div class="eyebrow">LIFE · MAIN · QUEST / YEARBOOK</div>
  <h1>${esc(name)}的人生年册</h1>
  <div class="sub">从 ${years.length ? years[years.length - 1].year : '—'} 到 ${years.length ? years[0].year : '—'} · 一份不打分、不排名的记录</div>
  <div class="stats">
    <div class="stat"><b>${totalFoot}</b><span>段足迹</span></div>
    <div class="stat"><b>${totalCheck}</b><span>次打卡</span></div>
    <div class="stat"><b>${totalChars}</b><span>位同行的人</span></div>
    <div class="stat"><b>${totalBooks}</b><span>本已读的书</span></div>
    <div class="stat"><b>${years.length}</b><span>个年份</span></div>
  </div>
</div>
<h2>一年一年</h2>
${sections || '<div class="year"><p class="y-line">还没有可写入的记录。</p></div>'}
<div class="note"><b>关于这份年册</b><br>
这是从「人生主线任务」导出的开放快照，只记录发生过的事，不做评分、不排名、不和任何人比较。
健康 / 技能 / 财务等维度若没有记录就不会出现，也不会被估算。数据主权属于你，JSON 版本可自行迁移到任何工具。</div>
<div class="foot">导出于 ${esc(archive.exportedAt)} · schema ${esc(archive.schema)}</div>
</div></body></html>`
}

module.exports = {
  SCHEMA,
  TRACK_MAP_KEY,
  DISMISS_KEY,
  READ_KEY,
  lsGet,
  lsSet,
  readTrackMap,
  bindFootprintTrack,
  unbindFootprintTrack,
  readDismissed,
  dismissEntropy,
  collectArchive,
  yearsOf,
  buildYearSnapshot,
  buildSoundtrack,
  buildArchiveJson,
  buildYearbookHtml,
  esc,
}
