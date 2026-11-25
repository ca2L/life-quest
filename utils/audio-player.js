/**
 * 全局音频播放器（模块级单例 · 双引擎 · 支持本地音源上云）
 *
 * ── 三条播放通道 ──────────────────────────────────────────────────
 *  1. 外部网络音源（https 直链）      → BackgroundAudioManager，切微信/息屏继续播
 *  2. 本地音源已上云（有 cloudPath）  → 先换签名 https 直链，再走 BackgroundAudioManager
 *  3. 本地音源未上云                 → InnerAudioContext，仅前台（微信官方限制）
 *
 * 平台边界：
 *  - BackgroundAudioManager 官方明确不支持本地文件路径（报 10001），只吃 http(s)。
 *  - 签名直链最长 1 小时；切歌 / 播完 / 重新点播都会重新签名，缓存提前 5 分钟失效。
 *  - 后台播放需在 app.json 声明 requiredBackgroundModes: ["audio"]，正式版要过审核。
 *  - 小程序进入后台后不能用 API 操纵背景音频状态，所以 app.js 的 onHide 什么都不做。
 *  - 只负责音频；MV 走原生 <video>，由页面自己管。
 *  - 没有 cloudPath 时完全同步执行、不加载云 SDK（低版本/离线场景零影响）。
 */

const musicLib = require('./music-library')
const playHistory = require('./play-history')

const STATE_KEY = 'lifeMusicState'

let innerCtx = null
let bgCtx = null
let bgBound = false
let engine = 'inner' // 'inner' | 'background'
let list = []
let listeners = []
let lastTick = -1
let playToken = 0 // 防异步签名竞态：用户快速切歌时旧结果不能覆盖新请求
let cloudUrlExpiresAt = 0

let state = {
  trackId: '',
  index: -1,
  name: '',
  playing: false,
  progress: 0,
  timeText: '0:00 / 0:00',
  src: '',
  missing: false,
  engine: 'inner',
  backgroundCapable: false,
  cloudBacked: false, // 当前曲的后台能力来自「本地音源上云」
}

function emit() {
  const snap = Object.assign({}, state)
  listeners.forEach((fn) => {
    try { fn(snap) } catch (e) { /* 单个订阅者异常不影响其他订阅 */ }
  })
}

function readStore() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      return wx.getStorageSync(STATE_KEY) || {}
    }
  } catch (e) { /* storage 不可用 */ }
  return {}
}

function writeStore(patch) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      const cur = readStore() || {}
      wx.setStorageSync(STATE_KEY, Object.assign({}, cur, patch))
    }
  } catch (e) { /* 忽略存储失败 */ }
}

function toast(title) {
  if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
    wx.showToast({ title, icon: 'none', duration: 2000 })
  }
}

// 惰性加载云模块：只有已上云的音源才会碰到 SDK，避免无谓依赖与初始化开销
function cloudMusic() {
  try { return require('./cloud-music') } catch (e) { return null }
}

// 只有 http(s) 直链能进后台引擎。用 source 判定本地，避免 Android 临时路径
// 恰好是 http://tmp/... 而被误判成网络音源。
function isRemoteTrack(track, src) {
  return track && track.source !== 'local' && /^https?:\/\//i.test(src || '')
}

/** 是否具备后台播放能力（供 UI 如实标注） */
function canBackground(track) {
  if (!track || track.kind === 'video') return false
  if (track.source !== 'local') return /^https?:\/\//i.test(musicLib.playablePath(track) || '')
  return !!track.cloudPath
}

function activeCtx() {
  return engine === 'background' ? bgCtx : innerCtx
}

function ensureInner() {
  if (innerCtx) return innerCtx
  if (typeof wx === 'undefined' || typeof wx.createInnerAudioContext !== 'function') return null
  innerCtx = wx.createInnerAudioContext()
  if ('obeyMuteSwitch' in innerCtx) innerCtx.obeyMuteSwitch = false

  innerCtx.onPlay(() => {
    if (engine !== 'inner') return
    state.playing = true
    emit()
  })
  innerCtx.onPause(() => {
    if (engine !== 'inner') return
    state.playing = false
    emit()
  })
  innerCtx.onStop(() => {
    if (engine !== 'inner') return
    state.playing = false
    state.progress = 0
    state.timeText = '0:00 / 0:00'
    emit()
  })
  innerCtx.onTimeUpdate(() => {
    if (engine !== 'inner') return
    const cur = (innerCtx && innerCtx.currentTime) || 0
    const dur = (innerCtx && innerCtx.duration) || 0
    state.progress = dur ? Math.round((cur / dur) * 100) : 0
    state.timeText = musicLib.fmtTime(cur) + ' / ' + musicLib.fmtTime(dur)
    const tick = Math.floor(cur)
    if (tick === lastTick) return
    lastTick = tick
    emit()
  })
  innerCtx.onEnded(() => { if (engine === 'inner') next() })
  innerCtx.onError(() => {
    if (engine !== 'inner') return
    state.playing = false
    emit()
    toast('这个音源播不了，可能是链接失效或格式不支持')
  })
  return innerCtx
}

