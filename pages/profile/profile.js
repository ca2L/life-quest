const {
  cloud, profileAccess, questAccess, checkinAccess, levelFromXp,
} = require('../../utils/store')
const { calcStreak, buildBadges, LEVEL_TITLES } = require('../../utils/gamification')
const bookshelf = require('../../utils/bookshelf')

const AGE_PRESETS = [60, 80, 90, 100]
const MAX_LEVEL = LEVEL_TITLES.length

function xpForLevel(level) {
  return Math.pow(level, 2) * 100
}

Page({
  data: {
    authState: 'checking',
    loadError: '',
    profile: null,
    player: { level: 1, xp: 0, title: '见习冒险者', progressPercent: 0, nextLevelXp: 100, currentLevelXp: 0 },
    badges: { unlockedCount: 0, total: 9, list: [] },
    badgeGroups: [],
    ladder: [],
    nickname: '',
    birthday: '',
    targetAge: 80,
    agePresets: AGE_PRESETS,
    todayKey: '',
    checkinCount: 0,
    streak: 0,
    bestStreak: 0,
    saving: false,
    saveError: '',
    userEmail: '',
    booksReadCount: 0,
    // 次级信息默认收起：首屏只保留“我是谁 / 我的进度 / 去哪儿”，降低注意力损耗
    showLadder: false,
    showProfileForm: false,
  },

  toggleLadder() { this.setData({ showLadder: !this.data.showLadder }) },
  toggleProfileForm() { this.setData({ showProfileForm: !this.data.showProfileForm }) },

  onLoad() {
    const d = new Date()
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    this.setData({ todayKey: key })
  },

  onShow() {
    this.restore()
    try {
      this.setData({ booksReadCount: bookshelf.statsOf(bookshelf.loadBooks()).readCount })
    } catch (e) { /* 书架数据不可用时不影响我的页 */ }
  },

  async restore() {
    this.setData({ authState: 'checking', loadError: '' })
    const { data: session, error } = await getApp().ensureSession()
    if (error || !session) {
      getApp().resetSession()
      if (error && getApp().isTransientError(error) && getApp().wasSignedIn()) {
        this.setData({
          authState: 'signed-in',
          loadError: '云服务暂时不稳定，稍后重试可刷新',
        })
        return
      }
      this.setData({ authState: 'signed-out', profile: null })
      return
    }
    const email = (session.user && (session.user.email || session.user.name)) || ''
    this.setData({ authState: 'signed-in', userEmail: email })
    await this.loadProfile()
  },

  async onSignedIn() {
    getApp().resetSession()
    await this.restore()
  },

  async loadProfile() {
    this.setData({ loadError: '' })
    const [profileRes, checkinRes, questRes] = await Promise.all([
      profileAccess.list(),
      checkinAccess.list(),
      questAccess.list(),
    ])
    if (profileRes.error) {
      this.setData({ loadError: profileRes.error.message || '加载失败' })
      return
    }
    const profile = (profileRes.data && profileRes.data[0]) || null
    const checkins = checkinRes.data || []
    const quests = questRes.data || []
    const streak = calcStreak(checkins)
    const player = levelFromXp(profile ? profile.xp : 0)
    const rawBadges = buildBadges({
      quests,
      checkins,
      profile: profile || {},
      streak,
      level: player.level,
    })
    // 业务呈现：已解锁的排前面并高亮，未解锁的显示解锁条件与完成度进度条
    const sorted = rawBadges.list.slice().sort((a, b) =>
      (b.unlocked ? 1 : 0) - (a.unlocked ? 1 : 0) || b.progress - a.progress)
    const badges = Object.assign({}, rawBadges, {
      list: sorted,
      percent: rawBadges.total ? Math.round((rawBadges.unlockedCount / rawBadges.total) * 100) : 0,
      nextLocked: sorted.find((b) => !b.unlocked) || null,
    })
    // 借鉴小黑盒：按「启程 / 精进 / 传说」分组，每组带 x/y 完成度胶囊
    const groupOrder = ['启程', '精进', '传说']
    const badgeGroups = groupOrder.map((g) => {
      const items = sorted.filter((b) => b.group === g)
      const got = items.filter((b) => b.unlocked).length
      return { name: g, got, total: items.length, items }
    }).filter((g) => g.total)
    const ladder = []
    for (let lv = Math.max(1, player.level - 1); lv <= Math.min(MAX_LEVEL, player.level + 2); lv++) {
      ladder.push({
        level: lv,
        title: LEVEL_TITLES[lv - 1] || '传说',
        xp: xpForLevel(lv),
        current: lv === player.level,
      })
    }

    this.setData({
      profile,
      player,
      nickname: profile ? (profile.owner_name || '') : '',
      birthday: profile ? (profile.birthday || '') : '',
      targetAge: profile ? (profile.target_age || 80) : 80,
      checkinCount: checkins.length,
      streak: streak.current,
      bestStreak: streak.best,
      badges,
      badgeGroups,
      ladder,
    })
  },

  handleRetry() { this.loadProfile() },

  onInput(event) {
    const field = event.currentTarget.dataset.field
    this.setData({ [field]: event.detail.value, saveError: '' })
  },

  onBirthdayChange(event) {
    this.setData({ birthday: event.detail.value, saveError: '' })
  },

  selectAge(event) {
    this.setData({ targetAge: Number(event.currentTarget.dataset.age) })
  },

  async saveProfile() {
    if (this.data.saving) return
    const birthday = (this.data.birthday || '').trim()
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      this.setData({ saveError: '生日格式应为 YYYY-MM-DD' })
      return
    }
    const age = Math.max(1, Math.min(120, Number(this.data.targetAge) || 80))
    this.setData({ saving: true, saveError: '' })
    const payload = {
      owner_name: (this.data.nickname || '').trim(),
      birthday,
      target_age: age,
    }
    const res = this.data.profile
      ? await profileAccess.update(this.data.profile.id, payload)
      : await profileAccess.create(payload)
    this.setData({ saving: false })
    if (res.error) { this.setData({ saveError: res.error.message || '保存失败' }); return }
    wx.showToast({ title: '已保存', icon: 'success' })
    await this.loadProfile()
  },

  goInsights() {
    wx.navigateTo({ url: '/pages/insights/insights' })
  },

  goBooks() {
    wx.navigateTo({ url: '/pages/books/books' })
  },

  async signOut() {
    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '退出登录',
        content: '确定退出吗？你的任务数据会保留在云端。',
        success: (r) => resolve(r.confirm),
      })
    })
    if (!confirm) return
    await cloud.auth.signOut()
    getApp().resetSession()
    this.setData({ authState: 'signed-out', profile: null })
    wx.showToast({ title: '已退出', icon: 'success' })
  },
})
