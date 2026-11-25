/**
 * 人生 BGM · 音乐模块数据
 *
 * 仓库信息为 2026-11-25 GitHub REST API 快照，静态内置、不做实时请求。
 * 合规与能力边界：
 *  - lx-music-desktop 是 Electron 桌面端软件，音源由使用者自行配置，本项目不调用其音源；
 *  - 小程序个人主体不支持 web-view，github.com 也无法配置为业务域名；
 *  - 因此本模块提供的是「氛围开关 + 场景音轨 + 开源项目入口 + 我的音源」，不播放在线音乐。
 *    用户自行导入的本地音频可在小程序内播放；在线音乐请在洛雪音乐桌面端 / 移动端中打开。
 */

const SNAPSHOT = '2026-11-25'

const DESKTOP = {
  key: 'desktop',
  label: '桌面端 · 洛雪音乐助手',
  repo: 'lyswhut/lx-music-desktop',
  url: 'https://github.com/lyswhut/lx-music-desktop',
  stars: '55.6k',
  starsExact: '55,649',
  lang: 'TypeScript',
  license: 'Apache-2.0',
  desc: '一个基于 Electron 的音乐软件',
}

const MOBILE = {
  key: 'mobile',
  label: '移动端 · 洛雪音乐',
  repo: 'lyswhut/lx-music-mobile',
  url: 'https://github.com/lyswhut/lx-music-mobile',
  stars: '19.6k',
  starsExact: '19,595',
  lang: 'React Native',
  desc: '一个基于 React Native 开发的音乐软件',
}

const DOC = {
  key: 'doc',
  label: '官方文档 · 使用与音源说明',
  url: 'https://lyswhut.github.io/lx-music-doc/',
}

const LINKS = [
  { key: 'desktop', icon: '🖥️', label: DESKTOP.label, url: DESKTOP.url, primary: true },
  { key: 'mobile', icon: '📱', label: MOBILE.label, url: MOBILE.url, primary: false },
  { key: 'doc', icon: '📖', label: DOC.label, url: DOC.url, primary: false },
]

// 场景音轨：结合「人生主线任务」的游戏化语境，给不同活动配一句氛围文案。
const SCENES = [
  {
    key: 'focus', icon: '🧠', name: '专注', genre: 'Lo-fi / 环境音',
    track: '低拍速，别抢主线',
    tip: '把主线任务拆成 25 分钟一段，音乐只做背景。',
  },
  {
    key: 'commute', icon: '🚇', name: '通勤', genre: '城市流行 / 轻电子',
    track: '路途也是进度条',
    tip: '在心里过一遍今天要推进的三件事。',
  },
  {
    key: 'workout', icon: '🏃', name: '运动', genre: '高 BPM / 鼓点',
    track: '给连击加个节拍',
    tip: '先热身，再冲一次本周最佳连击。',
  },
  {
    key: 'calm', icon: '🌙', name: '睡前', genre: '钢琴 / 白噪音',
    track: '存档，明天继续',
    tip: '写一句今日复盘，然后放心下线。',
  },
  {
    key: 'cook', icon: '🍳', name: '做饭', genre: '轻爵士 / Bossa Nova',
    track: '支线也很香',
    tip: '给「好好吃饭」这条支线记一次打卡。',
  },
  {
    key: 'country', icon: '🤠', name: '乡村', genre: 'Country / Americana',
    track: '回到旷野，慢慢走',
    tip: '把一条支线任务放到路上做，进度一样算。',
  },
  {
    key: 'gaming', icon: '🎮', name: '游戏 BGM', genre: 'Game OST / Chiptune',
    track: '给今天开一局',
    tip: '把主线当成关卡，先通关最容易的那一个。',
  },
  {
    key: 'zelda', icon: '🗡️', name: '塞尔达', genre: '海拉鲁风格 · 管弦致敬',
    track: '去海拉鲁散个步',
    tip: '像林克一样：地图先点亮一格，再走下一格。',
  },
]

function sceneOf(key) {
  return SCENES.find((s) => s.key === key) || SCENES[0]
}

// 把播放态与场景展开成页面可直接 setData 的扁平字段（WXML 不依赖深层对象取值）。
function buildState(playing, sceneKey) {
  const s = sceneOf(sceneKey)
  return {
    musicPlaying: !!playing,
    musicSceneKey: s.key,
    musicSceneIcon: s.icon,
    musicSceneName: s.name,
    musicSceneGenre: s.genre,
    musicSceneTrack: s.track,
    musicSceneTip: s.tip,
  }
}

module.exports = {
  SNAPSHOT,
  DESKTOP,
  MOBILE,
  DOC,
  LINKS,
  SCENES,
  sceneOf,
  buildState,
}