function ensureBackground() {
  if (bgCtx) return bgCtx
  if (typeof wx === 'undefined' || typeof wx.getBackgroundAudioManager !== 'function') return null
  bgCtx = wx.getBackgroundAudioManager()
  if (!bgCtx) return null

  if (!bgBound) {
    bgBound = true
    // 系统播放面板（锁屏 / 通知栏 / 耳机）上的上一首、下一首
    if (typeof bgCtx.onNext === 'function') bgCtx.onNext(() => { if (engine === 'background') next() })
    if (typeof bgCtx.onPrev === 'function') bgCtx.onPrev(() => { if (engine === 'background') prev() })
    bgCtx.onPlay(() => {
      if (engine !== 'background') return
      state.playing = true
      emit()
    })
    bgCtx.onPause(() => {
      if (engine !== 'background') return
      state.playing = false
      emit()
    })
    bgCtx.onStop(() => {
      if (engine !== 'background') return
      state.playing = false
      state.progress = 0
      state.timeText = '0:00 / 0:00'
      emit()
    })
    bgCtx.onEnded(() => { if (engine === 'background') next() })
    bgCtx.onTimeUpdate(() => {
      if (engine !== 'background') return
      const cur = (bgCtx && bgCtx.currentTime) || 0
      const dur = (bgCtx && bgCtx.duration) || 0
      state.progress = dur ? Math.round((cur / dur) * 100) : 0
      state.timeText = musicLib.fmtTime(cur) + ' / ' + musicLib.fmtTime(dur)
      const tick = Math.floor(cur)
      if (tick === lastTick) return
      lastTick = tick
      emit()
    })
    bgCtx.onError(() => {
      if (engine !== 'background') return
      state.playing = false
      emit()
      toast('这个网络音源播不了，请换成可直接播放的音频直链')
    })
  }
  return bgCtx
}

// 只在音频项之间循环：MV 不能被「下一首」切出来（它需要原生 video 组件）
function audioIndexes() {
  const out = []
  list.forEach((t, i) => { if (t && t.kind !== 'video') out.push(i) })
  return out
}

function indexOfId(id) {
  if (!id) return -1
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].id === id) return i
  }
  return -1
}

// 已上云的音源即使本地文件被系统清理，也能从云端直链播放，不算「失效」
function computeMissing(track) {
  if (!track || track.kind === 'video') return false
  if (track.cloudPath) return false
  if (track.source !== 'local') return false
  const p = track.path || ''
  if (!p) return true
  return !musicLib.localFileAlive(p)
}

// 停掉不再使用的引擎。先切换 engine，再停旧引擎，旧引擎的异步回调会因
// engine 不匹配被忽略，避免「切歌时旧引擎的 onPause 把播放态改回 false」。
function stopOtherEngines(target) {
  if (target !== 'inner' && innerCtx) {
    try { innerCtx.stop() } catch (e) { /* 忽略 */ }
  }
  if (target !== 'background' && bgCtx) {
    try { bgCtx.stop() } catch (e) { /* 忽略 */ }
  }
}

function stopAll() {
  if (innerCtx) { try { innerCtx.stop() } catch (e) { /* 忽略 */ } }
  if (bgCtx) { try { bgCtx.stop() } catch (e) { /* 忽略 */ } }
}

/**
 * 同步播放列表。
 * 当前曲还在 → 只刷新索引与名称，继续播；
 * 当前曲被删 → 停掉，避免「列表里已经没有这首歌但还在响」。
 */
