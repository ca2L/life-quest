/**
 * 人生作品：把已记录的数据编译成作品，不新增任何采集。
 * 四个模块共用同一份 archive 快照，避免各页算出不同结果。
 */
const lifeArchive = require('../../utils/life-archive')
const lifeModels = require('../../utils/life-models')
const report = require('../../utils/annual-report')

const TABS = [
  { key: 'report', name: '人生年报' },
  { key: 'soundtrack', name: '原声带' },
  { key: 'balance', name: '负债表' },
  { key: 'archive', name: '存档' },
]

Page({
  data: {
    tabs: TABS,
    tab: 'report',
    loading: true,
    loadError: '',
    degraded: false,
    warnings: [],

    // 年报
    years: [],
    yearIndex: 0,
    slides: [],
    slideIndex: 0,
    verdict: '',
    canvasW: 750,
    canvasH: 2400,

    // 原声带
    soundtrack: null,
    soundtrackText: '',
    countryTracks: [],
    yearTracks: [],
    soundtrackItems: [],

    // 资产负债表
    balance: null,
    balanceBars: [],

    // 存档
    archiveCounts: null,
    exportJsonText: '',
    exportHtmlText: '',
    exporting: false,
    lastSavedPath: '',
  },

  onLoad() {
    this.loadArchive()
  },

  async loadArchive() {
    this.setData({ loading: true, loadError: '' })
    try {
      const archive = await lifeArchive.collectArchive()
      this._archive = archive
      const years = lifeArchive.yearsOf(archive)
      const snapshots = {}
      years.forEach((y) => { snapshots[y] = lifeArchive.buildYearSnapshot(archive, y) })
      this._snapshots = snapshots

      const soundtrack = lifeArchive.buildSoundtrack(archive)
      const balance = lifeModels.buildBalanceSheet({
        profile: archive.profile,
        quests: archive.quests,
        checkins: archive.checkins,
        footprints: archive.footprints,
        characters: archive.characters,
        readCards: archive.readCards,
      })
      const exportJsonText = lifeArchive.buildArchiveJson(archive)
      const exportHtmlText = lifeArchive.buildYearbookHtml(archive, years.map((y) => snapshots[y]))

      const accounts = balance.accounts.map((a) => Object.assign({}, a, {
        hasValue: a.value !== null,
        valueText: a.value === null ? '—' : String(a.value),
        trendText: a.trend === 'up' ? '↑ 上升' : a.trend === 'down' ? '↓ 回落' : '→ 平稳',
      }))
      const balanceView = Object.assign({}, balance, { accounts })
      const maxNet = Math.max(1, ...balance.series.map((s) => s.netWorth))
      const balanceBars = balance.series.map((s) => ({
        year: s.year,
        height: Math.max(6, Math.round((s.netWorth / maxNet) * 100)),
        netWorth: s.netWorth,
      }))

      this.setData({
        loading: false,
        degraded: !!archive.degraded,
        warnings: archive.errors || [],
        years,
        yearIndex: 0,
        soundtrack,
        soundtrackText: report.soundtrackNarrative(soundtrack),
        countryTracks: soundtrack.countryTracks.slice(0, 12),
        yearTracks: soundtrack.yearTracks.slice(0, 12),
        soundtrackItems: soundtrack.items.slice(0, 30),
        balance: balanceView,
        balanceBars,
        archiveCounts: {
          quests: (archive.quests || []).length,
          checkins: (archive.checkins || []).length,
          footprints: (archive.footprints || []).length,
          characters: (archive.characters || []).length,
          musicTracks: (archive.musicTracks || []).length,
          books: (archive.books || []).length,
          years: years.length,
        },
        exportJsonText,
        exportHtmlText,
      })
      this.applyYear(0)
    } catch (e) {
      this.setData({ loading: false, loadError: (e && e.message) || '读取人生存档失败' })
    }
  },

  applyYear(index) {
    const years = this.data.years || []
    if (!years.length) return
    const i = Math.max(0, Math.min(years.length - 1, index))
    const y = years[i]
    const snapshot = (this._snapshots && this._snapshots[y]) || lifeArchive.buildYearSnapshot(this._archive, y)
    const soundtrack = this.data.soundtrack
    const slides = report.buildReportSlides(this._archive, snapshot, soundtrack)
    this.setData({
      yearIndex: i,
      slides,
      slideIndex: 0,
      verdict: report.reportVerdict(snapshot),
      canvasH: slides.length * 420,
    })
  },

  switchTab(event) {
    this.setData({ tab: event.currentTarget.dataset.tab })
  },

  prevYear() { this.applyYear(this.data.yearIndex + 1) },
  nextYear() { this.applyYear(this.data.yearIndex - 1) },

  onSlideChange(event) {
    this.setData({ slideIndex: event.detail.current || 0 })
  },

  copyReportText() {
    const slides = this.data.slides || []
    const text = slides.map((s) => `${s.title.replace(/\n/g, '')}\n${s.body}`).join('\n\n')
      + `\n\n${this.data.verdict}\n\n—— 人生主线任务 · ${(this.data.years || [])[this.data.yearIndex]} 年报`
    this.copyText(text, '年报文案已复制')
  },

  // ── 保存长图：把全部叙事卡画到一张纵向 canvas，再存相册 ──────────
  saveReportImage() {
    const slides = this.data.slides || []
    if (!slides.length) return
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) {
      this.copyReportText()
      return
    }
    wx.showLoading({ title: '正在生成长图…', mask: true })
    const W = this.data.canvasW
    const H = this.data.canvasH
    wx.createSelectorQuery().in(this).select('#reportCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const canvas = res && res[0] && res[0].node
        if (!canvas) {
          wx.hideLoading()
          this.copyReportText()
          return
        }
        try {
          canvas.width = W
          canvas.height = H
          const ctx = canvas.getContext('2d')
          drawSlides(ctx, W, H, slides, (this.data.years || [])[this.data.yearIndex])
          wx.canvasToTempFilePath({
            canvas,
            success: (r) => {
              wx.hideLoading()
              wx.saveImageToPhotosAlbum({
                filePath: r.tempFilePath,
                success: () => wx.showToast({ title: '长图已存入相册', icon: 'success' }),
                fail: () => wx.showToast({ title: '相册保存失败，可改用复制文案', icon: 'none' }),
              })
            },
            fail: () => {
              wx.hideLoading()
              this.copyReportText()
            },
          })
        } catch (e) {
          wx.hideLoading()
          this.copyReportText()
        }
      })
  },

  // ── 存档导出 ──────────────────────────────────────────────────────
  copyJson() { this.copyText(this.data.exportJsonText, '完整 JSON 已复制') },
  copyHtml() { this.copyText(this.data.exportHtmlText, '年册 HTML 已复制') },

  copyText(text, okTitle) {
    if (!text) { wx.showToast({ title: '还没有可导出的内容', icon: 'none' }); return }
    if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') return
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: okTitle || '已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败', icon: 'none' }),
    })
  },

  saveFile(kind) {
    const isJson = kind === 'json'
    const text = isJson ? this.data.exportJsonText : this.data.exportHtmlText
    if (!text) { wx.showToast({ title: '还没有可导出的内容', icon: 'none' }); return }
    if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
      this.copyText(text, isJson ? '完整 JSON 已复制' : '年册 HTML 已复制')
      return
    }
    const name = `人生存档_${new Date().toISOString().slice(0, 10)}.${isJson ? 'json' : 'html'}`
    const path = `${wx.env.USER_DATA_PATH}/${name}`
    wx.showLoading({ title: '正在生成文件…', mask: true })
    wx.getFileSystemManager().writeFile({
      filePath: path,
      data: text,
      encoding: 'utf8',
      success: () => {
        wx.hideLoading()
        this.setData({ lastSavedPath: path })
        // 尝试分享到微信会话（文件可长期保存）；不支持时保留本地路径 + 复制兜底
        if (typeof wx.shareFileMessage === 'function') {
          wx.shareFileMessage({
            filePath: path,
            fileName: name,
            fail: () => wx.showToast({ title: '已保存到小程序目录，可点复制', icon: 'none', duration: 2600 }),
          })
        } else {
          wx.showToast({ title: '已保存到小程序目录，可点复制', icon: 'none', duration: 2600 })
        }
      },
      fail: () => {
        wx.hideLoading()
        this.copyText(text, isJson ? '完整 JSON 已复制' : '年册 HTML 已复制')
      },
    })
  },
  saveJson() { this.saveFile('json') },
  saveHtml() { this.saveFile('html') },

  handleRetry() { this.loadArchive() },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }) },
  noop() {},
})

