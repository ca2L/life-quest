const {
  profileAccess, questAccess, checkinAccess, footprintAccess,
  levelFromXp, todayStr, checkInQuest,
} = require('../../utils/store')
const { buildLifeGrid, buildDecadeBlocks, buildDecadeRows, buildFootprintTimeline, buildLifeMilestones } = require('../../utils/life-grid')
const { calcStreak, buildBadges, greeting } = require('../../utils/gamification')
const { buildWorld, readLocalCharacters } = require('../../utils/world')
const { GUIDES } = require('../../utils/guides')
const { guideCards, totalCards, dailyPicks } = require('../../utils/guide-cards')
const { contentOf, countOf, previewOf, contentByPick } = require('../../utils/guide-content')
const {
  SNAPSHOT, DESKTOP, MOBILE, LINKS, SCENES, buildState,
} = require('../../utils/music')
const musicLib = require('../../utils/music-library')
// 数仓同步：上云成功的曲目把元数据写入 music_library，管理后台即可见
const contentSync = require('../../utils/content-sync')
// 免费曲库（Jamendo CC）+ 每日推荐引擎 + 播放历史
const freeLibrary = require('../../utils/free-library')
const dailyRecommend = require('../../utils/daily-recommend')
const randomWalk = require('../../utils/random-walk')

// 每日快捷指令：张潇雨随机漫步日历（iOS 快捷指令，小程序只能复制链接唤起）
const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/970bdef001e046f2a4ea697846331d17'
// 全局音频单例：放在模块层，切页面/切 tab 都不会被回收，音乐继续播
const player = require('../../utils/audio-player')
const lifeModels = require('../../utils/life-models')
const lifeArchive = require('../../utils/life-archive')
const bookshelf = require('../../utils/bookshelf')

// 书架卡片数由阅读卡数据推导，避免手写数字与内容脱节
const BOOK_GUIDES = GUIDES.map((g) => Object.assign({}, g, {
  cardCount: guideCards(g.id).length,
  contentCount: countOf(g.id),
  contentPreview: previewOf(g.id, 3).join(' · '),
}))
const BOOK_TOTAL = totalCards()
const MUSIC_STATE_KEY = 'lifeMusicState'

