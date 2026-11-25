/**
 * 播放历史：本地记录播放事件，供每日推荐打分。
 *
 * 设计：
 *  - storage key = lifePlayHistory，环形上限 500 条（按时间淘汰最旧）
 *  - 记录 { id, name, category, scene, at }（at = 时间戳 ms）
 *  - 偏好聚合输出 categoryTop / sceneTop / recentIds，推荐引擎直接消费
 *  - 只记事件不做任何上传，隐私保留在本机
 */

const KEY = 'lifePlayHistory'
const MAX_RECORDS = 500

function safeWx() {
  return typeof wx !== 'undefined' ? wx : null
}

function readAll() {
  const w = safeWx()
  try {
    const v = w && typeof w.getStorageSync === 'function' ? w.getStorageSync(KEY) : []
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

function writeAll(list) {
  const w = safeWx()
  try {
    if (w && typeof w.setStorageSync === 'function') {
      w.setStorageSync(KEY, list.slice(-MAX_RECORDS))
    }
  } catch (e) { /* 存储失败不影响播放 */ }
}

/**
 * 记录一次播放。track: { id?, name/title, category?, source_url/url?, cloudPath? }
 * scene: 当前场景 key（focus/commute/...），没有就传 ''
 */
function record(track, scene) {
  if (!track) return
  const name = String(track.name || track.title || '').slice(0, 60)
  if (!name) return
  const fingerprint = String(track.source_url || track.url || track.cloudPath || track.id || name)
  const list = readAll()
  // 同一首歌 60 秒内重复触发（切进度、重播）不重复计数
  const last = list[list.length - 1]
  if (last && last.fingerprint === fingerprint && Date.now() - last.at < 60000) return
  list.push({
    fingerprint: fingerprint.slice(0, 120),
    id: String(track.id || ''),
    name,
    category: String(track.category || '').slice(0, 24),
    scene: String(scene || '').slice(0, 16),
    at: Date.now(),
  })
  writeAll(list)
}

/** 分类偏好（倒序），maxN 个 { category, count } */
function categoryTop(maxN) {
  const n = Math.max(1, Number(maxN) || 5)
  const counter = {}
  readAll().forEach((r) => {
    const c = r.category || '未分类'
    counter[c] = (counter[c] || 0) + 1
  })
  return Object.keys(counter)
    .map((c) => ({ category: c, count: counter[c] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/** 场景偏好（倒序），maxN 个 { scene, count } */
function sceneTop(maxN) {
  const n = Math.max(1, Number(maxN) || 3)
  const counter = {}
  readAll().forEach((r) => {
    if (!r.scene) return
    counter[r.scene] = (counter[r.scene] || 0) + 1
  })
  return Object.keys(counter)
    .map((s) => ({ scene: s, count: counter[s] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/** 最近听过的指纹集合（默认 3 天内），用于「不重复打扰」和「最近喜欢」 */
function recentFingerprints(withinMs) {
  const window = Number(withinMs) || 3 * 24 * 3600 * 1000
  const since = Date.now() - window
  const out = []
  readAll().forEach((r) => {
    if (r.at >= since && r.fingerprint) out.push(r.fingerprint)
  })
  return out
}

/** 总播放次数与是否为空（页面用来决定推荐文案） */
function summary() {
  const list = readAll()
  return { total: list.length, empty: list.length === 0 }
}

function clearAll() {
  writeAll([])
}

module.exports = { record, categoryTop, sceneTop, recentFingerprints, summary, clearAll, KEY }
