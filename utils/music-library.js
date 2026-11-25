/**
 * 「我的音源」：本地音频导入、外部音源/歌单导入、清单导出、本地持久化
 *
 * 能力边界（务必如实告知用户）：
 *  - 小程序无法直接读取其他音乐 App 的本地曲库或版权音源；
 *    所谓「导入其他 App 的音源」= 粘贴对方分享出来的歌单链接 / 音源配置文本并保存在此。
 *  - 「导出」= 生成可复制的清单文本或 JSON，粘贴到洛雪音乐等支持歌单导入的 App。
 *  - 本地音频通过 wx.chooseMessageFile 从聊天会话选取，并用 saveFile 存成持久路径才能跨会话播放；
 *    在线链接仅作记录与导出，小程序内能否播放取决于域名配置与对方服务，不作保证。
 *  - 不破解、不绕过任何平台的版权保护；请只导入自己有权使用的音频。
 */

const TRACKS_KEY = 'lifeMusicTracks'
// 内置曲目只读，隐藏名单与改名单独存，避免污染用户自己的音源数据
const HIDDEN_BUILTIN_KEY = 'lifeHiddenBuiltinTracks'
const BUILTIN_NAME_KEY = 'lifeBuiltinTrackNames'
const BUILTIN_TRACKS = require('./builtin-tracks')
const MAX_TRACKS = 100
// 音频走 InnerAudioContext，视频（MV）走原生 <video> 组件，两者分开处理。
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg']
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm']
const LOCAL_EXT = AUDIO_EXT.concat(VIDEO_EXT)

function kindOf(name) {
  const ext = String(name || '').split('.').pop().toLowerCase()
  return VIDEO_EXT.indexOf(ext) >= 0 ? 'video' : 'audio'
}