Page({
  // 音乐模块的初始状态由数据模块展开，避免页面里手写一份重复的场景文案
  data: Object.assign({
    authState: 'checking',
    loadError: '',
    profile: null,
    player: { level: 1, xp: 0, title: '见习冒险者', progressPercent: 0, nextLevelXp: 100, currentLevelXp: 0 },
    grid: null,
    decadeBlocks: [],
    milestones: [],
    fallbackRows: [],
    timeline: { years: [], total: 0, activeYears: 0 },
    decadeSubMode: 'story', // story 足迹故事 | weeks 周格
    renderMode: 'auto', // auto | overview | timeline | canvas | fallback
    badges: { unlockedCount: 0, total: 9, recent: [], list: [] },
    activeQuests: [],
    todayDone: 0,
    totalQuests: 0,
    todayStr: '',
    greetingText: '',
    nickname: '冒险者',
    hasBirthday: false,
    viewMode: 'life',
    canvasReady: false,
    streak: 0,
    bestStreak: 0,
    world: { percent: 0, explored: 0, total: 24, activeRealms: [] },
    characterCount: 0,
    guides: BOOK_GUIDES,
    totalCards: BOOK_TOTAL,
    booksReadCount: 0, // 真实已读本数（来自「我的书架」，不是随手填的计数）
    guideSheetOpen: false,
    guideContentOpen: false,
    guideContents: [],
    activeGuide: null,
    activeContentNo: '',
    activeContentId: '',
    guideCards: [],
    cardIndex: 0,
    cardProgress: 0,
    atFirst: true,
    atLast: false,
  }, buildState(false, 'focus'), {
    musicSnapshot: SNAPSHOT,
    musicRepo: DESKTOP,
    musicMobile: MOBILE,
    musicLinks: LINKS,
    musicScenes: SCENES,
    musicSheetOpen: false,
    musicTracks: [],
    musicImportOpen: false,
    musicImportText: '',
    videoSrc: '',
    videoName: '',
    videoPlaying: false,
    // 系统悬浮小窗：push 跳下一页、pop 离开当前页都自动拉起小窗（基础库 2.11.0+）
    pipMode: ['push', 'pop'],
    videoPip: false,
    currentTrackIndex: -1,
    currentTrackName: '',
    trackPlaying: false,
    trackProgress: 0,
    trackTimeText: '0:00 / 0:00',
    backgroundCapable: false,
    playerEngine: 'inner',
    cloudUploadingId: '',
    entropyReminder: null,
    // 改名弹层
    renameOpen: false,
    renameId: '',
    renameIndex: -1,
    renameText: '',
    todayKey: '',
    todayPicks: [],
    // 首页 tab（微信读书式左右滑切换）
    activeTab: 0,
    tabs: [
      { key: 'main', label: '主线' },
      { key: 'books', label: '书架' },
      { key: 'music', label: '音乐' },
    ],
    // 每日推荐
    recommendItems: [],
    recommendNote: '',
    recommendLoading: false,
    recommendPlayingName: '',
    // 随机漫步日历：点一次随机抽一条
    walkCount: 0,
    walkCard: null,
  }),

  // 部分运行环境（如 H5 预览）没有 createSelectorQuery，必须检测后再用 canvas。
  canUseCanvas() {
    return typeof wx !== 'undefined'
      && typeof wx.createSelectorQuery === 'function'
      && typeof wx.getWindowInfo === 'function'
  },

  onLoad() {
    this.restoreMusicState()
    this.loadDailyPicks()
    this.setData({ walkCount: randomWalk.count() })
    // 订阅全局播放器：页面只负责把状态画出来，真正的播放在模块单例里
    this._playerUnsub = player.subscribe((s) => this.applyPlayerState(s))
    this.loadMusicTracks()
    player.restoreLast()
    this.applyPlayerState(player.getState())
    // 每日推荐：先出本地结果，免费曲库同步完再刷新一次
    this.loadDailyRecommend()
    this.syncFreeLibrary()
  },

  // 随机漫步日历：每次点击抽一条，来自飞书多维表格导出的条目数据
  drawRandomWalk() {
    const item = randomWalk.pick()
    if (!item || !item.text) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '条目还没导入，请先导入飞书表格导出文件', icon: 'none', duration: 2600 })
      }
      return
    }
    this.setData({ walkCard: item })
  },

  againRandomWalk() {
    this.drawRandomWalk()
  },

  closeWalkCard() {
    this.setData({ walkCard: null })
  },

  copyShortcutLink() {
    if (typeof wx === 'undefined' || typeof wx.setClipboardData !== 'function') return
    wx.setClipboardData({
      data: SHORTCUT_URL,
      success: () => {
        if (typeof wx.showToast === 'function') {
          wx.showToast({ title: '链接已复制，去 Safari 打开添加', icon: 'none', duration: 2600 })
        }
      },
    })
  },

  // 注意：这里刻意不销毁音频。音频实例属于全局单例，
  // 页面卸载（比如进阅读器再返回）不应该导致音乐中断。
  onUnload() {
    if (typeof this._playerUnsub === 'function') {
      this._playerUnsub()
      this._playerUnsub = null
    }
  },

  // 今日 6 张：按日期做确定性随机，同一天不变、跨天自动换一批
  loadDailyPicks() {
    const key = todayStr()
    // 同一指南抽到 2 张时，避免都落到同一篇正文；冲突就顺延到该组里没用过的下一篇
    const usedByGuide = {}
    const picks = dailyPicks(key, 6).map((c, i) => {
      const all = contentOf(c.guide)
      let content = contentByPick(c.guide, c.no, i)
      if (content) {
        const used = usedByGuide[c.guide] || (usedByGuide[c.guide] = {})
        if (used[content.no] && all.length) {
          const start = all.findIndex((x) => x.no === content.no)
          for (let k = 1; k < all.length; k++) {
            const cand = all[(start + k) % all.length]
            if (!used[cand.no]) { content = cand; break }
          }
        }
        used[content.no] = true
      }
      return Object.assign({}, c, {
        shortTitle: c.title.length > 22 ? c.title.slice(0, 22) + '…' : c.title,
        shortChapter: c.chapter.length > 12 ? c.chapter.slice(0, 12) + '…' : c.chapter,
        contentTitle: content ? content.title : '',
        contentTag: content ? content.tag : '',
        contentNo: content ? content.no : '',
        contentId: content ? 'gc-' + content.no : '',
      })
    })
    this.setData({ todayKey: key, todayPicks: picks })
  },

  onShow() {
    this.restore()
    try {
      this.setData({ booksReadCount: bookshelf.statsOf(bookshelf.loadBooks(), todayStr(), bookshelf.getGoal()).readCount })
    } catch (e) { /* 书架数据不可用时不影响首页 */ }
    // 从别的页面回来：同步列表与播放态，但绝不暂停——切页面继续播是默认行为
    this.setTracks(musicLib.loadTracks())
    this.applyPlayerState(player.getState())
    // 从系统小窗点回来时，把画面收回弹层里
    if (this.data.videoPip) this.exitVideoPip()
    // 悬浮播放球从别的 tab 跳回来时，补开音乐面板
    try {
      if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' &&
          wx.getStorageSync('openMusicSheetOnShow')) {
        wx.removeStorageSync('openMusicSheetOnShow')
        this.setData({ musicSheetOpen: true })
      }
    } catch (e) { /* storage 不可用就忽略 */ }
  },

  onMiniPlayerOpen() {
    this.setData({ musicSheetOpen: true })
  },

  onHide() {
    // picture-in-picture-mode 只在路由 push / pop 时触发，switchTab 切 tab 不进路由栈，
    // 所以这里再兜底请求一次后台小窗；失败就静默降级到组件属性那条路径。
    if (this.data.videoSrc && !this.data.videoPip) this.requestVideoPip(true)
    // 音频由全局播放器持有，这里刻意不做任何暂停。
  },

  // 把全局播放器状态映射成页面 data，页面不持有任何音频实例
  applyPlayerState(s) {
    if (!s) return
    const patch = {
      trackPlaying: !!s.playing,
      trackProgress: s.progress || 0,
      trackTimeText: s.timeText || '0:00 / 0:00',
      backgroundCapable: !!s.backgroundCapable,
      playerEngine: s.engine || 'inner',
    }
    // 播 MV 时列表高亮归视频，不让音频索引覆盖
    if (!this.data.videoSrc) {
      patch.currentTrackIndex = s.index
      patch.currentTrackName = s.name
    }
    this.setData(patch)
  },

  async restore() {
    this.setData({ authState: 'checking', loadError: '' })
    const { data: session, error } = await getApp().ensureSession()
    if (error || !session) {
      getApp().resetSession()
      // 服务端抖动（502 / 网络失败）≠ 未登录：本登录周期内已登录过就保留现有数据，
      // 只挂错误条提示重试，不要把用户踢回登录页。
      if (error && getApp().isTransientError(error) && getApp().wasSignedIn()) {
        this.setData({
          authState: 'signed-in',
          loadError: '云服务暂时不稳定，数据仍是最近一次的内容',
        })
        return
      }
      this.setData({
        authState: 'signed-out', profile: null, grid: null,
        activeQuests: [], badges: null, hasBirthday: false,
      })
      return
    }
    this.setData({ authState: 'signed-in' })
    await this.loadData()
  },

  async onSignedIn() {
    getApp().resetSession()
    await this.restore()
  },

  async onSignOut() {
    const { cloud } = require('../../utils/store')
    await cloud.auth.signOut()
    getApp().resetSession()
    this.setData({ authState: 'signed-out', profile: null, grid: null, activeQuests: [], badges: null })
  },

  async loadData() {
    this.setData({ loadError: '', canvasReady: false })
    const [profileRes, questRes, checkinRes, footRes] = await Promise.all([
      profileAccess.list(),
      questAccess.list(),
      checkinAccess.list(),
      footprintAccess.list(),
    ])
    if (profileRes.error || questRes.error) {
      const err = profileRes.error || questRes.error
      this.setData({ loadError: err.message || '加载失败，请重试' })
      return
    }

    const profile = (profileRes.data && profileRes.data[0]) || null
    const quests = questRes.data || []
    const checkins = checkinRes.data || []
    const player = levelFromXp(profile ? profile.xp : 0)
    const world = buildWorld(footRes.data || [])
    const characterCount = readLocalCharacters().length
    const grid = profile && profile.birthday
      ? buildLifeGrid(profile.birthday, profile.target_age)
      : null
    const decadeBlocks = buildDecadeBlocks(grid)
    const milestones = buildLifeMilestones(grid)
    const timeline = buildFootprintTimeline(grid, footRes.data || [])
    const streakInfo = calcStreak(checkins)
    const badges = buildBadges({
      quests,
      checkins,
      profile: profile || {},
      streak: streakInfo,
      level: player.level,
    })
    // 关系熵：只从已有角色卡 + 足迹同行记录推导，不新增任何采集。
    // 一次只推一条、可永久关闭，措辞不带「应该」，避免变成社交压力清单。
    const entropy = lifeModels.buildRelationshipEntropy({
      characters: readLocalCharacters(),
      footprints: footRes.data || [],
      dismissed: lifeArchive.readDismissed(),
    })

    const activeQuests = quests
      .filter((q) => q.status !== 'done')
      .sort((a, b) => {
        if (a.quest_type !== b.quest_type) return a.quest_type === 'main' ? -1 : 1
        return 0
      })
      .slice(0, 3)
      .map((q) => Object.assign({}, q, {
        progressPercent: Math.min(100, Math.round((q.progress / (q.target || 1)) * 100)),
      }))

    this.setData({
      profile,
      player,
      grid,
      decadeBlocks,
      milestones,
      timeline,
      activeQuests,
      todayDone: quests.filter((q) => q.status === 'done').length,
      totalQuests: quests.length,
      todayStr: todayStr(),
      greetingText: greeting(),
      nickname: (profile && profile.owner_name) || '冒险者',
      hasBirthday: !!(profile && profile.birthday),
      streak: streakInfo.current,
      bestStreak: streakInfo.best,
      badges,
      world,
      characterCount,
      entropyReminder: entropy.reminder,
    }, () => {
      if (grid) this.scheduleDraw()
    })
  },

  handleRetry() {
    this.loadData()
  },

  setViewMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (mode === this.data.viewMode) return
    this.setData({ viewMode: mode, canvasReady: false })
    this.scheduleDraw()
  },

  setDecadeSubMode(event) {
    const mode = event.currentTarget.dataset.mode
    if (mode === this.data.decadeSubMode) return
    this.setData({ decadeSubMode: mode, canvasReady: false })
    this.scheduleDraw()
  },

  // 展示某年龄的足迹详情：点时间轴节点时跳到足迹页并预选年份。
  openAgeFootprints(event) {
    const age = Number(event.currentTarget.dataset.age)
    if (!Number.isFinite(age) || !this.data.grid) return
    const birthYear = Number(this.data.grid.birthday.slice(0, 4))
    const year = birthYear + age
    wx.setStorageSync('footprintFocusYear', year)
    wx.switchTab({ url: '/pages/footprints/footprints' })
  },

  // 全景用 WXML 十年块视图；十年默认「足迹故事」时间轴，可切到 canvas/WXML 周格。
  scheduleDraw() {
    const grid = this.data.grid
    if (!grid) return
    if (this.data.viewMode === 'life') {
      this.setData({ renderMode: 'overview' })
      return
    }
    if (this.data.decadeSubMode === 'story') {
      this.setData({ renderMode: 'timeline' })
      return
    }
    this.setData({ fallbackRows: buildDecadeRows(grid) })
    if (!this.canUseCanvas()) {
      this.setData({ renderMode: 'fallback' })
      return
    }
    this.setData({ renderMode: 'canvas' }, () => {
      const attempt = (n) => {
        if (this.data.canvasReady) return
        if (n > 3) {
          this.setData({ renderMode: 'fallback' })
          return
        }
        this.drawGrid(n, attempt)
      }
      if (typeof wx.nextTick === 'function') wx.nextTick(() => attempt(0))
      else attempt(0)
    })
  },

  drawGrid(attempt, retry) {
    const grid = this.data.grid
    if (!grid || !this.canUseCanvas()) return
    wx.createSelectorQuery()
      .select('#lifeGrid')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          if (retry) setTimeout(() => retry((attempt || 0) + 1), 120)
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2
        const width = res[0].width
        const mode = this.data.viewMode
        const overview = mode === 'life'
        const rows = overview ? grid.targetAge : (grid.decadeEnd - grid.decadeStart)
        const cell = overview
          ? Math.max(2, Math.floor(width / 53) - 1)
          : Math.max(6, Math.floor(width / 53) + 3)
        const gap = overview ? 1 : 2
        const step = cell + gap
        const labelWidth = overview ? 0 : 52
        const height = rows * step + (overview ? 0 : 24)

        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, width, height)
        if (ctx.textBaseline) ctx.textBaseline = 'middle'

        for (let r = 0; r < rows; r++) {
          const year = overview ? r : grid.decadeStart + r
          if (!overview) {
            ctx.fillStyle = '#a09ab8'
            ctx.font = '20px sans-serif'
            ctx.fillText(String(year), 0, r * step + cell / 2)
          }
          for (let w = 0; w < 52; w++) {
            const index = year * 52 + w
            const lived = index < grid.livedWeeks
            const isCurrentYear = year === grid.currentYearIndex
            const isNow = isCurrentYear && w === grid.weekInYear
            if (isNow) ctx.fillStyle = '#ff9f43'
            else if (lived) ctx.fillStyle = isCurrentYear ? '#7c6cf0' : '#b9aef7'
            else ctx.fillStyle = '#e4e1f5'
            const x = labelWidth + w * step
            const y = r * step
            if (cell >= 6 && ctx.roundRect) {
              ctx.beginPath()
              ctx.roundRect(x, y, cell, cell, 2)
              ctx.fill()
            } else {
              ctx.fillRect(x, y, cell, cell)
            }
          }
        }
        if (this.data.canvasReady !== true) this.setData({ canvasReady: true })
      })
  },

  async quickCheckIn(event) {
    const id = event.currentTarget.dataset.id
    const q = this.data.activeQuests.find((item) => item.id === id)
    if (!q) return
    const res = await checkInQuest(q)
    if (res.error) {
      wx.showToast({ title: res.error.message || '打卡失败', icon: 'none' })
      return
    }
    if (res.justCompleted && res.claim && !res.claim.error) {
      const c = res.claim
      const tail = c.leveledUp ? ` 升级到 Lv.${c.newLevel}！` : ''
      wx.showToast({
        title: `${c.reward.label ? c.reward.label + ' +' : '+'} ${c.reward.xp} XP${tail}`,
        icon: 'success',
        duration: 2500,
      })
    } else {
      wx.showToast({ title: '打卡成功', icon: 'success' })
    }
    await this.loadData()
  },

  goQuests() {
    wx.switchTab({ url: '/pages/quests/quests' })
  },

  goProfile() {
    wx.switchTab({ url: '/pages/profile/profile' })
  },

  goFootprints() {
    wx.switchTab({ url: '/pages/footprints/footprints' })
  },

  goWorld() {
    wx.switchTab({ url: '/pages/world/world' })
  },

  goInsights() {
    wx.navigateTo({ url: '/pages/insights/insights' })
  },

  goBooks() {
    wx.navigateTo({ url: '/pages/books/books' })
  },

  // 关系熵提醒：点关闭后永久不再提示这个人（措辞克制，不做压力监控）
  dismissEntropy(event) {
    const id = event.currentTarget.dataset.id
    lifeArchive.dismissEntropy(id, todayStr())
    this.setData({ entropyReminder: null })
  },

  // ===== 人生 BGM · 音乐模块 =====
  // 播放态与场景存本地：切换页面回来仍保持，且不需要云端表。
  restoreMusicState() {
    let saved = null
    try {
      if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
        saved = wx.getStorageSync(MUSIC_STATE_KEY)
      }
    } catch (e) { saved = null }
    this.setData(buildState(saved && saved.playing, saved && saved.scene))
  },

  persistMusicState(playing, scene) {
    try {
      if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
        // 合并写入：这个 key 还存着「上次听的曲目」，不能整体覆盖掉
        const cur = wx.getStorageSync(MUSIC_STATE_KEY) || {}
        wx.setStorageSync(MUSIC_STATE_KEY, Object.assign({}, cur, {
          playing: !!playing,
          scene,
        }))
      }
    } catch (e) { /* storage 不可用时仅保留本次会话状态 */ }
  },

  // 氛围开关：小程序内不播放在线音乐，这里只切换唱片/均衡器的视觉状态。
  toggleMusic() {
    const playing = !this.data.musicPlaying
    this.setData(buildState(playing, this.data.musicSceneKey))
    this.persistMusicState(playing, this.data.musicSceneKey)
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({
        title: playing ? '氛围已开启 · 音乐请在洛雪里播放' : '已暂停',
        icon: 'none', duration: 1800,
      })
    }
  },

  // 首页音乐卡的播放键：有真实音源就控音频，没有才退化成氛围开关
  toggleFromCard() {
    const st = player.getState()
    if (st.playing) { player.pause(); return }
    if (st.src && !st.missing) { player.toggle(); return }
    this.toggleMusic()
  },

  setMusicScene(event) {
    const key = event.currentTarget.dataset.key
    const state = buildState(this.data.musicPlaying, key)
    this.setData(state)
    this.persistMusicState(state.musicPlaying, state.musicSceneKey)
  },

  openMusic() {
    this.setData({ musicSheetOpen: true })
  },

  closeMusic() {
    // 音频由全局播放器持有，关面板 / 切页面都继续播。
    // MV 组件已经移到弹层外，关面板只会把它缩成右下角浮窗，不会中断播放。
    this.setData({ musicSheetOpen: false })
  },

  copyMusicLink(event) {
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {}
    const url = ds.url || DESKTOP.url
    const fallback = () => {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({ title: '链接', content: url, showCancel: false, confirmText: '知道了' })
      }
    }
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      wx.setClipboardData({
        data: url,
        success: () => {
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '已复制，粘贴到浏览器打开', icon: 'none', duration: 2200 })
          }
        },
        fail: fallback,
      })
    } else {
      fallback()
    }
  },

  // ===== 我的音源：本地导入 / 外部导入 / 导出 / 播放 =====
  // 列表展示文案在 JS 里算好，WXML 不堆嵌套三元，改起来不容易出错
  decorateTracks(rawList) {
    const busy = this.data.cloudUploadingId || ''
    return (rawList || []).map((t) => {
      const cloudBacked = !!t.cloudPath
      const isLocalAudio = t.source === 'local' && t.kind !== 'video'
      return Object.assign({}, t, {
        metaText: t.missing
          ? '本地文件已失效 · 请重新导入'
          : (t.builtin
            ? '内置精选 · ' + (t.desc || '演示音源')
            : ((t.source === 'local'
              ? (t.kind === 'video' ? '本地 MV' : '本地音频')
              : '外部音源') + (cloudBacked ? ' · 已上云' : '') + (t.addedAt ? ' · ' + t.addedAt : ''))),
        cloudLabel: cloudBacked ? '☁ 云端已存 · 息屏可播' : '',
        canUpload: isLocalAudio && !cloudBacked && !t.missing,
        isUploading: busy === t.id,
      })
    })
  },

  // 把本地音源传到云端，换取可后台播放的 https 直链。
  // 云模块惰性加载：没点过上云就不会碰到 SDK，离线/低版本零影响。
  async uploadTrackToCloud(event) {
    const id = event.currentTarget.dataset.id
    if (!id || this.data.cloudUploadingId) return
    const track = musicLib.trackById(id)
    if (!track) return
    this.setData({ cloudUploadingId: id })
    this.setTracks(musicLib.loadTracks())
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '正在上传到云端…', icon: 'none', duration: 3000 })
    }
    let r
    try {
      r = await require('../../utils/cloud-music').uploadTrack(track)
    } catch (e) {
      r = { ok: false, error: (e && e.message) || '上云异常' }
    }
    this.setData({ cloudUploadingId: '' })
    if (!r.ok) {
      this.setTracks(musicLib.loadTracks())
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: r.error || '上云失败', icon: 'none', duration: 2600 })
      }
      return
    }
    this.setTracks(musicLib.setCloudInfo(id, r.cloudPath))
    // 元数据同步进共享数仓（music_library），失败不影响播放，可由补同步追平
    let syncFail = ''
    const syncedTrack = musicLib.trackById(id)
    if (syncedTrack && syncedTrack.cloudPath) {
      const syncRes = await contentSync.syncTrack(syncedTrack)
      if (!syncRes.ok) syncFail = '；数仓同步失败：' + (syncRes.error || '')
    }
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({
        title: syncFail ? '已上云' + syncFail : '已上云 · 息屏也能继续播',
        icon: syncFail ? 'none' : 'success',
        duration: syncFail ? 3000 : 2200,
      })
    }
  },

  // 列表与全局播放器保持同一份数据，避免「列表删了但还在响」这类错位
  setTracks(rawList) {
    const list = this.decorateTracks(rawList)
    this.setData({ musicTracks: list })
    player.setList(list)
    return list
  },

  loadMusicTracks() {
    const list = this.setTracks(musicLib.loadTracks())
    this.backfillLibraryOnce(list)
    return list
  },

  // 每次会话补同步一次：把历史上云、但还没进数仓的曲目追平（如本次导入的 3 首）
  backfillLibraryOnce(tracks) {
    if (this._libraryBackfilled || !contentSync || !contentSync.syncAll) return
    this._libraryBackfilled = true
    contentSync.syncAll(tracks).then((r) => {
      if (r.total > 0 && r.errors.length) {
        console.warn('[content-sync] 数仓补同步部分失败：', r.errors)
      }
    }).catch((e) => {
      console.warn('[content-sync] 数仓补同步异常：', e)
      // 失败允许下次重试
      this._libraryBackfilled = false
    })
  },

  // ── 免费曲库每日同步（Jamendo CC，未配置 key 时静默跳过）──
  syncFreeLibrary() {
    if (this._freeLibSynced) return
    this._freeLibSynced = true
    freeLibrary.syncDaily().then((r) => {
      if (!r.skipped && r.ok && r.saved > 0) {
        // 新曲目入库后刷新推荐池
        this.loadDailyRecommend()
      }
    }).catch((e) => {
      console.warn('[free-library] 每日同步异常：', e)
      this._freeLibSynced = false
    })
  },

  // ── 每日推荐 ──
  loadDailyRecommend(nonce) {
    this.setData({ recommendLoading: true })
    const run = nonce ? dailyRecommend.recommendShuffle : dailyRecommend.recommend
    run({ scene: this.data.musicSceneKey || '' }, nonce).then((res) => {
      if (!nonce && this._recNonce) return // 已被「换一批」的更新覆盖
      const items = (res.items || []).map((it) => ({
        track: it.track,
        reason: it.reason,
      }))
      let note = res.reason || ''
      if (!note) {
        if (freeLibrary.hasKey()) note = '按你的播放历史与当前场景挑选 · 每天不同'
        else note = '按播放历史从本机与云端曲库挑选（接入免费曲库：在 utils/free-library.js 填入 Jamendo client_id）'
      }
      this.setData({ recommendItems: items, recommendNote: note, recommendLoading: false })
    }).catch((e) => {
      this.setData({ recommendItems: [], recommendNote: '推荐暂不可用：' + ((e && e.message) || ''), recommendLoading: false })
    })
  },

  refreshRecommend() {
    this._recNonce = (this._recNonce || 0) + 1
    this.loadDailyRecommend(this._recNonce)
  },

  // 把推荐项转成全局播放器可播的 track 形态
  playableFromRecommend(item) {
    const t = item.track || {}
    if (t.source_url || t.url) {
      return {
        id: t.id || 'rec' + Date.now(), name: t.name || t.title || '推荐曲目',
        source: 'external', kind: 'audio', path: '', url: t.source_url || t.url,
        category: t.category || '', scene: this.data.musicSceneKey || '', size: 0,
      }
    }
    if (t.cloudPath || t.cloud_path) {
      return {
        id: t.id || 'rec' + Date.now(), name: t.name || t.title || '推荐曲目',
        source: 'local', kind: 'audio', path: '', url: '',
        cloudPath: t.cloudPath || t.cloud_path, category: t.category || '',
        scene: this.data.musicSceneKey || '', size: 0,
      }
    }
    return null
  },

  playRecommend(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const item = this.data.recommendItems[idx]
    if (!item) return
    const track = this.playableFromRecommend(item)
    if (!track) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '这首没有可播放的音源链接', icon: 'none' })
      }
      return
    }
    player.setList([track])
    player.playIndex(0)
    this.setData({ recommendPlayingName: track.name })
  },

  // 把推荐曲目收进「我的音源」（仅支持有直链的免费曲库/外链曲目）
  saveRecommend(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const item = this.data.recommendItems[idx]
    if (!item) return
    const t = item.track || {}
    const url = t.source_url || t.url || ''
    if (!url) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '本地曲目无需收藏', icon: 'none' })
      }
      return
    }
    const r = musicLib.addExternalTracks(item.track.name + ' | ' + url)
    this.setTracks(r.list)
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '已收进我的音源', icon: 'success' })
    }
  },

  // ── 首页 tab：点击切换 + 手势左右滑（微信读书式）──
  onTabTap(event) {
    const tab = Number(event.currentTarget.dataset.tab)
    if (tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
  },

  onTabTouchStart(event) {
    const t = event && event.touches && event.touches[0]
    this._tabTouch = t ? { x: t.clientX, y: t.clientY } : null
  },

  onTabTouchEnd(event) {
    if (!this._tabTouch) return
    const t = event && event.changedTouches && event.changedTouches[0]
    const start = this._tabTouch
    this._tabTouch = null
    if (!t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // 横向位移足够大、且明显大于纵向位移才算翻页；纵向滚动不误触
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    const cur = this.data.activeTab
    const next = dx < 0 ? cur + 1 : cur - 1
    if (next < 0 || next > 2) return
    this.setData({ activeTab: next })
  },

  startTrack(index) {
    const list = this.data.musicTracks || []
    if (!list.length) return
    const i = Math.max(0, Math.min(list.length - 1, Number(index) || 0))
    const track = list[i]
    if (!track) return
    if (track.kind === 'video') { this.playVideo(track, i); return }
    // 播音频前先收掉 MV，避免画面和声音同时存在
    this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    player.playIndex(i)
  },

  playTrack(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const list = this.data.musicTracks || []
    const track = list[idx]
    if (!track) return
    if (track.kind === 'video') { this.playVideo(track, idx); return }
    if (this.data.videoSrc) this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    if (idx === this.data.currentTrackIndex && this.data.trackPlaying) {
      this.toggleTrackPlay()
      return
    }
    this.startTrack(idx)
  },

  // MV：停止音频、切到原生 <video> 播放（画面与控件由原生组件提供）
  playVideo(track, idx) {
    const src = musicLib.playablePath(track)
    if (!src) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '这条 MV 没有可播放地址', icon: 'none' })
      }
      return
    }
    // 播 MV 时暂停音频（不 stop，回来还能接着听）
    player.pause()
    this.setData({
      trackPlaying: false,
      currentTrackIndex: idx,
      currentTrackName: track.name,
      videoSrc: src,
      videoName: track.name,
      videoPlaying: true,
    }, () => {
      if (typeof wx !== 'undefined' && typeof wx.createVideoContext === 'function') {
        try { wx.createVideoContext('musicVideo', this).play() } catch (e) { /* 忽略 */ }
      }
    })
  },

  // ===== MV 悬浮小窗（微信系统级 PiP，可跨页面继续播）=====
  videoContext() {
    if (typeof wx === 'undefined' || typeof wx.createVideoContext !== 'function') return null
    try { return wx.createVideoContext('musicVideo', this) } catch (e) { return null }
  },

  pipUnsupported() {
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({
        title: '当前微信版本不支持后台小窗，切页面会自动尝试进入小窗',
        icon: 'none', duration: 2600,
      })
    }
  },

  // 主动进入后台小窗播放。silent=true 用于 onHide 兜底，失败了不打扰用户。
  requestVideoPip(silent) {
    const vc = this.videoContext()
    if (!vc || typeof vc.requestBackgroundPlayback !== 'function') {
      if (!silent) this.pipUnsupported()
      return false
    }
    try {
      vc.requestBackgroundPlayback()
      return true
    } catch (e) {
      if (!silent) this.pipUnsupported()
      return false
    }
  },

  exitVideoPip() {
    const vc = this.videoContext()
    if (vc) {
      try { if (typeof vc.exitBackgroundPlayback === 'function') vc.exitBackgroundPlayback() } catch (e) { /* 忽略 */ }
      try { if (typeof vc.exitPictureInPicture === 'function') vc.exitPictureInPicture() } catch (e) { /* 忽略 */ }
    }
    this.setData({ videoPip: false })
  },

  toggleVideoPip() {
    if (!this.data.videoSrc) return
    if (this.data.videoPip) { this.exitVideoPip(); return }
    const ok = this.requestVideoPip(false)
    if (ok && typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '已切到悬浮小窗，可自由切页面', icon: 'none', duration: 2200 })
    }
  },

  onEnterPip() { this.setData({ videoPip: true }) },
  onLeavePip() { this.setData({ videoPip: false }) },

  closeVideo() {
    if (this.data.videoPip) this.exitVideoPip()
    this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
  },

  onVideoError() {
    this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '视频格式不支持，建议用 mp4 / mov', icon: 'none', duration: 2200 })
    }
  },

  // 只给 UI 用：真正的音轨循环在全局播放器里
  audioIndexes() {
    return player.audioIndexes()
  },

  toggleTrackPlay() {
    if (this.data.videoSrc) {
      if (typeof wx !== 'undefined' && typeof wx.createVideoContext === 'function') {
        const vc = wx.createVideoContext('musicVideo', this)
        if (this.data.videoPlaying) vc.pause()
        else vc.play()
      }
      this.setData({ videoPlaying: !this.data.videoPlaying })
      return
    }
    if (!(this.data.musicTracks || []).length) return
    // 播放器自己有「选中曲/暂停/继续」的判断，页面不再重复
    player.toggle()
  },

  prevTrack() {
    if (this.data.videoSrc) {
      // 视频不走上/下一首：先收起再切到音频列表
      this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    }
    player.prev()
  },
  nextTrack() {
    if (this.data.videoSrc) {
      this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    }
    player.next()
  },

  // ===== 改名：导入的音乐允许自定义名称，改完立即落库 =====
  openRenameTrack(event) {
    const idx = Number(event.currentTarget.dataset.idx)
    const track = (this.data.musicTracks || [])[idx]
    if (!track) return
    this.setData({
      renameOpen: true,
      renameId: track.id,
      renameIndex: idx,
      renameText: track.name || '',
    })
  },

  onRenameInput(event) {
    this.setData({ renameText: (event && event.detail && event.detail.value) || '' })
  },

  cancelRename() {
    this.setData({ renameOpen: false, renameId: '', renameIndex: -1, renameText: '' })
  },

  confirmRename() {
    const id = this.data.renameId
    const name = String(this.data.renameText || '').trim()
    if (!id) return
    if (!name) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '名称不能为空', icon: 'none' })
      }
      return
    }
    const list = musicLib.renameTrack(id, name)
    // 同步给全局播放器：正在播的那首改名后，底部播放条和系统控制中心都要跟着变
    this.setTracks(list)
    this.setData({ renameOpen: false, renameId: '', renameIndex: -1, renameText: '' })
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: '名称已保存', icon: 'success' })
    }
  },

  // 本地音频 / MV：从聊天会话选文件（mp3 / mp4 / mov…），按扩展名自动区分音、视频
  importLocalTrack() {
    if (typeof wx === 'undefined' || typeof wx.chooseMessageFile !== 'function') {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({
          title: '当前环境不支持选文件',
          content: '请在微信里打开小程序，从聊天会话选择 mp3 或 mp4 文件（可以先发给自己）。',
          showCancel: false, confirmText: '知道了',
        })
      }
      return
    }
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: musicLib.LOCAL_EXT,
      success: (res) => {
        const f = res && res.tempFiles && res.tempFiles[0]
        if (!f) return
        this.persistImportedFile(f.path, f.name, f.size, musicLib.kindOf(f.name))
      },
      fail: (err) => {
        if (err && String(err.errMsg || '').indexOf('cancel') >= 0) return
        if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
          wx.showToast({ title: '导入失败，可从聊天会话重选', icon: 'none' })
        }
      },
    })
  },

  // 相册选 MV：chooseMedia 拿不到原始文件名，生成一个可读名称
  importAlbumVideo() {
    if (typeof wx === 'undefined' || typeof wx.chooseMedia !== 'function') {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({
          title: '当前环境不支持选视频',
          content: '请在微信里打开小程序，从相册选择一段视频作为 MV。',
          showCancel: false, confirmText: '知道了',
        })
      }
      return
    }
    wx.chooseMedia({
      count: 1, mediaType: ['video'], sourceType: ['album'],
      success: (res) => {
        const f = res && res.tempFiles && res.tempFiles[0]
        if (!f || !f.tempFilePath) return
        const label = '相册 MV' + (f.duration ? ' ' + Math.round(f.duration) + 's' : '')
        this.persistImportedFile(f.tempFilePath, label, f.size, 'video')
      },
      fail: (err) => {
        if (err && String(err.errMsg || '').indexOf('cancel') >= 0) return
        if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
          wx.showToast({ title: '选视频失败，可改从聊天会话导入', icon: 'none' })
        }
      },
    })
  },

  // 导入即保存：临时文件转成本地持久文件，名称与来源立刻写进 storage，
  // 不需要用户再点「保存」；持久化失败会如实提示，不假装成功。
  persistImportedFile(filePath, name, size, kind) {
    const finish = (savedPath, persisted) => {
      const list = musicLib.addLocalTrack(savedPath, name, size, kind)
      this.setTracks(list)
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        let title = kind === 'video' ? '已导入 MV，点条目播放' : '已导入音频并保存到本机'
        let icon = 'success'
        if (!persisted) {
          title = '已导入，但没能长期保存，重启后可能失效'
          icon = 'none'
        }
        wx.showToast({ title, icon, duration: persisted ? 1800 : 2600 })
      }
    }
    musicLib.persistFile(filePath, name, (savedPath, persisted) => {
      finish(savedPath, persisted)
    })
  },

  toggleImportPanel() {
    this.setData({ musicImportOpen: !this.data.musicImportOpen, musicImportText: '' })
  },
  onImportInput(event) {
    this.setData({ musicImportText: event.detail.value || '' })
  },
  confirmImportExternal() {
    const r = musicLib.addExternalTracks(this.data.musicImportText)
    this.setTracks(r.list)
    this.setData({ musicImportOpen: false, musicImportText: '' })
    if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
      wx.showToast({ title: r.added ? '已导入 ' + r.added + ' 条' : '没有识别到内容', icon: 'none' })
    }
  },

  exportMusicTracks(event) {
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {}
    const list = this.data.musicTracks || []
    if (!list.length) {
      if (typeof wx !== 'undefined' && typeof wx.showToast === 'function') {
        wx.showToast({ title: '还没有音源可导出', icon: 'none' })
      }
      return
    }
    const text = ds.format === 'json' ? musicLib.exportJson(list) : musicLib.exportText(list)
    const fallback = () => {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({ title: '音源清单', content: text.slice(0, 600), showCancel: false, confirmText: '知道了' })
      }
    }
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      wx.setClipboardData({
        data: text,
        success: () => {
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '已复制，可粘贴到其他音乐 App', icon: 'none', duration: 2200 })
          }
        },
        fail: fallback,
      })
    } else fallback()
  },

  removeTrack(event) {
    const id = event.currentTarget.dataset.id
    const current = (this.data.musicTracks || [])[this.data.currentTrackIndex]
    const isCurrentVideo = !!this.data.videoSrc && current && current.id === id
    const removed = musicLib.trackById(id)
    const list = musicLib.removeTrack(id)
    // 音频由播放器处理：删的是当前曲就停，删别的歌不影响播放
    this.setTracks(list)
    if (isCurrentVideo) {
      this.setData({ videoSrc: '', videoName: '', videoPlaying: false })
    }
    // 顺手清理云端副本（尽力而为，失败不阻塞本地删除）
    if (removed && removed.cloudPath) {
      try { require('../../utils/cloud-music').removeCloudTrack(removed.cloudPath) } catch (e) { /* 忽略 */ }
    }
  },

  // 书架 / 今日推荐 → 全屏翻书阅读器（可直达指定卡片）
  openReader(event) {
    const ds = (event && event.currentTarget && event.currentTarget.dataset) || {}
    const guide = ds.guide || 'live'
    const no = ds.no || ''
    const url = '/pages/reader/reader?guide=' + guide + (no ? '&no=' + encodeURIComponent(no) : '')
    if (typeof wx !== 'undefined' && typeof wx.navigateTo === 'function') {
      wx.navigateTo({ url })
    }
  },

  // 书架「具体内容」：菜谱含食材与分步做法、人生/技能含操作步骤，逐条展开阅读
  // 书架大卡 → 该指南全量正文
  openGuideContent(event) {
    const id = event.currentTarget.dataset.id
    const guide = (this.data.guides || []).find((g) => g.id === id)
    if (!guide) return
    this.setData({
      activeGuide: guide,
      guideContents: contentOf(id),
      activeContentNo: '',
      activeContentId: '',
      guideContentOpen: true,
    })
  },

  // 今日 6 张 → 同一套正文弹层，并自动定位 / 高亮这张卡对应的那一篇
  openPickContent(event) {
    const pi = Number(event.currentTarget.dataset.pi)
    const pick = (this.data.todayPicks || [])[pi]
    if (!pick) return
    const guide = (this.data.guides || []).find((g) => g.id === pick.guide)
    if (!guide) return
    this.setData({
      activeGuide: guide,
      guideContents: contentOf(pick.guide),
      activeContentNo: pick.contentNo || '',
      activeContentId: pick.contentId || '',
      guideContentOpen: true,
    })
  },

  closeGuideContent() {
    this.setData({ guideContentOpen: false, activeContentNo: '', activeContentId: '' })
  },

  // ===== 人生书架 · 卡片式阅读（旧弹层保留为备用入口）=====
  openGuide(event) {
    const id = event.currentTarget.dataset.id
    const guide = (this.data.guides || []).find((g) => g.id === id)
    if (!guide) return
    const cards = guideCards(id)
    this.setData({
      activeGuide: guide,
      guideCards: cards,
      cardIndex: 0,
      cardProgress: cards.length ? Math.round(100 / cards.length) : 0,
      atFirst: true,
      atLast: cards.length <= 1,
      guideSheetOpen: true,
    })
  },

  applyCardIndex(idx) {
    const total = (this.data.guideCards || []).length || 1
    const safe = Math.max(0, Math.min(total - 1, Number(idx) || 0))
    this.setData({
      cardIndex: safe,
      cardProgress: Math.round(((safe + 1) / total) * 100),
      atFirst: safe === 0,
      atLast: safe === total - 1,
    })
  },

  onCardChange(event) {
    const detail = event && event.detail ? event.detail : {}
    this.applyCardIndex(detail.current)
  },

  prevCard() { this.applyCardIndex(this.data.cardIndex - 1) },

  nextCard() { this.applyCardIndex(this.data.cardIndex + 1) },

  jumpCard(event) {
    this.applyCardIndex(event.currentTarget.dataset.idx)
  },

  closeGuide() {
    this.setData({ guideSheetOpen: false })
  },

  // 阻止弹层内容区的点击冒泡到遮罩（遮罩点击会关闭）
  noop() {},

  copyGuideLink() {
    const guide = this.data.activeGuide
    if (!guide) return
    const url = guide.url
    const fallback = () => {
      if (typeof wx !== 'undefined' && typeof wx.showModal === 'function') {
        wx.showModal({ title: '仓库链接', content: url, showCancel: false, confirmText: '知道了' })
      }
    }
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      wx.setClipboardData({
        data: url,
        success: () => {
          if (typeof wx.showToast === 'function') {
            wx.showToast({ title: '已复制，粘贴到浏览器打开', icon: 'none', duration: 2200 })
          }
        },
        fail: fallback,
      })
    } else {
      fallback()
    }
  },
})
