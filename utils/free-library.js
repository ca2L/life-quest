/**
 * 免费曲库接入：Jamendo（CC 授权音乐，可合法播放与下载）
 *
 * ── 能力边界与合规（务必如实告知用户）──────────────────────────
 * 1. 只接正规免费/CC 授权曲库，不抓取、不破解第三方版权音源；
 *    music001 等聚合站点的音源有版权风险且域名无法加入小程序合法域名，不接。
 * 2. Jamendo API 免费但需要 client_id：到 https://devportal.jamendo.com 注册应用获取，
 *    填到下方 JAMENDO_CLIENT_ID；为空时本模块所有能力静默降级（返回空列表），页面不报错。
 * 3. api.jamendo.com 需加入小程序后台 request/downloadFile 合法域名；
 *    开发者工具里可临时勾选「不校验合法域名」调试。
 * 4. 音频直链存 music_library.source_url（jamendo mp32 流），播放走在线链接；
 *    「下载到云端」用管理后台完成，本模块只做元数据入库（写入共享数仓）。
 * 5. 需要登录态才能写 music_library（RLS owner-only）；未登录时仅返回列表不入库。
 */

const { cloud } = require('./cloud')

const JAMENDO_CLIENT_ID = '' // ← 在 https://devportal.jamendo.com 注册后填到这里
const API_BASE = 'https://api.jamendo.com/v3.0/tracks'
const LIB_CATEGORY = '免费曲库'
const LIB_TAG = 'jamendo'

// 音轨风格 → 场景映射：Jamendo 拉取时按场景常听的 genres 定向取材
const SCENE_GENRES = {
  focus: ['ambient', 'electronic', 'lounge'],
  commute: ['pop', 'electronic', 'dance'],
  workout: ['electronic', 'dance', 'rock'],
  calm: ['piano', 'ambient', 'classical'],
  cook: ['jazz', 'lounge', 'soul'],
  // 以下三组为新增曲库：乡村 / 主机游戏 BGM / 塞尔达风格管弦致敬
  country: ['country', 'folk', 'americana'],
  gaming: ['soundtrack', 'videogame', 'chiptune', 'electronic', 'arcade', 'orchestral', 'epic'],
  zelda: ['orchestral', 'soundtrack', 'classical', 'epic'],
}

function hasKey() {
  return String(JAMENDO_CLIENT_ID || '').trim().length > 0
}

function safeWx() {
  return typeof wx !== 'undefined' ? wx : null
}

/**
 * 拉取一批免费曲目。
 * opts: { scene: 'focus'|..., limit: 20, order: 'popularity_week'|'popularity_total' }
 * 返回 { ok, tracks: [{ title, artist, genre, url, duration, source }], error?, skipped? }
 */
function fetchTracks(opts) {
  const options = opts || {}
  if (!hasKey()) {
    return Promise.resolve({ ok: false, skipped: true, tracks: [], error: '未配置 Jamendo client_id' })
  }
  const w = safeWx()
  if (!w || typeof w.request !== 'function') {
    return Promise.resolve({ ok: false, skipped: true, tracks: [], error: '环境不支持网络请求' })
  }
  const scene = options.scene && SCENE_GENRES[options.scene] ? options.scene : ''
  const genres = scene ? SCENE_GENRES[scene] : SCENE_GENRES.focus
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100)
  const order = options.order === 'popularity_total' ? options.order : 'popularity_week'
  const url = API_BASE
    + '?client_id=' + encodeURIComponent(JAMENDO_CLIENT_ID.trim())
    + '&format=json&limit=' + limit
    + '&order=' + order
    + '&audioformat=mp32'
    + '&imagesize=200'
    + '&tags=' + encodeURIComponent(genres.join('|'))

  return new Promise((resolve) => {
    w.request({
      url,
      method: 'GET',
      timeout: 15000,
      success(res) {
        const body = res && res.data
        const results = body && Array.isArray(body.results) ? body.results : []
        const tracks = results.filter((t) => t && t.audio).map((t) => ({
          title: String(t.name || '未命名').slice(0, 60),
          artist: String(t.artist_name || '').slice(0, 40),
          genre: String(t.musicinfo && t.musicinfo.tags && Array.isArray(t.musicinfo.tags.genres)
            ? t.musicinfo.tags.genres.slice(0, 2).join('/') : '').slice(0, 40),
          url: String(t.audio || ''),
          duration: Math.round((Number(t.duration) || 0)),
          source: LIB_TAG,
        }))
        resolve({ ok: true, tracks, scene })
      },
      fail(e) {
        resolve({ ok: false, tracks: [], error: (e && e.errMsg) || 'Jamendo 请求失败' })
      },
    })
  })
}