function safeRead(key, fallback) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(key)
      return v === '' || v === undefined || v === null ? fallback : v
    }
  } catch (e) { /* 降级到本次会话 */ }
  return fallback
}
function safeWrite(key, value) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(key, value)
    }
  } catch (e) { /* 忽略存储失败 */ }
}
function makeId() {
  return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
function dateLabel() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function nameFromUrl(url) {
  try {
    const s = String(url).split('?')[0].split('#')[0]
    const last = s.split('/').filter(Boolean).pop() || ''
    const name = decodeURIComponent(last).replace(/\.(mp3|m4a|aac|wav|flac|ogg|mp4|mov|m4v|webm)$/i, '')
    return (name || s.split('/')[2] || '外部音源').slice(0, 28)
  } catch (e) { return '外部音源' }
}
function shortName(name) {
  return String(name || '').replace(/\.(mp3|m4a|aac|wav|flac|ogg|mp4|mov|m4v|webm)$/i, '').slice(0, 36)
}

// 本地文件可能被系统清理或用户删除；播放前要能识别出来，否则点了没反应像卡死。
// 结果缓存 30 秒：切 tab 会频繁重读列表，没必要每次都做同步文件系统调用。
const ALIVE_TTL = 30000
const aliveCache = {}
function localFileAlive(path) {
  if (!path) return false
  const now = Date.now()
  const hit = aliveCache[path]
  if (hit && now - hit.at < ALIVE_TTL) return hit.ok
  let ok = true
  try {
    if (typeof wx === 'undefined') ok = true
    else {
      const fsm = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      if (!fsm || typeof fsm.accessSync !== 'function') ok = true // 环境不支持检测时按存在处理
      else {
        fsm.accessSync(path)
        ok = true
      }
    }
  } catch (e) {
    ok = false
  }
  aliveCache[path] = { at: now, ok }
  return ok
}

function loadTracks() {
  const raw = safeRead(TRACKS_KEY, [])
  const own = Array.isArray(raw) ? raw.filter((t) => t && (t.path || t.url || t.name)) : []
  // 兼容旧数据：以前只存音频，没有 kind 字段。
  const ownTracks = own.slice(0, MAX_TRACKS).map((t) => {
    const kind = t.kind || kindOf(t.path || t.name || '')
    const withKind = Object.assign({}, t, { kind })
    if (t.source === 'local' && t.path) {
      withKind.missing = !localFileAlive(t.path)
    } else {
      withKind.missing = false
    }
    return withKind
  })
  // 内置曲目排在自己的音源之后：上传的仍排最前，空用户也能立刻有歌可播
  let hidden = safeRead(HIDDEN_BUILTIN_KEY, [])
  if (!Array.isArray(hidden)) hidden = []
  const names = safeRead(BUILTIN_NAME_KEY, {}) || {}
  const builtins = BUILTIN_TRACKS
    .filter((t) => hidden.indexOf(t.id) < 0)
    .map((t) => Object.assign({}, t, { name: names[t.id] || t.name, missing: false }))
  return ownTracks.concat(builtins).slice(0, MAX_TRACKS)
}
function saveTracks(list) {
  // missing 是每次读取时现算的运行时状态，不写回存储；内置曲目也不写回自己的音源
  const clean = (list || []).filter((t) => !t.builtin).slice(0, MAX_TRACKS).map((t) => {
    const copy = Object.assign({}, t)
    delete copy.missing
    return copy
  })
  safeWrite(TRACKS_KEY, clean)
  // 重新读一次，让 missing 这类运行时标记保持最新
  return loadTracks()
}
function addLocalTrack(savedFilePath, name, size, kind) {
  const k = kind === 'video' ? 'video' : 'audio'
  const list = loadTracks()
  list.unshift({
    id: makeId(),
    name: shortName(name) || (k === 'video' ? '本地 MV' : '本地音频'),
    source: 'local',
    kind: k,
    path: savedFilePath,
    url: '',
    size: Number(size) || 0,
    addedAt: dateLabel(),
    // 上云后写入 cloudPath：播放器据此换签名 https 直链走后台引擎
    cloudPath: '',
    cloudAt: '',
  })
  return saveTracks(list)
}

// 按 id 取一条（删除前要先拿到 cloudPath 才能顺手清理云端副本）
function trackById(id) {
  return loadTracks().find((t) => t.id === id) || null
}

// 标记上云成功：只记录云端对象路径，绝不把临时签名 URL 写进存储
function setCloudInfo(id, cloudPath) {
  if (!id || !cloudPath) return loadTracks()
  return saveTracks(loadTracks().map((t) => (
    t.id === id ? Object.assign({}, t, { cloudPath, cloudAt: dateLabel() }) : t
  )))
}

function clearCloudInfo(id) {
  if (!id) return loadTracks()
  return saveTracks(loadTracks().map((t) => (
    t.id === id ? Object.assign({}, t, { cloudPath: '', cloudAt: '' }) : t
  )))
}

/**
 * 解析粘贴内容，支持：
 *  - JSON：数组，或 { tracks: [{name,url}] }
 *  - 每行「名称 | 链接」
 *  - 纯链接、纯名称
 *  - # 开头为注释行
 */
function parseImport(text) {
  const raw = String(text || '').trim()
  if (!raw) return []
  if (raw[0] === '{' || raw[0] === '[') {
    try {
      const j = JSON.parse(raw)
      const arr = Array.isArray(j) ? j : (j.tracks || [])
      return arr.map((x) => {
        if (typeof x === 'string') return { name: nameFromUrl(x), url: x }
        const url = String(x.url || x.link || x.src || '')
        return { name: String(x.name || x.title || nameFromUrl(url)).slice(0, 36), url }
      }).filter((x) => x.name || x.url)
    } catch (e) { /* 按纯文本继续解析 */ }
  }
  const out = []
  raw.split(/\r?\n/).forEach((line) => {
    const s = line.trim()
    if (!s || s.charAt(0) === '#') return
    let name = ''
    let url = ''
    const urlMatch = s.match(/https?:\/\/[^\s|]+/i)
    if (s.indexOf('|') >= 0) {
      const parts = s.split('|')
      name = parts[0].trim()
      url = parts.slice(1).join('|').trim()
    } else if (urlMatch) {
      url = urlMatch[0]
      name = s.replace(url, '').trim() || nameFromUrl(url)
    } else {
      name = s
    }
    if (name || url) out.push({ name: (name || '未命名音源').slice(0, 36), url })
  })
  return out
}
function addExternalTracks(text) {
  const parsed = parseImport(text)
  if (!parsed.length) return { list: loadTracks(), added: 0 }
  const list = loadTracks()
  parsed.slice(0, MAX_TRACKS).forEach((p) => {
    list.unshift({
      id: makeId(),
      name: p.name,
      source: 'external',
      path: '',
      url: p.url,
      addedAt: dateLabel(),
    })
  })
  return { list: saveTracks(list), added: parsed.length }
}
function removeTrack(id) {
  // 内置曲目：只记隐藏名单，不动用户自己的音源数据；隐藏后仍可通过清空名单恢复
  if (BUILTIN_TRACKS.some((t) => t.id === id)) {
    const hidden = safeRead(HIDDEN_BUILTIN_KEY, [])
    const arr = Array.isArray(hidden) ? hidden.slice() : []
    if (arr.indexOf(id) < 0) arr.push(id)
    safeWrite(HIDDEN_BUILTIN_KEY, arr)
    return loadTracks()
  }
  return saveTracks(loadTracks().filter((t) => t.id !== id))
}

function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

// 改名：只动名称，路径与来源都不碰，避免改名把本地文件关系弄丢
function renameTrack(id, name) {
  const next = cleanName(name)
  if (!id || !next) return loadTracks()
  if (BUILTIN_TRACKS.some((t) => t.id === id)) {
    const names = safeRead(BUILTIN_NAME_KEY, {}) || {}
    names[id] = next
    safeWrite(BUILTIN_NAME_KEY, names)
    return loadTracks()
  }
  return saveTracks(loadTracks().map((t) => (
    t.id === id ? Object.assign({}, t, { name: next }) : t
  )))
}

// 导出为可复制的清单文本（可粘贴到支持歌单导入的音乐 App）
function exportText(list) {
  const tracks = list || []
  const head = [
    '# 玩到120岁 · 我的音源清单',
    '# 每行格式：名称 | 链接；可粘贴到洛雪音乐等支持歌单导入的 App',
    '# 本地音频没有外链，只能在本机播放，导出时标注为「本地文件」',
  ]
  const rows = tracks.map((t) => t.name + ' | ' + (t.url
    || (t.cloudPath ? '已上云（后台可播）' : (t.kind === 'video' ? '本地视频（仅本机可播）' : '本地文件（仅本机可播）'))))
  return head.concat(rows).join('\n')
}
// 导出为音源配置 JSON（便于给支持自定义音源的工具使用）
function exportJson(list) {
  const tracks = (list || []).map((t) => ({
    name: t.name,
    url: t.url || '',
    source: t.source,
    kind: t.kind || 'audio',
    cloudPath: t.cloudPath || '',
  }))
  return JSON.stringify({
    source: 'life-quest',
    exportedAt: new Date().toISOString(),
    note: '外部链接由使用者自行提供；本地文件不含外链；cloudPath 仅为云端对象路径，不含签名 token',
    tracks,
  }, null, 2)
}
function playablePath(track) {
  if (!track) return ''
  return track.source === 'local' ? (track.path || '') : (track.url || '')
}

/**
 * 临时文件 → 可长期使用的本地文件。
 * saveFile 受「本地缓存文件」10MB 总额限制，音视频很容易超；
 * 失败时再兜底 copyFile 到 USER_DATA_PATH（上限宽松得多）。
 * 两条都失败才退回临时路径，并明确告诉调用方「没能持久化」。
 */
function persistFile(tempPath, name, done) {
  const finish = (p, persisted) => { if (typeof done === 'function') done(p, persisted) }
  if (!tempPath) { finish('', false); return }
  const fsm = (typeof wx !== 'undefined' && typeof wx.getFileSystemManager === 'function')
    ? wx.getFileSystemManager() : null
  const rawExt = String(name || tempPath).split('.').pop().toLowerCase()
  const ext = LOCAL_EXT.indexOf(rawExt) >= 0 ? rawExt : (kindOf(name) === 'video' ? 'mp4' : 'mp3')

  const toUserPath = (cb) => {
    if (!fsm || typeof fsm.copyFile !== 'function') { cb(''); return }
    try {
      const base = (wx.env && wx.env.USER_DATA_PATH) || ''
      if (!base) { cb(''); return }
      const dir = base + '/life-music'
      try { if (fsm.mkdirSync) fsm.mkdirSync(dir, true) } catch (e) { /* 目录已存在 */ }
      const target = dir + '/m' + Date.now().toString(36)
        + Math.random().toString(36).slice(2, 6) + '.' + ext
      fsm.copyFile({
        srcPath: tempPath,
        destPath: target,
        success: () => cb(target),
        fail: () => cb(''),
      })
    } catch (e) { cb('') }
  }

  if (fsm && typeof fsm.saveFile === 'function') {
    fsm.saveFile({
      tempFilePath: tempPath,
      success: (r) => finish((r && r.savedFilePath) || tempPath, true),
      fail: () => toUserPath((p) => finish(p || tempPath, !!p)),
    })
    return
  }
  toUserPath((p) => finish(p || tempPath, !!p))
}
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

module.exports = {
  TRACKS_KEY,
  BUILTIN_TRACKS,
  LOCAL_EXT,
  AUDIO_EXT,
  VIDEO_EXT,
  kindOf,
  loadTracks,
  saveTracks,
  addLocalTrack,
  parseImport,
  addExternalTracks,
  removeTrack,
  trackById,
  setCloudInfo,
  clearCloudInfo,
  renameTrack,
  persistFile,
  localFileAlive,
  exportText,
  exportJson,
  playablePath,
  fmtTime,
}
