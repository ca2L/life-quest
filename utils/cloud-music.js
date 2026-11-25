/**
 * 本地音源上云：把 wxfile:// 持久文件上传到云端对象存储，再换一个 https 直链，
 * 交给 BackgroundAudioManager 实现切微信 / 息屏继续播放。
 *
 * ── 平台边界（务必如实告知用户，不做假承诺）──────────────────────────
 * 1. SDK 小程序端 createMiniProgramFetch 源码明确写着
 *    「暂不支持非字符串 body（ArrayBuffer/FormData 待补）」，
 *    所以 cloud.storage.upload() 传不了二进制文件。
 *    这里用原生 wx.request 复刻 SDK 的裸二进制上传协议（uploadOrUpdate）。
 * 2. storage bucket 非 public：public 直链实测返回 401，且微信后台播放器
 *    不会携带自定义鉴权头，所以唯一可用的是 createSignedUrl —— token 在 URL 里，
 *    无需额外 header，BackgroundAudioManager 可以直连。
 * 3. 签名 URL 最长 1 小时（SDK 常量 MAX_SIGNED_URL_TTL_SECONDS = 3600）。
 *    本模块提前 5 分钟续签；切歌 / 播完 / 回前台都会重新签名。
 *    「息屏后单次连续播放超过 1 小时」属平台限制，不承诺。
 * 4. 上传需登录态（RLS owner-only，匿名调 sign 接口返回 MISSING_CREDENTIALS），
 *    路径固定 users/<uid>/life-music/<trackId>.<ext>，用户之间天然隔离。
 * 5. 只上传自己有权使用的文件；不破解、不绕过任何版权保护。
 */

const { cloud } = require('./cloud')

const ENDPOINT = 'https://mp-api.app.workbuddy.host'
const PUBLISHABLE_KEY = 'wbpk_awGl15NmcYBQWRf2v7t2gC_PIGqt2JhQnNRpU6lAb8Z3KCVzlg84Kwz'
const BUCKET = 'runtime'
const SIGN_TTL = 3600
const REFRESH_BEFORE = 300
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
const SIGN_CACHE_KEY = 'lifeMusicSignedUrls'

const MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm',
}

function extOf(name) {
  return String(name || '').split('.').pop().toLowerCase()
}

function mimeOf(name) {
  return MIME[extOf(name)] || 'application/octet-stream'
}

function safeWx() {
  return typeof wx !== 'undefined' ? wx : null
}

function readCache() {
  const w = safeWx()
  try {
    if (w && typeof w.getStorageSync === 'function') {
      const v = w.getStorageSync(SIGN_CACHE_KEY)
      return v && typeof v === 'object' ? v : {}
    }
  } catch (e) { /* storage 不可用则只用内存缓存 */ }
  return {}
}

function writeCache(map) {
  const w = safeWx()
  try {
    if (w && typeof w.setStorageSync === 'function') w.setStorageSync(SIGN_CACHE_KEY, map)
  } catch (e) { /* 忽略 */ }
}

// 进程内缓存优先：storage 读写在切歌时是同步开销，能省则省
let memoryCache = null

function cache() {
  if (!memoryCache) memoryCache = readCache()
  return memoryCache
}

function putCache(path, url, expiresAt) {
  const c = cache()
  c[path] = { url, expiresAt }
  writeCache(c)
}

