const { footprintAccess, questAccess, characterAccess, todayStr } = require('../../utils/store')
const {
  chooseLocation, getMyLocation, describeCoordinates, chooseImages, uploadImages, readImageAsDataUrl,
} = require('../../utils/footprint-helpers')
const {
  loadCharacters, applyCompanionGrowth, growthDelta, persistGrowth, isSelfCharacter,
} = require('../../utils/world')
const player = require('../../utils/audio-player')
const musicLib = require('../../utils/music-library')
const lifeArchive = require('../../utils/life-archive')

// 足迹 BGM：只把音频音源列为可绑定项（MV 是画面，不是「背景音乐」）。
// 全部从音源库实时读取，不在足迹页另存一份，避免改名/删除后两处对不上。
function bgmAudioTracks() {
  return musicLib.loadTracks().filter((t) => t && t.kind !== 'video')
}
function bgmTrackName(id) {
  if (!id) return ''
  const t = musicLib.trackById(id)
  return t ? t.name : ''
}
function bgmMeta(t) {
  if (!t) return ''
  if (t.missing) return '本地文件已失效 · 请重新导入'
  const base = t.source === 'local' ? '本地音频' : '外部音源'
  return base + (t.cloudPath ? ' · 已上云' : '') + (t.addedAt ? ' · ' + t.addedAt : '')
}

// 用固定像素高度替代 vh：真机上输入法弹起 / 地址栏收缩会重算 vh，
// 导致底部弹层高度塌陷、字段挤压重叠（发布测试版里尤其明显）。
function computeSheetStyles() {
  let h = 0
  try {
    if (typeof wx !== 'undefined') {
      if (typeof wx.getWindowInfo === 'function') h = wx.getWindowInfo().windowHeight || 0
      else if (typeof wx.getSystemInfoSync === 'function') h = wx.getSystemInfoSync().windowHeight || 0
    }
  } catch (e) { h = 0 }
  if (!h || h < 400) return { sheetStyle: '', detailStyle: '', bgmStyle: '' }
  const sheet = Math.round(h * 0.9)
  return {
    sheetStyle: 'height:' + sheet + 'px;',
    detailStyle: 'max-height:' + sheet + 'px;',
    bgmStyle: 'height:' + Math.round(h * 0.72) + 'px;',
  }
}

const MOODS = [
  { key: 'joy', icon: '😄', label: '开心' },
  { key: 'calm', icon: '😌', label: '平静' },
  { key: 'excited', icon: '🤩', label: '兴奋' },
  { key: 'touched', icon: '🥹', label: '感动' },
  { key: 'tired', icon: '😮‍💨', label: '疲惫' },
  { key: 'proud', icon: '😎', label: '自豪' },
]

const CATEGORIES = [
  { key: 'life', icon: '✨', label: '生活' },
  { key: 'food', icon: '🍜', label: '吃喝' },
  { key: 'fun', icon: '🎮', label: '玩乐' },
  { key: 'travel', icon: '✈️', label: '旅行' },
  { key: 'growth', icon: '🌱', label: '成长' },
  { key: 'work', icon: '💼', label: '事业' },
  { key: 'family', icon: '👨‍👩‍👧', label: '家人' },
  { key: 'love', icon: '💗', label: '情感' },
]
function categoryOf(key) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[0]
}

function emptyForm() {
  return {
    occurred_at: todayStr(),
    title: '',
    scene: '',
    people: '',
    locationName: '',
    address: '',
    country: '',
    latitude: null,
    longitude: null,
    mood: 'joy',
    category: 'life',
    images: [],
    quest_id: null,
    chapter: '',
    companionIds: [], // 从角色卡勾选的同行者 id
    bgmTrackId: '',   // 这段足迹绑定的 BGM（音源库曲目 id，空 = 不关联）
  }
}