// ── canvas 绘制（纯函数式工具，不依赖页面实例）─────────────────────────
const ACCENTS = {
  cover: ['#1a1633', '#3a2f7a'], travel: ['#123c4a', '#1f7a72'],
  quest: ['#2b1f4d', '#6b46c1'], people: ['#4a1f3a', '#a34d78'],
  music: ['#1f2a4a', '#4a5fc1'], rhythm: ['#3a2a12', '#a97a2c'],
  end: ['#1a1633', '#2f2a55'],
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const chars = String(text || '').split('')
  let line = ''
  let cy = y
  chars.forEach((ch) => {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy)
      line = ch
      cy += lineHeight
    } else {
      line = test
    }
  })
  if (line) { ctx.fillText(line, x, cy); cy += lineHeight }
  return cy
}

function drawSlides(ctx, W, H, slides, year) {
  ctx.fillStyle = '#f4f5fb'
  ctx.fillRect(0, 0, W, H)
  const cardH = 420
  slides.forEach((s, i) => {
    const top = i * cardH
    const colors = ACCENTS[s.accent] || ACCENTS.cover
    const grad = ctx.createLinearGradient(0, top, W, top + cardH)
    grad.addColorStop(0, colors[0])
    grad.addColorStop(1, colors[1])
    ctx.fillStyle = grad
    ctx.fillRect(24, top + 12, W - 48, cardH - 24)

    ctx.fillStyle = 'rgba(255,255,255,0.62)'
    ctx.font = '20px sans-serif'
    ctx.fillText(s.kicker, 60, top + 62)

    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 46px sans-serif'
    let ty = top + 130
    String(s.title || '').split('\n').forEach((line) => {
      ty = wrapText(ctx, line, 60, ty, W - 120, 58)
    })

    ctx.fillStyle = 'rgba(255,255,255,0.88)'
    ctx.font = '24px sans-serif'
    let by = Math.max(ty + 24, top + 230)
    by = wrapText(ctx, s.body, 60, by, W - 120, 36)

    if (s.metric) {
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 64px sans-serif'
      ctx.fillText(String(s.metric), 60, top + 340)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = '20px sans-serif'
      ctx.fillText(String(s.metricLabel || ''), 60, top + 372)
    }

    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '18px sans-serif'
    wrapText(ctx, s.footnote, 60, top + 386, W - 120, 26)
  })
  // 页脚
  ctx.fillStyle = '#a09ab8'
  ctx.font = '18px sans-serif'
  ctx.fillText(`人生主线任务 · ${year} 年报 · 不打分不排名`, 60, H - 16)
}
