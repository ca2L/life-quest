const {
  questAccess, checkinAccess, profileAccess,
  levelFromXp, checkInQuest,
} = require('../../utils/store')
const { CHAPTERS, chapterStats, calcStreak } = require('../../utils/gamification')

// 从标题里解析次数：识别「1次 / 三次 / 每天2遍」这类写法，让标题数字与打卡目标同步。
// 只匹配紧跟 次/遍/回 量词的数字，避免把「Python3」等误判为次数。
const CN_DIGITS = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
function parseCountFromTitle(title) {
  const text = String(title || '')
  const arabic = text.match(/(\d+)\s*[次遍回]/)
  if (arabic) {
    const n = parseInt(arabic[1], 10)
    if (n > 0 && n <= 999) return n
  }
  const cn = text.match(/([一二两三四五六七八九十])\s*[次遍回]/)
  if (cn && CN_DIGITS[cn[1]]) return CN_DIGITS[cn[1]]
  return null
}

const TEMPLATES = [
  { quest_type: 'main', chapter: '第一章 · 启程', title: '找到真正想做的事', description: '用三个月尝试三个方向，写下结论', xp_reward: 200, target: 1 },
  { quest_type: 'main', chapter: '第二章 · 成长', title: '掌握一项核心技能', description: '每天 1 小时，坚持 100 天', xp_reward: 300, target: 100 },
  { quest_type: 'side', chapter: '第二章 · 成长', title: '每周运动三次', description: '身体是主线的载体', xp_reward: 20, target: 3 },
  { quest_type: 'side', chapter: '序章', title: '读一本一直想读的书', description: '', xp_reward: 60, target: 1 },
  { quest_type: 'main', chapter: '第三章 · 深耕', title: '完成一个代表作', description: '把技能变成可以被看见的作品', xp_reward: 500, target: 1 },
]

