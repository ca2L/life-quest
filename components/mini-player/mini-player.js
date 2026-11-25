// 全局悬浮播放球：订阅模块级播放器单例，所有 tab 页都能看到并控制同一首歌。
// 它只负责「看得见、点得到」；真正的音频在 utils/audio-player.js 里，切页面不会重建。
const player = require('../../utils/audio-player')

Component({
  properties: {
    // 弹层/MV 浮窗出现时由页面置 true，避免两个浮层叠在一起
    hidden: { type: Boolean, value: false },
    // true = 作为页面 flex 布局的固定停靠项（首页）；false = 旧版 fixed 浮层（其他 tab 页）
    docked: { type: Boolean, value: false },
  },

  data: {
    hasTrack: false,
    name: '',
    playing: false,
    backgroundCapable: false,
  },

  lifetimes: {
    attached() {
      this._unsub = player.subscribe((s) => this.applyState(s))
      this.applyState(player.getState())
    },
    detached() {
      if (this._unsub) this._unsub()
      this._unsub = null
    },
  },

  methods: {
    applyState(s) {
      this.setData({
        hasTrack: !!(s && s.trackId),
        name: (s && s.name) || '',
        playing: !!(s && s.playing),
        backgroundCapable: !!(s && s.backgroundCapable),
      })
    },

    toggle() {
      player.toggle()
    },

    next() {
      player.next()
    },

    // 回到音乐面板：当前就在首页直接触发事件，其它 tab 先切过去、由首页 onShow 补开。
    openPanel() {
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
      const cur = pages[pages.length - 1]
      if (cur && cur.route === 'pages/index/index') {
        this.triggerEvent('openmusic')
        return
      }
      try {
        if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
          wx.setStorageSync('openMusicSheetOnShow', true)
        }
        if (typeof wx !== 'undefined' && typeof wx.switchTab === 'function') {
          wx.switchTab({ url: '/pages/index/index' })
        }
      } catch (e) { /* 跳转失败就留在当前页，播放不受影响 */ }
    },
  },
})