Page({
  data: {
    authState: 'checking',
    loadError: '',
    allFeet: [],
    groups: [],
    totalCount: 0,
    yearsCount: 0,
    filterYear: 'all',
    yearOptions: [],
    showForm: false,
    editingId: null,
    form: emptyForm(),
    moods: MOODS,
    categories: CATEGORIES,
    categoryFilter: 'all',
    categoryCounts: [],
    commonPlaces: ['家里', '公司', '学校', '健身房', '咖啡厅', '公园', '医院', '机场', '车站', '海边'],
    imageUrlInput: '',
    mapAvailable: false,
    mediaAvailable: false,
    pickerAvailable: false,
    quests: [],
    questNames: {},
    formQuestTitle: '不关联',
    characters: [],       // 角色卡（含 level 信息）
    companionOptions: [], // 同行勾选列表（排除「我」）
    companionSummary: [], // 表单里已勾选角色的头像摘要
    oldCompanionIds: [],  // 编辑时原始同行角色，用于计算亲密度增量
    saving: false,
    formError: '',
    sheetStyle: '',
    detailStyle: '',
    bgmStyle: '',
    showDetail: false,
    detail: null,
    detailImages: [],
    // 图片预览临时态
    previewImages: [],
    // 足迹 BGM 选择弹层
    bgmSheetOpen: false,
    bgmOptions: [],
    bgmSelectedName: '',
    bgmNowPlayingId: '',
    bgmNowPlayingName: '',
    bgmBoundCount: 0, // 已绑定 BGM 的足迹数（真实统计，不是随手填的数字）
    bgmEditFootprintId: '', // 非空 = 直接给这条已有足迹改 BGM（详情弹层入口）
  },

  onLoad() {
    // 检测原生能力，决定显示哪些入口（预览容器可能没有这些 API）
    this.setData(Object.assign({
      mapAvailable: typeof wx !== 'undefined' && typeof wx.chooseLocation === 'function',
      mediaAvailable: typeof wx !== 'undefined' && typeof wx.chooseMedia === 'function',
      pickerAvailable: typeof wx !== 'undefined' && typeof wx.createSelectorQuery === 'function',
    }, computeSheetStyles()))
  },

  onShow() {
    // 接收从首页十年时间轴跳转来的预选年份（用完即清）。
    const focusYear = wx.getStorageSync('footprintFocusYear')
    if (focusYear) {
      this.setData({ pendingFocusYear: String(focusYear) })
      wx.removeStorageSync('footprintFocusYear')
    }
    // 接收「全球选点」页回填的境外地点（用完即清）。
    const picked = wx.getStorageSync('globePickResult')
    if (picked && picked.latitude != null && picked.longitude != null) {
      wx.removeStorageSync('globePickResult')
      this.setData({
        'form.locationName': picked.locationName || '',
        'form.address': picked.address || '',
        'form.country': picked.country || '',
        'form.latitude': picked.latitude,
        'form.longitude': picked.longitude,
      })
      wx.showToast({ title: '已回填境外地点', icon: 'none', duration: 1800 })
    }
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
          loadError: '云服务暂时不稳定，足迹仍是最近一次的内容',
        })
        return
      }
      this.setData({ authState: 'signed-out', groups: [] })
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
    this.setData({ authState: 'signed-out', groups: [], detail: null })
  },

  async loadData() {
    this.setData({ loadError: '' })
    const [footRes, questRes, charResult] = await Promise.all([
      footprintAccess.list(), questAccess.list(), loadCharacters(characterAccess),
    ])
    if (footRes.error) {
      this.setData({ loadError: footRes.error.message || '加载足迹失败' })
      return
    }
    const characters = charResult.characters || []
    const feet = footRes.data || []
    const quests = questRes.data || []
    const questNames = {}
    quests.forEach((q) => { questNames[String(q.id)] = q.title })

    // 足迹 × BGM 绑定映射（footprintId → trackId），只认音源库里还存在的曲目
    const trackMap = lifeArchive.readTrackMap()
    const tracksById = {}
    bgmAudioTracks().forEach((t) => { tracksById[String(t.id)] = t })

    const enriched = feet.map((f) => {
      const mood = MOODS.find((m) => m.key === f.mood) || MOODS[0]
      const category = categoryOf(f.category)
      let images = []
      try { images = f.images ? JSON.parse(f.images) : [] } catch (e) { images = [] }
      let people = []
      try {
        if (f.people) {
          const parsed = JSON.parse(f.people)
          people = Array.isArray(parsed) ? parsed : String(f.people).split(/[,，]/)
        }
      } catch (e) { people = f.people ? String(f.people).split(/[,，]/) : [] }
      const track = tracksById[String(trackMap[String(f.id)] || '')]
      return Object.assign({}, f, {
        moodIcon: mood.icon,
        moodLabel: mood.label,
        categoryIcon: category.icon,
        categoryLabel: category.label,
        categoryKey: category.key,
        images,
        peopleList: people.filter(Boolean),
        hasLocation: f.latitude != null && f.longitude != null,
        year: (f.occurred_at || '').slice(0, 4) || '未知',
        dateText: (f.occurred_at || '').slice(0, 10),
        questName: questNames[String(f.quest_id)] || '',
        bgmId: track ? track.id : '',
        bgmName: track ? track.name : '',
        bgmMissing: !!(track && track.missing),
      })
    })

    // 同行勾选列表排除「我」（主角自己）：自己陪自己不算同行；characters 保留全量用于亲密度回写
    const companionOptions = characters.filter((c) => !isSelfCharacter(c))
    this.setData({
      allFeet: enriched, quests, questNames, characters, companionOptions,
      bgmBoundCount: enriched.filter((f) => f.bgmName).length,
    }, () => this.rebuildGroups())
  },

  // 根据分类 + 年份两个筛选器重算时间线与统计
  rebuildGroups() {
    const all = this.data.allFeet || []
    const cat = this.data.categoryFilter
    const filtered = cat === 'all' ? all : all.filter((f) => f.categoryKey === cat)

    // 分类计数基于全量，显示每个分类有多少条
    const catCount = {}
    all.forEach((f) => { catCount[f.categoryKey] = (catCount[f.categoryKey] || 0) + 1 })
    const categoryCounts = CATEGORIES.filter((c) => catCount[c.key]).map((c) => ({
      ...c, count: catCount[c.key],
    }))

    // 按年份分组（倒序），组内按时间倒序
    const yearMap = {}
    filtered.forEach((f) => {
      if (!yearMap[f.year]) yearMap[f.year] = []
      yearMap[f.year].push(f)
    })
    const years = Object.keys(yearMap).sort((a, b) => b.localeCompare(a))
    const groups = years.map((y) => ({
      year: y,
      count: yearMap[y].length,
      items: yearMap[y].sort((a, b) => (b.occurred_at || '').localeCompare(a.occurred_at || '')),
    }))
    const yearOptions = ['all'].concat(years)

    // 预选年份仅在存在对应分组时生效，否则回落到全部。
    const pending = this.data.pendingFocusYear
    const focusValid = pending && years.indexOf(pending) >= 0 ? pending : 'all'
    if (pending) this.setData({ pendingFocusYear: '' })

    this.setData({
      groups,
      totalCount: filtered.length,
      yearsCount: years.length,
      yearOptions,
      categoryCounts,
      filterYear: focusValid,
    })
  },

  handleRetry() { this.loadData() },

  setFilter(event) {
    this.setData({ filterYear: event.currentTarget.dataset.year })
  },

  setCategoryFilter(event) {
    this.setData({ categoryFilter: event.currentTarget.dataset.cat }, () => this.rebuildGroups())
  },

  getVisibleGroups() {
    if (this.data.filterYear === 'all') return this.data.groups
    return this.data.groups.filter((g) => g.year === this.data.filterYear)
  },

  openForm() {
    const form = emptyForm()
    // 默认带出「此刻正在听的歌」，但仍是一个可改、可清除的显式选择，
    // 不再像以前那样在保存时偷偷绑定、页面上却看不到。
    const now = player.getState()
    const playing = bgmAudioTracks().find((t) => String(t.id) === String(now.trackId))
    if (playing) form.bgmTrackId = playing.id
    this.setData({
      showForm: true, editingId: null, form, formError: '',
      formQuestTitle: '不关联', imageUrlInput: '', companionSummary: [], oldCompanionIds: [],
      bgmSelectedName: playing ? playing.name : '', bgmSheetOpen: false,
      bgmNowPlayingId: playing ? playing.id : '',
      bgmNowPlayingName: playing ? playing.name : '',
      bgmEditFootprintId: '',
    })
  },

  closeForm() {
    this.setData({ showForm: false, editingId: null, formError: '', bgmSheetOpen: false, bgmEditFootprintId: '' })
  },

  noop() {},

  // 从角色卡勾选/取消同行者，同时刷新名字文本字段与头像摘要
  toggleCompanion(event) {
    const id = event.currentTarget.dataset.id
    const all = this.data.characters || []
    let ids = (this.data.form.companionIds || []).slice()
    const at = ids.findIndex((x) => String(x) === String(id))
    if (at >= 0) ids.splice(at, 1)
    else ids.push(id)
    const picked = all.filter((c) => ids.some((x) => String(x) === String(c.id)))
    const summary = picked.map((c) => ({ id: c.id, avatar: c.avatar, name: c.name, color: c.color }))
    this.setData({
      'form.companionIds': ids,
      'form.people': picked.map((c) => c.name).join('，'),
      companionSummary: summary,
      formError: '',
    })
  },

  // 手动改同行文本时，尝试按名字匹配回角色卡；匹配不到的保留为纯文本同行者（「我」不参与匹配）
  onPeopleInput(event) {
    const text = event.detail.value || ''
    const all = (this.data.characters || []).filter((c) => !isSelfCharacter(c))
    const names = text.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const matched = all.filter((c) => names.indexOf(c.name) >= 0)
    const ids = matched.map((c) => c.id)
    const summary = matched.map((c) => ({ id: c.id, avatar: c.avatar, name: c.name, color: c.color }))
    this.setData({ 'form.people': text, 'form.companionIds': ids, companionSummary: summary })
  },

  // ===== 足迹 BGM：显式选择 / 试听 / 解绑 =====
  // 详情弹层入口：直接给一条已存在的足迹换 BGM，不用为了配乐重开整张表单
  openBgmPickerFromDetail() {
    const id = this.data.detail && this.data.detail.id
    if (!id) return
    this.setData({ bgmEditFootprintId: String(id) })
    this.openBgmPicker()
  },

  openBgmPicker() {
    const raw = bgmAudioTracks()
    this._bgmRaw = raw
    const editId = String(this.data.bgmEditFootprintId || '')
    const selected = editId
      ? String((lifeArchive.readTrackMap() || {})[editId] || '')
      : String(this.data.form.bgmTrackId || '')
    const now = player.getState()
    const nowId = String(now.trackId || '')
    const nowTrack = raw.find((t) => String(t.id) === nowId)
    const options = raw.map((t) => Object.assign({}, t, {
      metaText: bgmMeta(t),
      picked: String(t.id) === selected,
      playing: String(t.id) === nowId,
    }))
    this.setData({
      bgmSheetOpen: true,
      bgmOptions: options,
      bgmSelectedName: bgmTrackName(selected),
      bgmNowPlayingId: nowTrack ? nowTrack.id : '',
      bgmNowPlayingName: nowTrack ? nowTrack.name : '',
    })
  },

  closeBgmPicker() { this.setData({ bgmSheetOpen: false, bgmEditFootprintId: '' }) },

  // 已有关联足迹直接写映射并刷新列表；表单状态下只改待保存的表单值。
  async applyBgmChoice(trackId) {
    const editId = String(this.data.bgmEditFootprintId || '')
    if (!editId) {
      this.setData({
        'form.bgmTrackId': trackId,
        bgmSelectedName: bgmTrackName(trackId),
        bgmSheetOpen: false,
        bgmEditFootprintId: '',
      })
      return
    }
    lifeArchive.bindFootprintTrack(editId, trackId)
    this.setData({ bgmSheetOpen: false, bgmEditFootprintId: '', showDetail: false, detail: null })
    wx.showToast({ title: trackId ? '已关联 BGM' : '已取消关联', icon: 'success' })
    await this.loadData()
  },

  selectBgm(event) {
    this.applyBgmChoice(String(event.currentTarget.dataset.id || ''))
  },

  useCurrentBgm() {
    const now = player.getState()
    const nowTrack = bgmAudioTracks().find((t) => String(t.id) === String(now.trackId || ''))
    if (!nowTrack) { wx.showToast({ title: '当前没有在播放的音源', icon: 'none' }); return }
    this.applyBgmChoice(String(nowTrack.id))
  },

  clearBgm() { this.applyBgmChoice('') },

  // 选之前先试听：列表用全局播放器单例，切页也不会被回收。
  // 用试听列表覆盖播放列表可能影响首页当前播放，因此只在音源库里按 id 定位，不另建副本。
  previewBgm(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const list = (this._bgmRaw && this._bgmRaw.length ? this._bgmRaw : bgmAudioTracks())
    const idx = list.findIndex((t) => String(t.id) === id)
    if (idx < 0) return
    player.setList(list)
    player.playIndex(idx)
    wx.showToast({ title: '试听 · ' + list[idx].name, icon: 'none', duration: 1600 })
  },

  // 从时间线卡片 / 详情弹层直接播放这段足迹绑定的歌
  playFootprintBgm(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    const list = bgmAudioTracks()
    const idx = list.findIndex((t) => String(t.id) === id)
    if (idx < 0) { wx.showToast({ title: '这首音源已不在音源库', icon: 'none' }); return }
    player.setList(list)
    player.playIndex(idx)
    wx.showToast({ title: '♪ ' + list[idx].name, icon: 'none', duration: 1800 })
  },

  // 音源库为空：跳回首页并自动打开音乐面板（复用全局悬浮球同一套 flag）
  goImportMusic() {
    if (typeof wx === 'undefined' || typeof wx.switchTab !== 'function') {
      wx.showToast({ title: '请在首页「人生 BGM」导入音源', icon: 'none' })
      return
    }
    try { wx.setStorageSync('openMusicSheetOnShow', true) } catch (e) { /* 忽略 */ }
    this.setData({ bgmSheetOpen: false })
    wx.switchTab({ url: '/pages/index/index' })
  },

  onFieldInput(event) {
    const key = event.currentTarget.dataset.field
    this.setData({ [`form.${key}`]: event.detail.value })
  },

  // 日期：picker 不可用时可直接输入（如 2026-11-24），这里做规范化校验
  onDateInput(event) {
    let v = (event.detail.value || '').trim().replace(/[\/.]/g, '-')
    this.setData({ 'form.occurred_at': v })
  },

  onDatePick(event) {
    this.setData({ 'form.occurred_at': event.detail.value })
  },

  // 常用地点快捷填充
  pickCommonPlace(event) {
    const name = event.currentTarget.dataset.name
    this.setData({ 'form.locationName': name })
  },

  // 图片 URL 手动添加（预览容器无 chooseMedia 时的降级）
  onImageUrlInput(event) {
    this.setData({ imageUrlInput: event.detail.value })
  },

  addImageUrl() {
    let url = (this.data.imageUrlInput || '').trim()
    if (!url) { wx.showToast({ title: '请粘贴图片链接', icon: 'none' }); return }
    if (!/^https?:\/\//.test(url)) url = 'https://' + url
    if (this.data.form.images.length >= 6) {
      wx.showToast({ title: '最多 6 张', icon: 'none' })
      return
    }
    this.setData({
      'form.images': this.data.form.images.concat(url),
      imageUrlInput: '',
    })
  },

  onMoodSelect(event) {
    this.setData({ 'form.mood': event.currentTarget.dataset.key })
  },

  onCategorySelect(event) {
    this.setData({ 'form.category': event.currentTarget.dataset.key })
  },

  onQuestPick(event) {
    const idx = Number(event.detail.value)
    const quest = (this.data.quests || [])[idx]
    this.setData({
      'form.quest_id': quest ? quest.id : null,
      'form.chapter': quest ? (quest.chapter || '') : '',
      formQuestTitle: quest ? quest.title : '不关联',
    })
  },

  async pickLocation() {
    const res = await chooseLocation()
    if (res.error) { wx.showToast({ title: res.error.message, icon: 'none' }); return }
    if (!res.data) return
    this.setData({
      'form.locationName': res.data.locationName,
      'form.address': res.data.address,
      'form.country': '中国',
      'form.latitude': res.data.latitude,
      'form.longitude': res.data.longitude,
    })
  },

  async useMyLocation() {
    wx.showLoading({ title: '定位中…' })
    const res = await getMyLocation()
    wx.hideLoading()
    if (res.error) { wx.showToast({ title: res.error.message, icon: 'none' }); return }
    const desc = describeCoordinates(res.data.latitude, res.data.longitude)
    this.setData({
      'form.latitude': res.data.latitude,
      'form.longitude': res.data.longitude,
      'form.country': '中国',
      'form.locationName': this.data.form.locationName || desc,
    })
    wx.showToast({ title: '已获取位置，记得填地点名称', icon: 'none' })
  },

  clearLocation() {
    this.setData({
      'form.locationName': '', 'form.address': '', 'form.country': '',
      'form.latitude': null, 'form.longitude': null,
    })
  },

  // 境外选点：wx.chooseLocation 只有国内 POI，跳到独立页面用原生地图 + 城市速查表取坐标。
  openGlobePicker() {
    if (typeof wx === 'undefined' || typeof wx.navigateTo !== 'function') {
      wx.showToast({ title: '当前环境不支持跳转', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/globe-picker/globe-picker' })
  },

  async pickImages() {
    const res = await chooseImages(6 - this.data.form.images.length)
    if (res.error) { wx.showToast({ title: res.error.message, icon: 'none' }); return }
    if (!res.data || !res.data.length) return
    wx.showLoading({ title: '处理图片…' })
    // 选图后立即读成 data URL，表单里马上能看到；保存时再决定上传到云端
    const dataUrls = []
    for (const p of res.data) {
      const dataUrl = await readImageAsDataUrl(p)
      if (dataUrl) dataUrls.push(dataUrl)
    }
    wx.hideLoading()
    if (!dataUrls.length) { wx.showToast({ title: '图片读取失败，可改用图片链接', icon: 'none' }); return }
    const merged = this.data.form.images.concat(dataUrls).slice(0, 6)
    this.setData({ 'form.images': merged })
  },

  removeImage(event) {
    const idx = event.currentTarget.dataset.index
    const images = this.data.form.images.slice()
    images.splice(idx, 1)
    this.setData({ 'form.images': images })
  },

  previewFormImage(event) {
    const src = event.currentTarget.dataset.src
    wx.previewImage({ current: src, urls: this.data.form.images })
  },

  async saveFootprint() {
    const f = this.data.form
    if (!f.title || !f.title.trim()) { this.setData({ formError: '给这段足迹起个标题吧' }); return }
    if (!f.occurred_at) { this.setData({ formError: '请选择发生时间' }); return }
    this.setData({ saving: true, formError: '' })

    // 图片直接以内联方式保存：选图时已转成 data URL，粘贴的是 http URL，两者都能直接显示。
    // 这样不依赖云存储上传链路，预览环境与真机都能真正保存并看到图片。
    const finalImages = (f.images || []).filter((p) => /^(https?:\/\/|data:image\/)/.test(p))

    const payload = {
      occurred_at: f.occurred_at,
      title: f.title.trim(),
      scene: (f.scene || '').trim(),
      people: JSON.stringify((f.people || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)),
      location_name: (f.locationName || '').trim(),
      country: (f.country || '').trim() || null,
      latitude: f.latitude,
      longitude: f.longitude,
      mood: f.mood,
      category: f.category || 'life',
      images: JSON.stringify(finalImages),
      quest_id: f.quest_id || null,
      chapter: (f.chapter || '').trim(),
    }

    let res
    const isEdit = !!this.data.editingId
    if (isEdit) {
      res = await footprintAccess.update(this.data.editingId, payload)
    } else {
      res = await footprintAccess.create(payload)
    }
    if (res.error) {
      this.setData({ saving: false, formError: res.error.message || '保存失败' })
      return
    }

    // 人生原声带：以表单里「这段足迹的 BGM」为准，空值 = 主动解绑。
    // 不再在保存时偷偷抓取当前播放曲目（页面上看不到、也改不了）。
    const footprintId = isEdit ? this.data.editingId : (res.data && res.data.id)
    if (footprintId) {
      lifeArchive.bindFootprintTrack(footprintId, String(f.bgmTrackId || ''))
    }

    // 亲密度成长：只对本次「新加入」的同行角色 +10 亲密度。
    // 「同行 N 次」不再靠这里累加计数器，世界页改为直接统计真实足迹记录。
    const selectedIds = f.companionIds || []
    const growthIds = isEdit ? growthDelta(this.data.oldCompanionIds, selectedIds) : selectedIds
    let growthNames = []
    let updatedCharacters = this.data.characters
    if (growthIds.length) {
      const grown = applyCompanionGrowth(this.data.characters, growthIds, { intimacy: 10 })
      updatedCharacters = await persistGrowth(grown, characterAccess)
      growthNames = updatedCharacters
        .filter((c) => growthIds.some((x) => String(x) === String(c.id)))
        .map((c) => c.name)
    }
    this.setData({ saving: false })
    wx.showToast({
      title: growthNames.length
        ? (isEdit ? '已更新 · 羁绊 +' : '足迹已记录 · 羁绊 +')
        : (isEdit ? '已更新' : '足迹已记录'),
      icon: 'success',
    })
    this.closeForm()
    await this.loadData()
    if (growthNames.length) {
      wx.showToast({ title: `与 ${growthNames.join('、')} 的亲密度提升`, icon: 'none', duration: 2200 })
    }
  },

  editFootprint(event) {
    const id = event.currentTarget.dataset.id
    const groups = this.getVisibleGroups()
    let found = null
    groups.forEach((g) => g.items.forEach((f) => { if (String(f.id) === String(id)) found = f }))
    if (!found) return
    // 按同行名字回填角色卡勾选（未匹配到的名字保留在文本里；「我」不参与匹配）
    const all = (this.data.characters || []).filter((c) => !isSelfCharacter(c))
    const peopleNames = found.peopleList || []
    const matched = all.filter((c) => peopleNames.indexOf(c.name) >= 0)
    const companionIds = matched.map((c) => c.id)
    const summary = matched.map((c) => ({ id: c.id, avatar: c.avatar, name: c.name, color: c.color }))
    const boundTrackId = String((lifeArchive.readTrackMap() || {})[String(found.id)] || '')
    this.setData({
      showForm: true,
      editingId: found.id,
      showDetail: false,
      formError: '',
      oldCompanionIds: companionIds,
      companionSummary: summary,
      bgmSelectedName: bgmTrackName(boundTrackId),
      bgmSheetOpen: false,
      bgmEditFootprintId: '',
      form: {
        occurred_at: (found.occurred_at || '').slice(0, 10),
        title: found.title || '',
        scene: found.scene || '',
        people: (found.peopleList || []).join('，'),
        locationName: found.location_name || '',
        address: found.address || '',
        country: found.country || '',
        latitude: found.latitude,
        longitude: found.longitude,
        mood: found.mood || 'joy',
        category: found.categoryKey || 'life',
        images: found.images || [],
        quest_id: found.quest_id || null,
        chapter: found.chapter || '',
        companionIds,
        bgmTrackId: boundTrackId,
      },
      formQuestTitle: found.questName || '不关联',
    })
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id
    const groups = this.getVisibleGroups()
    let found = null
    groups.forEach((g) => g.items.forEach((f) => { if (String(f.id) === String(id)) found = f }))
    if (!found) return
    this.setData({ showDetail: true, detail: found, detailImages: found.images || [], bgmEditFootprintId: '' })
  },

  closeDetail() { this.setData({ showDetail: false, detail: null, bgmEditFootprintId: '' }) },

  previewDetailImage(event) {
    const src = event.currentTarget.dataset.src
    wx.previewImage({ current: src, urls: this.data.detailImages })
  },

  openMap(event) {
    const lat = Number(event.currentTarget.dataset.lat)
    const lng = Number(event.currentTarget.dataset.lng)
    const name = event.currentTarget.dataset.name || '足迹地点'
    if (!isFinite(lat) || !isFinite(lng)) return
    if (typeof wx.openLocation !== 'function') {
      wx.showToast({ title: '当前环境不支持打开地图', icon: 'none' })
      return
    }
    wx.openLocation({
      latitude: lat,
      longitude: lng,
      name,
      address: name,
      scale: 16,
    })
  },

  deleteFootprint() {
    const id = this.data.detail && this.data.detail.id
    if (!id) return
    wx.showModal({
      title: '删除足迹',
      content: '删除后无法恢复，确定吗？',
      confirmColor: '#e0603b',
      success: async (r) => {
        if (!r.confirm) return
        const res = await footprintAccess.remove(id)
        if (res.error) { wx.showToast({ title: '删除失败', icon: 'none' }); return }
        lifeArchive.unbindFootprintTrack(id)
        this.closeDetail()
        wx.showToast({ title: '已删除', icon: 'success' })
        await this.loadData()
      },
    })
  },

  goQuests() {
    wx.switchTab({ url: '/pages/quests/quests' })
  },
})
