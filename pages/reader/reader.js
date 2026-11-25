const {
  guideCards, chaptersOf, searchCards, guideTitleOf, guideRepoOf,
  cardAt, indexOfCard, cardCountOf, totalCards,
} = require('../../utils/guide-cards')

const PROGRESS_KEY = 'readerProgress'
const BOOKMARK_KEY = 'readerBookmarks'
const FONT_KEY = 'readerFont'
const FONT_CLASSES = ['font-small', 'font-mid', 'font-large']

function readStore(key, fallback) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(key)
      return v === '' || v === undefined || v === null ? fallback : v
    }
  } catch (e) { /* 降级到本次会话 */ }
  return fallback
}
function writeStore(key, value) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(key, value)
    }
  } catch (e) { /* 忽略存储失败 */ }
}
function pageTextOf(index, total) {
  return (index + 1) + ' / ' + total
}

Page({
  data: {
    guide: 'live',
    guideTitle: '',
    repo: '',
    url: '',
    cards: [],
    card: null,
    index: 0,
    total: 0,
    progress: 0,
    pageText: '1 / 1',
    chapters: [],
    bookmarks: [],
    isBookmarked: false,
    fontLevel: 1,
    fontClass: 'font-mid',
    toolbarOpen: true,
    drawerOpen: false,
    searchOpen: false,
    query: '',
    results: [],
    flipClass: '',
    libraryTotal: 0,
    readerHeight: '100vh',
  },

  onLoad(options) {
    const o = options || {}
    const valid = ['live', 'cook', 'skill']
    const guide = valid.indexOf(o.guide) >= 0 ? o.guide : 'live'
    const savedProgress = readStore(PROGRESS_KEY, {}) || {}
    const start = o.no ? indexOfCard(guide, o.no) : (Number(savedProgress[guide]) || 0)
    const fontLevel = Number(readStore(FONT_KEY, 1)) || 0
    // 用窗口信息算固定 px 高度，避免真机 100vh 重算导致的页面漂移（沿用世界页弹层方案）
    let readerHeight = '100vh'
    try {
      if (typeof wx !== 'undefined' && typeof wx.getWindowInfo === 'function') {
        const info = wx.getWindowInfo()
        if (info && info.windowHeight) readerHeight = info.windowHeight + 'px'
      }
    } catch (e) { readerHeight = '100vh' }
    this.setData({
      guide,
      fontLevel,
      fontClass: FONT_CLASSES[fontLevel] || FONT_CLASSES[1],
      libraryTotal: totalCards(),
      readerHeight,
    })
    this.loadGuide(guide, start)
  },

  onUnload() {
    clearTimeout(this._flipTimer)
  },

  loadGuide(guide, index) {
    const cards = guideCards(guide)
    const total = cards.length
    const safe = Math.max(0, Math.min(total - 1, Number(index) || 0))
    const bookmarks = readStore(BOOKMARK_KEY, []) || []
    const card = cards[safe] || null
    this.setData({
      guide,
      guideTitle: guideTitleOf(guide),
      repo: guideRepoOf(guide),
      url: 'https://github.com/' + guideRepoOf(guide),
      cards,
      total,
      chapters: chaptersOf(guide),
      index: safe,
      card,
      progress: total ? Math.round(((safe + 1) / total) * 100) : 0,
      pageText: pageTextOf(safe, total),
      bookmarks,
      isBookmarked: !!card && bookmarks.indexOf(guide + ':' + card.no) >= 0,
      drawerOpen: false,
      searchOpen: false,
    })
    this.saveProgress()
  },

  saveProgress() {
    const all = readStore(PROGRESS_KEY, {}) || {}
    all[this.data.guide] = this.data.index
    writeStore(PROGRESS_KEY, all)
  },

  goTo(index, dir) {
    const total = this.data.total
    if (!total) return
    const safe = Math.max(0, Math.min(total - 1, Number(index) || 0))
    if (safe === this.data.index) return
    const card = cardAt(this.data.guide, safe)
    const key = this.data.guide + ':' + (card ? card.no : '')
    this.setData({
      index: safe,
      card,
      progress: Math.round(((safe + 1) / total) * 100),
      pageText: pageTextOf(safe, total),
      isBookmarked: this.data.bookmarks.indexOf(key) >= 0,
      flipClass: dir === 'prev' ? 'flip-prev' : 'flip-next',
    })
    this.saveProgress()
    clearTimeout(this._flipTimer)
    this._flipTimer = setTimeout(() => this.setData({ flipClass: '' }), 320)
  },

  goNext() { this.goTo(this.data.index + 1, 'next') },
  goPrev() { this.goTo(this.data.index - 1, 'prev') },

  // 微信读书式：左右滑动翻页
  onTouchStart(event) {
    const t = event && event.changedTouches && event.changedTouches[0]
    this._tx = t ? t.clientX : 0
    this._ty = t ? t.clientY : 0
  },
  onTouchEnd(event) {
    const t = event && event.changedTouches && event.changedTouches[0]
    if (!t) return
    const dx = t.clientX - (this._tx || 0)
    const dy = t.clientY - (this._ty || 0)
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    if (dx < 0) this.goNext()
    else this.goPrev()
  },

  toggleToolbar() {
    this.setData({ toolbarOpen: !this.data.toolbarOpen })
  },

  openDrawer() { this.setData({ drawerOpen: true, toolbarOpen: false }) },
  closeDrawer() { this.setData({ drawerOpen: false }) },

  jumpFromDrawer(event) {
    const no = event.currentTarget.dataset.no
    this.setData({ drawerOpen: false, toolbarOpen: false })
    this.goTo(indexOfCard(this.data.guide, no), 'next')
  },

  openSearch() {
    this.setData({ searchOpen: true, toolbarOpen: false, query: '', results: [] })
  },
  closeSearch() {
    this.setData({ searchOpen: false, query: '', results: [] })
  },
  onSearchInput(event) {
    const q = event.detail.value || ''
    this.setData({ query: q, results: q.trim() ? searchCards(q, 80) : [] })
  },
  jumpFromSearch(event) {
    const ds = event.currentTarget.dataset
    const guide = ds.guide
    const idx = indexOfCard(guide, ds.no)
    this.setData({ searchOpen: false, query: '', results: [], toolbarOpen: false })
    if (guide !== this.data.guide) {
      this.loadGuide(guide, idx)
    } else {
      this.goTo(idx, 'next')
    }
  },

  toggleBookmark() {
    const card = this.data.card
    if (!card) return
    const key = this.data.guide + ':' + card.no
    const list = (this.data.bookmarks || []).slice()
    const i = list.indexOf(key)
    if (i >= 0) list.splice(i, 1)
    else list.push(key)
    writeStore(BOOKMARK_KEY, list)
    this.setData({ bookmarks: list, isBookmarked: i < 0 })
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: i < 0 ? '已加入书签' : '已移出书签', icon: 'none', duration: 1400 })
    }
  },

  cycleFont() {
    const next = (this.data.fontLevel + 1) % FONT_CLASSES.length
    writeStore(FONT_KEY, next)
    this.setData({ fontLevel: next, fontClass: FONT_CLASSES[next] })
  },

  copyRepoLink() {
    const url = this.data.url
    const fallback = () => {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({ title: '原文链接', content: url, showCancel: false, confirmText: '知道了' })
      }
    }
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      wx.setClipboardData({
        data: url,
        success: () => {
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '已复制，粘贴到浏览器打开', icon: 'none', duration: 2000 })
          }
        },
        fail: fallback,
      })
    } else fallback()
  },

  goBack() {
    if (typeof wx !== 'undefined' && typeof wx.navigateBack === 'function') wx.navigateBack()
  },

  noop() {},
})