function setList(next) {
  list = Array.isArray(next) ? next.slice() : []
  if (!list.length) {
    stopAll()
    state.trackId = ''
    state.index = -1
    state.name = ''
    state.src = ''
    state.playing = false
    state.progress = 0
    state.timeText = '0:00 / 0:00'
    state.backgroundCapable = false
    state.cloudBacked = false
    emit()
    return
  }
  if (!state.trackId) { emit(); return }
  const i = indexOfId(state.trackId)
  if (i >= 0) {
    state.index = i
    state.name = list[i].name
    state.missing = computeMissing(list[i])
    state.backgroundCapable = canBackground(list[i])
    state.cloudBacked = list[i].source === 'local' && !!list[i].cloudPath
    emit()
    return
  }
  stopAll()
  state.trackId = ''
  state.index = -1
  state.name = ''
  state.src = ''
  state.playing = false
  state.progress = 0
  state.timeText = '0:00 / 0:00'
  state.backgroundCapable = false
  state.cloudBacked = false
  emit()
}

/** 实际的启播动作（同步）。src 一定已是可直接播放的地址。 */
function applyPlayback(track, src, target) {
  const c = target === 'background' ? ensureBackground() : ensureInner()
  lastTick = -1
  state.src = src

  if (!src) {
    state.playing = false
    emit()
    toast('这条记录没有可播放地址，可能是外部链接')
    return
  }
  if (state.missing) {
    state.playing = false
    emit()
    toast('本地文件已失效，请重新导入一次')
    return
  }
  if (!c) {
    // 低版本微信没有后台音频能力 → 退回前台引擎，不让用户完全听不到
    if (target === 'background') {
      const inner = ensureInner()
      if (inner) {
        engine = 'inner'
        state.engine = 'inner'
        state.backgroundCapable = false
        try { inner.stop() } catch (e) { /* 忽略 */ }
        inner.src = src
        inner.play()
        emit()
        return
      }
    }
    state.playing = false
    emit()
    toast('当前环境不支持音频播放')
    return
  }

  // 先换引擎标记，再停旧引擎，最后启新引擎
  engine = target
  state.engine = target
  stopOtherEngines(target)
  emit()

  if (target === 'background') {
    // 系统播放面板要显示的元数据；title 必填，其余选填。
    // 官方踩坑：设置 src 会自动开始播放，这里**不要**再调 play()。
    c.title = track.name
    c.singer = '人生主线任务'
    c.epname = '我的音源'
    c.src = src
  } else {
    try { c.stop() } catch (e) { /* 忽略 */ }
    c.src = src
    if ('title' in c) { try { c.title = track.name } catch (e) { /* 忽略 */ } }
    c.play()
  }
  emit()
}

function playIndex(index) {
  if (!list.length) return
  const i = Math.max(0, Math.min(list.length - 1, Number(index) || 0))
  const track = list[i]
  if (!track) return
  if (track.kind === 'video') return // 视频交给页面，不在这里处理

  const localSrc = musicLib.playablePath(track)
  const remote = isRemoteTrack(track, localSrc)
  const cloudPath = track.cloudPath || ''
  const useCloud = !remote && !!cloudPath // 本地音源上云 → 需要异步换签名直链

  const token = ++playToken
  state.index = i
  state.trackId = track.id
  state.name = track.name
  state.progress = 0
  state.timeText = '0:00 / 0:00'
  state.missing = computeMissing(track)
  state.backgroundCapable = remote || useCloud
  state.cloudBacked = useCloud
  cloudUrlExpiresAt = 0
  writeStore({ lastTrackId: track.id })
  // 播放历史埋点：记录的是「发起播放」，失败重试同一首 60 秒内不重复计数
  playHistory.record(track, track.scene || '')

  if (!useCloud) {
    // 原有路径保持完全同步，无 cloudPath 时不加载云 SDK
    applyPlayback(track, localSrc, remote ? 'background' : 'inner')
    return
  }

  // 已上云：先给 UI 一个「准备中」状态，再异步换签名直链
  state.playing = false
  emit()
  const cm = cloudMusic()
  if (!cm) {
    fallbackToLocal(track, token, '云模块不可用')
    return
  }
  Promise.resolve(cm.resolvePlayableUrl(cloudPath)).then((r) => {
    if (token !== playToken) return // 用户已切到别的曲，丢弃这次结果
    if (!r || !r.ok || !r.url) {
      fallbackToLocal(track, token, (r && r.error) || '签名直链失败')
      return
    }
    cloudUrlExpiresAt = r.expiresAt || 0
    applyPlayback(track, r.url, 'background')
  }).catch(() => {
    if (token !== playToken) return
    fallbackToLocal(track, token, '网络异常')
  })
}

/** 云端直链拿不到时退回本地文件，绝不静默失败 */
function fallbackToLocal(track, token, reason) {
  if (token !== playToken) return
  const p = track.path || ''
  if (p && musicLib.localFileAlive(p)) {
    state.backgroundCapable = false
    state.cloudBacked = false
    state.engine = 'inner'
    engine = 'inner'
    applyPlayback(track, p, 'inner')
    toast('云端直链暂不可用，已用本地文件播放')
  } else {
    state.playing = false
    state.backgroundCapable = false
    emit()
    toast('云端直链暂不可用：' + reason)
  }
}