function dropCache(path) {
  const c = cache()
  delete c[path]
  writeCache(c)
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

/** 取当前用户 id，兼容 SDK 不同版本的 user 字段命名 */
async function currentUid() {
  try {
    const res = await cloud.auth.getUser()
    const u = res && res.data
    if (!u) return ''
    return String(u.id || u.sub || u.user_id || u.userId || '')
  } catch (e) {
    return ''
  }
}

/** 云对象路径：users/<uid>/life-music/<trackId>.<ext> */
function objectPathOf(uid, track) {
  const ext = extOf(track && (track.name || track.path)) || 'mp3'
  const id = String(track && track.id ? track.id : 'track_' + Date.now())
    .replace(/[^a-zA-Z0-9_-]/g, '_')
  return `users/${uid}/life-music/${id}.${ext}`
}

/**
 * 上传一个本地音源。返回 { ok, cloudPath, error }。
 * 不改动传入的 track，落库由调用方（music-library）负责。
 */
function uploadTrack(track, onProgress) {
  return new Promise(async (resolve) => {
    const w = safeWx()
    const localPath = track && track.path
    if (!w || !localPath) {
      resolve({ ok: false, error: '没有可用的本地文件' })
      return
    }
    if (track && track.kind === 'video') {
      resolve({ ok: false, error: 'MV 暂不支持上云（文件过大，且后台播放只支持音频）' })
      return
    }
    if (Number(track.size) > MAX_UPLOAD_BYTES) {
      resolve({ ok: false, error: '文件超过 20MB，暂不支持上云' })
      return
    }
    if (typeof w.getFileSystemManager !== 'function' || typeof w.request !== 'function') {
      resolve({ ok: false, error: '当前微信版本不支持文件上传' })
      return
    }

    let token = ''
    let uid = ''
    try {
      token = (await cloud.auth.getAccessToken()) || ''
      uid = await currentUid()
    } catch (e) { /* 下面统一判断 */ }
    if (!token || !uid) {
      resolve({ ok: false, error: '需要先登录才能把音源存到云端' })
      return
    }

    let buffer
    try {
      buffer = w.getFileSystemManager().readFileSync(localPath)
    } catch (e) {
      resolve({ ok: false, error: '本地文件已失效，请重新导入后再上云' })
      return
    }

    const cloudPath = objectPathOf(uid, track)
    const url = `${ENDPOINT}/.cloud/storage/object/${BUCKET}/${cloudPath}`
    if (typeof onProgress === 'function') onProgress(10)

    // 复刻 SDK uploadOrUpdate 的「裸二进制 + POST + x-upsert」协议。
    // wx.request 的 data 为 ArrayBuffer 时会原样作为请求体发送。
    w.request({
      url,
      method: 'POST',
      header: {
        'content-type': mimeOf(track.name || localPath),
        'cache-control': 'max-age=3600',
        'x-upsert': 'true',
        'x-wb-webapp-access-key': PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
      data: buffer,
      timeout: 60000,
      success(res) {
        if (typeof onProgress === 'function') onProgress(100)
        if (res && res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, cloudPath })
        } else {
          const msg = res && res.data && res.data.message
          resolve({ ok: false, error: '云端拒收（' + (res ? res.statusCode : '?') + '）' + (msg ? '：' + msg : '') })
        }
      },
      fail(err) {
        resolve({ ok: false, error: '上传失败：' + ((err && err.errMsg) || '网络异常') })
      },
    })
  })
}

/**
 * 拿一个可直接给 BackgroundAudioManager 的 https 直链。
 * 命中未过期缓存就直接返回，否则重新签名。返回 { ok, url, expiresAt, error }。
 */
async function resolvePlayableUrl(cloudPath, force) {
  if (!cloudPath) return { ok: false, error: '该音源还没上云' }
  const c = cache()
  const hit = c[cloudPath]
  const t = nowSec()
  if (!force && hit && hit.url && hit.expiresAt - t > REFRESH_BEFORE) {
    return { ok: true, url: hit.url, expiresAt: hit.expiresAt, cached: true }
  }
  try {
    const res = await cloud.storage.createSignedUrl(cloudPath, SIGN_TTL)
    const url = res && res.data && res.data.signedUrl
    if (!url) {
      const msg = res && res.error && res.error.message
      return { ok: false, error: '签名直链失败' + (msg ? '：' + msg : '') }
    }
    const expiresAt = t + SIGN_TTL
    putCache(cloudPath, url, expiresAt)
    return { ok: true, url, expiresAt, cached: false }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '签名直链异常' }
  }
}

/** 删除云端副本（尽力而为，失败不影响本地删除） */
async function removeCloudTrack(cloudPath) {
  if (!cloudPath) return { ok: true }
  dropCache(cloudPath)
  try {
    const res = await cloud.storage.remove([cloudPath])
    return { ok: !(res && res.error), error: res && res.error && res.error.message }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '删除异常' }
  }
}

/** 是否值得续签（供播放器在切歌 / 回前台时判断） */
function isExpiringSoon(expiresAt) {
  return !expiresAt || expiresAt - nowSec() <= REFRESH_BEFORE
}

module.exports = {
  ENDPOINT,
  SIGN_TTL,
  MAX_UPLOAD_BYTES,
  objectPathOf,
  currentUid,
  uploadTrack,
  resolvePlayableUrl,
  removeCloudTrack,
  isExpiringSoon,
}
