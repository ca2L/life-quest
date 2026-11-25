const bs = require('../../utils/bookshelf')

const STATUS_TABS = [{ key: 'all', label: '全部', icon: '📚' }].concat(bs.STATUSES)
const COVER_COLORS = ['#6f5ce8', '#e879a8', '#2f9e8f', '#f5a623', '#ff7b6b', '#5aa9e6', '#8a6cd1']

function emptyForm() {
  return {
    title: '', author: '', cover: '', isbn: '',
    status: 'read', rating: 0, startedAt: '', finishedAt: bs.today(),
    pages: '', minutes: '', progress: '100', review: '', tags: '',
  }
}
function computeSheetStyles() {
  let h = 0
  try {
    if (typeof wx !== 'undefined') {
      if (typeof wx.getWindowInfo === 'function') h = wx.getWindowInfo().windowHeight || 0
      else if (typeof wx.getSystemInfoSync === 'function') h = wx.getSystemInfoSync().windowHeight || 0
    }
  } catch (e) { h = 0 }
  if (!h || h < 400) return { sheetStyle: '' }
  return { sheetStyle: 'height:' + Math.round(h * 0.88) + 'px;' }
}
function hashOf(s) {
  let n = 0
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0
  return n
}
function decorate(b) {
  const meta = bs.STATUSES.find((s) => s.key === b.status) || bs.STATUSES[0]
  const rating = Number(b.rating) || 0
  const parts = []
  if (b.author) parts.push(b.author)
  if (b.finishedAt) parts.push(b.finishedAt + ' 读完')
  if (b.pages) parts.push(b.pages + ' 页')
  if (b.minutes) parts.push(b.minutes + ' 分钟')
  return Object.assign({}, b, {
    statusLabel: meta.label,
    statusIcon: meta.icon,
    coverText: String(b.title || '书').slice(0, 1),
    coverColor: COVER_COLORS[hashOf(String(b.title || '')) % COVER_COLORS.length],
    ratingText: rating ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : '未评分',
    progressText: b.status === 'read' ? '已读完' : '读到 ' + (Number(b.progress) || 0) + '%',
    metaText: parts.length ? parts.join(' · ') : '还没补充信息',
    isRead: b.status === 'read',
  })
}