function rowOf(track) {
  return {
    title: track.title || '未命名曲目',
    artist: track.artist || '',
    category: LIB_CATEGORY,
    source_url: track.url || '',
    size_bytes: 0,
    duration_sec: Number(track.duration) || 0,
    tags: LIB_TAG,
    enabled: true,
  }
}

/**
 * 把拉到的曲目入库共享数仓 music_library（去重：按 source_url）。
 * 未登录/未配置 key 时安全降级，绝不抛错阻断页面。
 * 返回 { ok, saved, skipped, error? }
 */
async function importToLibrary(tracks) {
  const list = (tracks || []).filter((t) => t && t.url)
  if (!list.length) return { ok: true, saved: 0, skipped: 0 }
  try {
    // 取一页现有记录做本地去重（足够本场景使用，不必全量拉取）
    const exist = await cloud.database.from('music_library').select('source_url').eq('tags', LIB_TAG)
    if (exist.error) return { ok: false, saved: 0, skipped: 0, error: exist.error.message || '读取数仓失败' }
    const known = new Set((Array.isArray(exist.data) ? exist.data : [])
      .map((r) => String(r.source_url || '')).filter(Boolean))
    const fresh = list.filter((t) => !known.has(t.url))
    if (!fresh.length) return { ok: true, saved: 0, skipped: list.length }
    const ins = await cloud.database.from('music_library').insert(fresh.map(rowOf))
    if (ins.error) return { ok: false, saved: 0, skipped: list.length, error: ins.error.message || '写入数仓失败' }
    return { ok: true, saved: fresh.length, skipped: list.length - fresh.length }
  } catch (e) {
    return { ok: false, saved: 0, skipped: 0, error: (e && e.message) || '曲库入库异常' }
  }
}

/** 拉取并入库一步到位；返回 { ok, tracks, saved, error? } */
async function fetchAndImport(opts) {
  const got = await fetchTracks(opts)
  if (!got.ok) return got
  const saved = await importToLibrary(got.tracks)
  return Object.assign({}, got, { saved: saved.saved, importError: saved.error || '' })
}

const SYNC_FLAG = 'lifeJamendoSyncDate'

/**
 * 每日自动同步：每天首次打开小程序时拉一批热门免费曲入库（静默，失败不影响页面）。
 * 轮换场景：周一~周日分别按不同场景取材，一周覆盖全部曲风。
 * 未配置 client_id / 未登录时静默跳过。
 */
async function syncDaily() {
  if (!hasKey()) return { skipped: true }
  const w = safeWx()
  let today = ''
  try {
    const d = new Date()
    const p = (x) => String(x).padStart(2, '0')
    today = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    if (w && typeof w.getStorageSync === 'function' && w.getStorageSync(SYNC_FLAG) === today) {
      return { skipped: true }
    }
  } catch (e) { /* storage 不可用则每次都尝试 */ }

  const sceneKeys = Object.keys(SCENE_GENRES)
  const scene = sceneKeys[new Date().getDay() % sceneKeys.length]
  const result = await fetchAndImport({ scene, limit: 15 })

  try {
    if (w && typeof w.setStorageSync === 'function') w.setStorageSync(SYNC_FLAG, today)
  } catch (e) { /* 忽略 */ }
  return result
}

module.exports = {
  JAMENDO_CLIENT_ID,
  LIB_CATEGORY,
  LIB_TAG,
  SCENE_GENRES,
  hasKey,
  fetchTracks,
  importToLibrary,
  fetchAndImport,
  syncDaily,
  SYNC_FLAG,
}
