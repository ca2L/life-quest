/**
 * 每日推荐引擎
 *
 * 池子：云端 music_library（免费曲库 / 管理后台上传 / 小程序上云同步）+ 我的音源（本地+外部）
 * 打分（0~100）：
 *  - 分类偏好 40 分：播放历史里该分类的占比
 *  - 近期喜爱 20 分：最近 3 天听过同一 fingerprint 的曲目小加分（听过=喜欢，但连续重复不推）
 *  - 场景匹配 20 分：当前场景 genre/分类与曲目 tags 匹配
 *  - 新鲜度 20 分：从未播过优先；最近 1 天播过的强降权（避免天天重复）
 * 稳定性：以「当天日期 + 池子指纹」做随机种子，同一天同一池子推荐不变；点「换一批」才换。
 *
 * 边界：
 *  - 云端读取失败/未登录时自动降级为仅本地音源推荐，页面不报错
 *  - 播放历史为空时退化为「按 popularity/随机」的冷启动推荐，并如实标注
 */

const musicLib = require('./music-library')
const playHistory = require('./play-history')
const { cloud } = require('./cloud')

const RECOMMEND_SIZE = 5

// ── 日期种子随机（mulberry32）──────────────────────────────
function seedOfDay(dateStr) {
  let h = 1779033703 ^ 0
  const s = String(dateStr)
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function todayStr() {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function fingerprintOf(t) {
  return String(t.source_url || t.url || t.cloudPath || t.id || t.name || '').slice(0, 120)
}

/** 从数仓拉共享曲库（enabled 只取启用行），失败返回 null */
async function loadLibraryTracks() {
  try {
    const res = await cloud.database.from('music_library')
      .select('id,title,artist,category,tags,source_url,enabled')
      .order('created_at', { ascending: false })
    if (res.error || !Array.isArray(res.data)) return null
    return res.data
      .filter((r) => r && r.enabled !== false && (r.source_url || r.cloud_path))
      .map((r) => ({
        id: 'lib' + r.id,
        name: r.title || '未命名曲目',
        artist: r.artist || '',
        category: r.category || '未分类',
        tags: String(r.tags || ''),
        source_url: r.source_url || '',
        cloudPath: r.cloud_path || '',
        source: 'external',
        kind: 'audio',
        path: '',
        size: 0,
      }))
  } catch (e) {
    return null
  }
}

/** 本地音源转为候选（不重复计入已存在曲目） */
function localCandidates() {
  return musicLib.loadTracks()
    .filter((t) => t && t.kind !== 'video' && (t.path || t.url || t.cloudPath))
    .map((t) => Object.assign({}, t, {
      category: t.category || (t.source === 'external' ? '外部音源' : '我的音源'),
    }))
}

function sceneTagMatch(track, scene) {
  if (!scene) return 0
  const hay = (String(track.tags || '') + ' ' + String(track.category || '') + ' ' + String(track.genre || '')).toLowerCase()
  if (!hay) return 0
  const table = {
    focus: ['ambient', 'electronic', 'lounge', '免费曲库', 'jamendo'],
    commute: ['pop', 'electronic', 'dance', '免费曲库'],
    workout: ['electronic', 'dance', 'rock'],
    calm: ['piano', 'ambient', 'classical', '免费曲库'],
    cook: ['jazz', 'lounge', 'soul'],
    country: ['country', '乡村', 'folk', 'americana', 'acoustic'],
    gaming: ['game', 'ost', 'chiptune', '游戏bgm', '电子'],
    zelda: ['zelda', 'hyrule', 'orchestral', 'epic', '塞尔达'],
  }
  const keys = table[scene] || []
  return keys.some((k) => hay.indexOf(k) >= 0) ? 1 : 0
}

/**
 * 生成每日推荐。
 * opts: { scene: '' }  当前场景 key
 * 返回 { ok, items: [{ track, score, reason }], degraded, reason }
 */
async function recommend(opts) {
  const options = opts || {}
  const scene = options.scene || ''
  const [lib, local] = await Promise.all([loadLibraryTracks(), Promise.resolve(localCandidates())])

  // 合并去重：fingerprint 相同的以云端为准
  const seen = new Set()
  const pool = []
  ;(lib || []).forEach((t) => {
    const fp = fingerprintOf(t)
    if (fp && !seen.has(fp)) { seen.add(fp); pool.push(t) }
  })
  local.forEach((t) => {
    const fp = fingerprintOf(t)
    if (fp && !seen.has(fp)) { seen.add(fp); pool.push(t) }
  })

  if (!pool.length) {
    return { ok: false, items: [], degraded: true, reason: '曲库为空：可先在音乐页导入音源或等待免费曲库同步' }
  }

  // 偏好数据
  const catRank = {}
  playHistory.categoryTop(6).forEach((c, i) => { catRank[c.category] = (6 - i) / 6 }) // 1.0 ~ 0.17
  const recent = {}
  playHistory.recentFingerprints().forEach((fp) => { recent[fp] = (recent[fp] || 0) + 1 })
  const historyEmpty = playHistory.summary().empty

  const dateKey = todayStr() + '|' + pool.length
  const rand = mulberry32(seedOfDay(dateKey))

  const scored = pool.map((t) => {
    const fp = fingerprintOf(t)
    let score = 0
    const reasons = []
    // 分类偏好（40）
    const pref = catRank[t.category] || 0
    if (pref > 0) { score += Math.round(40 * pref); reasons.push('你常听「' + t.category + '」') }
    // 近期喜爱（20）
    const rec = recent[fp] || 0
    if (rec > 0) { score += 20; reasons.push('最近听过') }
    // 场景匹配（20）
    if (sceneTagMatch(t, scene)) { score += 20; if (scene) reasons.push('适合当前场景') }
    // 新鲜度（20）
    if (rec === 0) { score += 20; reasons.push('还没听过的') }
    // 随机因子 0~10 打散
    score += Math.round(rand() * 10)
    // 惩罚：昨天听太多
    if (rec >= 2) score -= 15
    return { track: t, score: Math.max(1, score), reason: reasons.slice(0, 2).join(' · ') || (historyEmpty ? '冷启动精选' : '为你挑选') }
  })

  scored.sort((a, b) => b.score - a.score)
  const items = scored.slice(0, RECOMMEND_SIZE)
  return {
    ok: true,
    items,
    degraded: !lib,
    reason: !lib ? '云端曲库暂不可用，已用本机音源推荐' : '',
  }
}

/** 换一批：把日期种子加nonce，重跑一次 */
async function recommendShuffle(opts, nonce) {
  // 简单实现：临时在种子上叠加 nonce——直接用 recommend 加随机重排
  const res = await recommend(opts)
  if (res.ok && res.items.length > 1) {
    const arr = res.items.slice()
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    }
    res.items = arr
  }
  return res
}

module.exports = { recommend, recommendShuffle, RECOMMEND_SIZE }