Page({
  data: {
    books: [],
    viewBooks: [],
    stats: {
      total: 0, readCount: 0, readingCount: 0, wantCount: 0, droppedCount: 0,
      thisYear: 0, thisMonth: 0, minutes: 0, pages: 0, avgRating: '', ratedCount: 0,
      byYear: [], byMonth: [], byRating: [], topAuthors: [], finishedDays: 0,
      goal: 0, goalPercent: 0, year: '',
    },
    statusTabs: STATUS_TABS,
    statusOptions: bs.STATUSES, // 表单里的状态选项（不含「全部」），避免 wx:for 与 wx:if 同标签
    statusFilter: 'all',
    yearFilter: 'all',
    yearOptions: ['all'],
    keyword: '',
    peakMonthCount: 0,
    ratingOptions: [1, 2, 3, 4, 5],
    showForm: false,
    editingId: '',
    form: emptyForm(),
    formError: '',
    sheetStyle: '',
    showImport: false,
    importText: '',
    importResult: null,
    importHint: '',
    goalOpen: false,
    goalText: '',
    goalTitle: '还没设定年度阅读目标',
    goalSub: '目标只是给自己的一个刻度，不设也不影响记录',
    ratingFoot: '还没有评分记录 · 评分只影响你自己的书架，不参与任何排名',
  },

  onLoad() {
    this.setData(Object.assign({ sheetStyle: '' }, computeSheetStyles()))
    this.reload()
  },

  onShow() {
    if (this.data.books.length || this.data.showForm) this.reload()
  },

  reload() {
    const books = bs.loadBooks()
    const stats = bs.statsOf(books, bs.today(), bs.getGoal())
    const years = stats.byYear.map((y) => y.year)
    const thisYear = String(new Date().getFullYear())
    if (years.indexOf(thisYear) < 0) years.unshift(thisYear)
    const peak = stats.byMonth.reduce((m, x) => Math.max(m, x.count), 0)
    const byMonth = stats.byMonth.map((m) => Object.assign({}, m, {
      height: peak ? Math.max(8, Math.round((m.count / peak) * 150)) : 8,
    }))
    this.setData({
      books,
      stats: Object.assign({}, stats, { byMonth }),
      yearOptions: ['all'].concat(years),
      peakMonthCount: peak,
      goalText: String(stats.goal || ''),
      goalTitle: stats.goal
        ? '今年目标 ' + stats.goal + ' 本 · 已读 ' + stats.thisYear + ' 本'
        : '还没设定年度阅读目标',
      goalSub: stats.goal
        ? '完成 ' + stats.goalPercent + '% · 只对自己可见，不与任何人比较'
        : '目标只是给自己的一个刻度，不设也不影响记录',
      ratingFoot: stats.avgRating
        ? '平均评分 ' + stats.avgRating + ' / 5 · 已评 ' + stats.ratedCount + ' 本 · 累计 ' + stats.pages + ' 页'
        : '还没有评分记录 · 评分只影响你自己的书架，不参与任何排名',
    }, () => this.applyFilter())
  },

  applyFilter() {
    const status = this.data.statusFilter
    const year = this.data.yearFilter
    const kw = String(this.data.keyword || '').trim().toLowerCase()
    const view = this.data.books.filter((b) => {
      if (status !== 'all' && b.status !== status) return false
      if (year !== 'all') {
        const d = String(b.finishedAt || b.createdAt || '').slice(0, 4)
        if (d !== year) return false
      }
      if (kw) {
        const hay = [b.title, b.author, b.review, (b.tags || []).join(' ')].join(' ').toLowerCase()
        if (hay.indexOf(kw) < 0) return false
      }
      return true
    }).map(decorate)
    this.setData({ viewBooks: view })
  },

  setStatusFilter(event) {
    this.setData({ statusFilter: event.currentTarget.dataset.key }, () => this.applyFilter())
  },
  setYearFilter(event) {
    this.setData({ yearFilter: event.currentTarget.dataset.year || 'all' }, () => this.applyFilter())
  },
  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value }, () => this.applyFilter())
  },
  clearKeyword() {
    this.setData({ keyword: '' }, () => this.applyFilter())
  },

  // ===== 添加 / 编辑一本书 =====
  openForm(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset.id
    if (id) {
      const b = bs.bookById(id)
      if (!b) return
      this.setData({
        showForm: true,
        editingId: String(id),
        formError: '',
        form: {
          title: b.title, author: b.author, cover: b.cover, isbn: b.isbn,
          status: b.status, rating: b.rating || 0,
          startedAt: b.startedAt || '', finishedAt: b.finishedAt || '',
          pages: b.pages ? String(b.pages) : '', minutes: b.minutes ? String(b.minutes) : '',
          progress: String(b.progress || 0), review: b.review || '',
          tags: (b.tags || []).join('，'),
        },
      })
    } else {
      this.setData({ showForm: true, editingId: '', form: emptyForm(), formError: '' })
    }
  },
  closeForm() { this.setData({ showForm: false, editingId: '', formError: '' }) },
  noop() {},

  onFormInput(event) {
    const key = event.currentTarget.dataset.field
    if (!key) return
    this.setData({ ['form.' + key]: event.detail.value, formError: '' })
  },
  onFormDate(event) {
    const key = event.currentTarget.dataset.field
    if (!key) return
    this.setData({ ['form.' + key]: event.detail.value, formError: '' })
  },
  pickStatus(event) {
    const key = event.currentTarget.dataset.key
    const patch = { 'form.status': key, formError: '' }
    // 切到「已读」且没填完成日：带出今天，但用户仍可改；不让它随年份漂移
    if (key === 'read' && !this.data.form.finishedAt) patch['form.finishedAt'] = bs.today()
    if (key === 'read') patch['form.progress'] = '100'
    this.setData(patch)
  },
  pickRating(event) {
    const n = Number(event.currentTarget.dataset.n) || 0
    this.setData({ 'form.rating': this.data.form.rating === n ? 0 : n })
  },
  clearRating() { this.setData({ 'form.rating': 0 }) },

  saveBook() {
    const f = this.data.form
    if (!String(f.title || '').trim()) { this.setData({ formError: '请填写书名' }); return }
    const payload = {
      title: f.title, author: f.author, cover: f.cover, isbn: f.isbn,
      status: f.status, rating: Number(f.rating) || 0,
      startedAt: f.startedAt, finishedAt: f.status === 'read' ? (f.finishedAt || bs.today()) : f.finishedAt,
      pages: f.pages, minutes: f.minutes,
      progress: f.status === 'read' ? 100 : f.progress,
      review: f.review,
      tags: String(f.tags || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
    }
    const isEdit = !!this.data.editingId
    if (isEdit) bs.updateBook(this.data.editingId, payload)
    else bs.addBook(payload)
    this.closeForm()
    this.reload()
    wx.showToast({ title: isEdit ? '已更新' : '已加入书架', icon: 'success' })
  },

  removeBook() {
    const id = this.data.editingId
    if (!id) return
    wx.showModal({
      title: '移出书架',
      content: '这本书的已读记录会被删除，确定吗？',
      confirmColor: '#e0603b',
      success: (r) => {
        if (!r.confirm) return
        bs.removeBook(id)
        this.closeForm()
        this.reload()
        wx.showToast({ title: '已移出', icon: 'success' })
      },
    })
  },

  quickRead(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    bs.markRead(id, bs.today())
    this.reload()
    wx.showToast({ title: '已标记为已读', icon: 'success' })
  },
  bumpProgress(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    bs.bumpProgress(id, 10)
    this.reload()
  },

  // ===== 批量导入（Goodreads / 微信读书导出 / 通用 CSV / JSON）=====
  openImport() { this.setData({ showImport: true, importText: '', importResult: null, importHint: '' }) },
  closeImport() { this.setData({ showImport: false, importText: '', importResult: null, importHint: '' }) },
  onImportInput(event) { this.setData({ importText: event.detail.value, importResult: null }) },
  pasteSample() {
    this.setData({
      importText: '书名,作者,状态,评分,读完日期,阅读时长(分钟),短评\n'
        + '置身事内,兰小欢,已读,5,2026-03-12,320,把地方财政讲清楚了\n'
        + '人类简史,尤瓦尔·赫拉利,已读,4,2026-07-02,410,\n'
        + '设计中的设计,原研哉,在读,, ,120,慢慢看',
      importResult: null,
      importHint: '已填入示例，可直接点「导入到书架」；也可以替换成自己的 CSV。',
    })
  },
  doImport() {
    const text = this.data.importText
    if (!String(text || '').trim()) { this.setData({ importHint: '请先粘贴内容或点「填入示例」' }); return }
    const parsed = bs.parseImport(text)
    if (!parsed.length) { this.setData({ importHint: '没识别到书名，请检查格式（表头需含「书名」）' }); return }
    const r = bs.importBooks(text)
    this.reload()
    this.setData({
      importResult: { added: r.added, skipped: r.skipped, parsed: parsed.length },
      importHint: '识别 ' + parsed.length + ' 本，新增 ' + r.added + ' 本，重复跳过 ' + r.skipped + ' 本。',
    })
    wx.showToast({ title: '导入完成', icon: 'success' })
  },

  // ===== 导出：开放格式，可迁移到其它阅读记录工具 =====
  copyText(text, tip) {
    if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') {
      wx.showModal({ title: '书架数据', content: String(text).slice(0, 600), showCancel: false })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: tip || '已复制', icon: 'none', duration: 1800 }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    })
  },
  copyCsv() { this.copyText(bs.exportCsv(bs.loadBooks()), 'CSV 已复制') },
  copyJson() { this.copyText(bs.exportJson(bs.loadBooks()), 'JSON 已复制') },

  // ===== 年度阅读目标（微信读书式，但只对本人可见、不排名）=====
  openGoal() { this.setData({ goalOpen: true, goalText: String(bs.getGoal() || '') }) },
  closeGoal() { this.setData({ goalOpen: false }) },
  onGoalInput(event) { this.setData({ goalText: event.detail.value }) },
  saveGoal() {
    const n = Math.max(0, Math.min(9999, Math.round(Number(this.data.goalText) || 0)))
    bs.setGoal(n)
    this.setData({ goalOpen: false })
    this.reload()
    wx.showToast({ title: n ? '目标已设为 ' + n + ' 本' : '已清除目标', icon: 'none' })
  },

  goBack() {
    if (typeof wx !== 'undefined' && typeof wx.navigateBack === 'function') wx.navigateBack()
  },
})
