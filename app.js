const { cloud } = require('./utils/cloud')

App({
  globalData: {
    appName: '人生主线任务',
  },

  onLaunch() {
    // iOS 静音键默认会把 InnerAudioContext 一起静音，用户会误以为「音乐被关掉了」
    try {
      if (typeof wx !== 'undefined' && typeof wx.setInnerAudioOption === 'function') {
        wx.setInnerAudioOption({ obeyMuteSwitch: false })
      }
    } catch (e) { /* 低版本不支持则走默认行为 */ }
  },

  // 切到微信聊天 / 息屏时不要碰播放器：后台音频由微信系统接管，
  // 官方明确「后台状态不能通过 API 操纵音频播放状态」，这里刻意留空。
  onHide() {
    // 不暂停、不 stop、不 destroy
  },

  // 回到前台：后台期间 onTimeUpdate 不回调，锁屏面板的暂停也可能没通知到 JS，
  // 以系统播放器的真实状态为准做一次只读同步。
  onShow() {
    try { require('./utils/audio-player').syncFromForeground() } catch (e) { /* 忽略 */ }
  },

  // 会话缓存：登录或退出后重置，避免重复请求。
  ensureSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = this._sessionAttempt(1)
    }
    return this.sessionPromise
  },

  // 云端网关偶发 502（上游 10s 超时才返回错误）。只对「网关 / 网络」类错误补一次重试，
  // 未登录（unauthenticated）不重试——那是真没登录，重试也是白等。
  async _sessionAttempt(left) {
    let res = await cloud.auth.getSession()
    if (res.error && left > 0 && this.isTransientError(res.error)) {
      await new Promise((resolve) => setTimeout(resolve, 800))
      res = await cloud.auth.getSession()
    }
    if (res.data) this._hadSession = true
    return res
  },

  // 供页面区分「服务端抖动」（保留数据、提示重试）与「真未登录」（展示登录面板）。
  isTransientError(error) {
    if (!error) return false
    const kind = error.kind
    return kind === 'backend-unavailable' || kind === 'network' ||
      kind === 'rate-limited' || (typeof error.status === 'number' && error.status >= 500)
  },

  wasSignedIn() {
    return this._hadSession === true
  },

  resetSession() {
    this.sessionPromise = null
  },
})