function pause() {
  const c = activeCtx()
  if (c) { try { c.pause() } catch (e) { /* 忽略 */ } }
  state.playing = false
  emit()
}

function resume() {
  const c = activeCtx()
  if (!c || !state.src) return
  // 后台引擎 src 已设置时，play() 是继续播放（设置 src 的那次不要再调）
  try { c.play() } catch (e) { /* 忽略 */ }
}

function toggle() {
  if (state.playing) { pause(); return }
  if (state.src && !state.missing) { resume(); return }
  const idxs = audioIndexes()
  if (idxs.length) playIndex(idxs[0])
}

function stop() {
  playToken++ // 让在途的签名请求作废
  const c = activeCtx()
  if (c) { try { c.stop() } catch (e) { /* 忽略 */ } }
  state.playing = false
  state.progress = 0
  state.timeText = '0:00 / 0:00'
  emit()
}

function next() {
  const idxs = audioIndexes()
  if (!idxs.length) { stop(); return }
  const pos = idxs.indexOf(state.index)
  const target = pos < 0 ? 0 : (pos + 1) % idxs.length
  playIndex(idxs[target])
}

function prev() {
  const idxs = audioIndexes()
  if (!idxs.length) return
  const pos = idxs.indexOf(state.index)
  const target = pos < 0 ? idxs.length - 1 : (pos - 1 + idxs.length) % idxs.length
  playIndex(idxs[target])
}

function renameTrack(id, name) {
  const i = indexOfId(id)
  if (i < 0) return
  list[i] = Object.assign({}, list[i], { name })
  if (state.trackId === id) {
    state.name = name
    if (engine === 'background' && bgCtx) {
      try { bgCtx.title = name } catch (e) { /* 忽略 */ }
    } else if (innerCtx && 'title' in innerCtx) {
      try { innerCtx.title = name } catch (e) { /* 忽略 */ }
    }
    emit()
  }
}

// 恢复上次播放的曲目（只恢复「选中什么」，不自动出声）
function restoreLast() {
  const saved = readStore() || {}
  const id = saved.lastTrackId
  if (!id) return
  const i = indexOfId(id)
  if (i < 0) return
  const track = list[i]
  state.index = i
  state.trackId = id
  state.name = track.name
  state.src = musicLib.playablePath(track)
  state.missing = computeMissing(track)
  state.backgroundCapable = canBackground(track)
  state.cloudBacked = track.source === 'local' && !!track.cloudPath
  state.progress = 0
  state.timeText = '0:00 / 0:00'
  emit()
}

/**
 * 回到前台时同步一次。后台期间 onTimeUpdate 不会回调（官方限制），
 * 系统播放面板上的暂停/播放也可能没通知到 JS，这里以真实播放器为准。
 * 注意：只读不写，不在这里改播放状态，避免打断后台正在播的音乐。
 * 顺带在签名直链快过期时预热缓存（不换 src，否则会从头重播）。
 */
function syncFromForeground() {
  if (engine === 'background' && bgCtx) {
    const paused = bgCtx.paused
    const cur = bgCtx.currentTime || 0
    const dur = bgCtx.duration || 0
    state.playing = paused === false
    state.progress = dur ? Math.round((cur / dur) * 100) : 0
    state.timeText = musicLib.fmtTime(cur) + ' / ' + musicLib.fmtTime(dur)
  }
  emit()
  if (state.cloudBacked) {
    const cm = cloudMusic()
    const track = list[state.index]
    if (cm && track && track.cloudPath && cm.isExpiringSoon(cloudUrlExpiresAt)) {
      // 只刷新缓存，供下一首/下次点播使用；当前这首不打断
      Promise.resolve(cm.resolvePlayableUrl(track.cloudPath, true)).catch(() => {})
    }
  }
}

function getState() {
  return Object.assign({}, state)
}

function subscribe(fn) {
  if (typeof fn !== 'function') return function () {}
  listeners.push(fn)
  return function unsubscribe() {
    listeners = listeners.filter((x) => x !== fn)
  }
}

module.exports = {
  setList,
  playIndex,
  toggle,
  pause,
  resume,
  stop,
  next,
  prev,
  renameTrack,
  restoreLast,
  getState,
  subscribe,
  audioIndexes,
  syncFromForeground,
  canBackground,
}