Page({
  data: {
    authState: 'checking',
    loadError: '',
    quests: [],
    groups: [],
    chapterStats: [],
    filter: 'all',
    showForm: false,
    showTemplates: false,
    templates: TEMPLATES,
    editingId: null,
    chapters: CHAPTERS.map((c) => c.key),
    form: { quest_type: 'main', chapter: CHAPTERS[0].key, title: '', description: '', xp_reward: 50, target: 1, due_date: '' },
    formError: '',
    submitting: false,
    streak: 0,
    doneCount: 0,
    activeCount: 0,
    donePercent: 0,
    dashRingStyle: '',
    totalXp: 0,
    level: 1,
  },

  onShow() {
    this.restore()
  },

  async restore() {
    this.setData({ authState: 'checking', loadError: '' })
    const { data: session, error } = await getApp().ensureSession()
    if (error || !session) {
      getApp().resetSession()
      if (error && getApp().isTransientError(error) && getApp().wasSignedIn()) {
        this.setData({
          authState: 'signed-in',
          loadError: '云服务暂时不稳定，任务列表仍是最近一次的内容',
        })
        return
      }
      this.setData({ authState: 'signed-out', quests: [] })
      return
    }
    this.setData({ authState: 'signed-in' })
    await this.loadQuests()
  },

  async onSignedIn() {
    getApp().resetSession()
    await this.restore()
  },

  async loadQuests() {
    this.setData({ loadError: '' })
    const [questRes, checkinRes, profileRes] = await Promise.all([
      questAccess.list(),
      checkinAccess.list(),
      profileAccess.list(),
    ])
    if (questRes.error) {
      this.setData({ loadError: questRes.error.message || '加载失败' })
      return
    }
    const quests = (questRes.data || []).map((q) => Object.assign({}, q, {
      progressPercent: Math.min(100, Math.round((q.progress / (q.target || 1)) * 100)),
      typeLabel: q.quest_type === 'main' ? '主线' : '支线',
    }))
    const profile = (profileRes.data && profileRes.data[0]) || null
    const streak = calcStreak(checkinRes.data || [])
    const doneCount = quests.filter((q) => q.status === 'done').length
    const donePercent = quests.length ? Math.round((doneCount / quests.length) * 100) : 0
    this.setData({
      quests,
      chapterStats: chapterStats(quests),
      streak: streak.current,
      doneCount,
      activeCount: quests.filter((q) => q.status !== 'done').length,
      donePercent,
      // 总完成度环：conic-gradient 完整串注入（避开小程序 CSS 变量兼容坑）
      dashRingStyle: `background: conic-gradient(#8f7bf5 ${donePercent}%, rgba(255,255,255,0.12) ${donePercent}% 100%);`,
      totalXp: (profile && profile.xp) || 0,
      level: levelFromXp(profile ? profile.xp : 0).level,
    }, () => this.buildGroups())
  },

  buildGroups() {
    const filter = this.data.filter
    const visible = this.data.quests.filter((q) => {
      if (filter === 'all') return true
      if (filter === 'done') return q.status === 'done'
      return q.quest_type === filter && q.status !== 'done'
    })
    const existing = {}
    this.data.groups.forEach((g) => { existing[g.key] = g.expanded })
    const groups = CHAPTERS.map((ch) => {
      const items = visible.filter((q) => (q.chapter || '序章') === ch.key)
      return {
        key: ch.key,
        name: ch.name,
        subtitle: ch.subtitle,
        icon: ch.icon,
        quests: items,
        expanded: existing[ch.key] !== false,
      }
    }).filter((g) => g.quests.length)
    this.setData({ groups })
  },

  handleRetry() { this.loadQuests() },

  setFilter(event) {
    this.setData({ filter: event.currentTarget.dataset.filter }, () => this.buildGroups())
  },

  toggleGroup(event) {
    const key = event.currentTarget.dataset.key
    const groups = this.data.groups.map((g) => (g.key === key ? Object.assign({}, g, { expanded: !g.expanded }) : g))
    this.setData({ groups })
  },

  openCreate() {
    this.setData({
      showForm: true, editingId: null, formError: '',
      form: { quest_type: 'main', chapter: CHAPTERS[0].key, title: '', description: '', xp_reward: 50, target: 1, due_date: '' },
    })
  },

  openEdit(event) {
    const id = event.currentTarget.dataset.id
    const q = this.data.quests.find((item) => item.id === id)
    if (!q) return
    this.setData({
      showForm: true, editingId: id, formError: '',
      form: {
        quest_type: q.quest_type,
        chapter: q.chapter,
        title: q.title,
        description: q.description || '',
        xp_reward: q.xp_reward,
        target: q.target,
        due_date: q.due_date || '',
      },
    })
  },

  closeForm() { this.setData({ showForm: false, editingId: null, formError: '' }) },
  noop() {},

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [`form.${field}`]: event.detail.value, formError: '' })
  },

  selectType(event) { this.setData({ 'form.quest_type': event.currentTarget.dataset.type }) },
  selectChapter(event) { this.setData({ 'form.chapter': event.currentTarget.dataset.chapter }) },

  async submitForm() {
    if (this.data.submitting) return
    const f = this.data.form
    const title = (f.title || '').trim()
    if (!title) { this.setData({ formError: '请输入任务名称' }); return }
    // 标题里的次数（如「每周运动1次」）优先作为打卡目标，保证标题与进度始终一致
    const parsedCount = parseCountFromTitle(title)
    const target = parsedCount || Math.max(1, Number(f.target) || 1)
    const payload = {
      quest_type: f.quest_type,
      chapter: f.chapter,
      title,
      description: (f.description || '').trim(),
      xp_reward: Math.max(1, Number(f.xp_reward) || 50),
      target,
      due_date: f.due_date || '',
    }
    const editing = !!this.data.editingId
    this.setData({ submitting: true, formError: '' })
    const res = editing
      ? await questAccess.update(this.data.editingId, payload)
      : await questAccess.create(payload)
    this.setData({ submitting: false })
    if (res.error) { this.setData({ formError: res.error.message || '保存失败' }); return }
    this.closeForm()
    await this.loadQuests()
    wx.showToast({ title: editing ? '已更新' : '任务已创建', icon: 'success' })
  },

  confirmDelete(event) {
    const id = event.currentTarget.dataset.id
    wx.showModal({
      title: '删除任务',
      content: '确定要删除这个任务吗？打卡记录会保留。',
      success: async (r) => {
        if (!r.confirm) return
        const res = await questAccess.remove(id)
        if (res.error) { wx.showToast({ title: res.error.message || '删除失败', icon: 'none' }); return }
        await this.loadQuests()
      },
    })
  },

  async checkIn(event) {
    const id = event.currentTarget.dataset.id
    const q = this.data.quests.find((item) => item.id === id)
    if (!q) return
    const res = await checkInQuest(q)
    if (res.error) { wx.showToast({ title: res.error.message || '打卡失败', icon: 'none' }); return }
    if (res.justCompleted && res.claim && !res.claim.error) {
      const c = res.claim
      const title = c.reward.label ? `${c.reward.label} +${c.reward.xp} XP` : `+${c.reward.xp} XP`
      wx.showModal({
        title: c.leveledUp ? `升级！Lv.${c.newLevel}` : '任务完成',
        content: `${title}${c.leveledUp ? '\n解锁新的称号与更高目标。' : ''}`,
        showCancel: false,
        confirmText: '继续冒险',
      })
    } else {
      wx.showToast({ title: '打卡成功', icon: 'success' })
    }
    await this.loadQuests()
  },

  openTemplates() { this.setData({ showTemplates: true }) },
  closeTemplates() { this.setData({ showTemplates: false }) },

  async applyTemplate(event) {
    const index = Number(event.currentTarget.dataset.index)
    const t = TEMPLATES[index]
    if (!t) return
    const res = await questAccess.create(t)
    if (res.error) { wx.showToast({ title: res.error.message || '添加失败', icon: 'none' }); return }
    wx.showToast({ title: '已加入任务板', icon: 'success' })
    this.setData({ showTemplates: false })
    await this.loadQuests()
  },

  async applyAllTemplates() {
    for (let i = 0; i < TEMPLATES.length; i++) {
      const res = await questAccess.create(TEMPLATES[i])
      if (res.error) { wx.showToast({ title: res.error.message || '添加失败', icon: 'none' }); return }
    }
    wx.showToast({ title: '已添加 5 个模板任务', icon: 'success' })
    this.setData({ showTemplates: false })
    await this.loadQuests()
  },

  async resetProgress(event) {
    const id = event.currentTarget.dataset.id
    const res = await questAccess.update(id, { progress: 0, status: 'active' })
    if (res.error) { wx.showToast({ title: res.error.message || '操作失败', icon: 'none' }); return }
    await this.loadQuests()
  },

  // 快速调整目标次数：直接改进度分母，解决「标题写1次但进度按3次走」的错位
  editTarget(event) {
    const id = event.currentTarget.dataset.id
    const q = this.data.quests.find((item) => item.id === id)
    if (!q) return
    wx.showModal({
      title: '目标次数',
      content: `「${q.title}」需要完成几次？（当前 ${q.target} 次，进度 ${q.progress}/${q.target}）`,
      editable: true,
      placeholderText: String(q.target),
      success: async (r) => {
        if (!r.confirm) return
        const n = parseInt(r.content, 10)
        if (!n || n < 1 || n > 999) { wx.showToast({ title: '请输入 1-999 的数字', icon: 'none' }); return }
        // 新目标小于当前进度时，把进度收敛到目标内，避免出现 5/2 这类错位
        const patch = { target: n }
        if ((q.progress || 0) > n) {
          patch.progress = n
          if (n > 0) patch.status = 'done'
        }
        const res = await questAccess.update(id, patch)
        if (res.error) { wx.showToast({ title: '修改失败', icon: 'none' }); return }
        wx.showToast({ title: '目标已更新', icon: 'success' })
        await this.loadQuests()
      },
    })
  },
})
