/**
 * 人生年报叙事：Spotify Wrapped 式的「一年一张长图」。
 *
 * 刻意不做的事（这是这个功能的灵魂，别加回来）：
 *  - 不排名、不打分、不与任何人比较
 *  - 不出现「超越 X% 的用户」「完成度」这类游戏化指标
 *  - 数据为空的年份给「留白」文案，不硬凑数字
 *  - 每条都配一句人话，而不是把统计数字念一遍
 */

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

function pick(arr, i) { return arr[i % arr.length] }

const OPENERS = [
  '这一年不急着总结，先慢慢翻。',
  '有些年份是用来冲刺的，有些是用来过的。',
  '时间不声不响，但留下了痕迹。',
]

function buildReportSlides(archive, snapshot, soundtrack) {
  const s = snapshot || {}
  const y = s.year || new Date().getFullYear()
  const name = (archive && archive.profile && archive.profile.owner_name) || ''
  const yearSong = (soundtrack && soundtrack.yearTracks || []).find((t) => String(t.year) === String(y))
  const songName = yearSong && yearSong.top ? yearSong.top.name : (s.topTrack ? s.topTrack.name : '')

  // 最密的一个月（只在有数据时说，避免把「全都 0」讲成故事）
  let peakMonth = null
  if (s.months && s.months.some((n) => n > 0)) {
    let best = -1
    s.months.forEach((n, i) => { if (n > best) { best = n; peakMonth = i } })
  }

  const slides = []

  slides.push({
    no: 1,
    kicker: 'LIFE · ANNUAL · REPORT',
    title: `${y}，\n你又往前走了一年`,
    body: pick(OPENERS, y) + (name ? ` 这是${name}的这一年。` : ''),
    metric: s.hasData ? String(s.footprints + s.questsDone + s.checkins + s.newCharacters) : '',
    metricLabel: s.hasData ? '件被记下的小事' : '',
    footnote: '不打分，不排名，只记录',
    accent: 'cover',
  })

  slides.push({
    no: 2,
    kicker: 'CHAPTER 01 / 走过',
    title: s.footprints ? `你去过 ${s.places} 个地方` : '这一年，脚步很轻',
    body: s.footprints
      ? (s.countries ? `其中点亮了 ${s.countries} 个国家。` : '') +
        (s.topPlace ? `${s.topPlace.name}是你最常回到的地方，去了 ${s.topPlace.count} 次。` : '每个地方都只去了一次，也挺好。')
      : '没有留下带地点的足迹。没出门的年份，也在发生别的事。',
    metric: s.footprints ? String(s.footprints) : '',
    metricLabel: s.footprints ? '段足迹' : '',
    footnote: s.countryList && s.countryList.length ? '点亮：' + s.countryList.slice(0, 6).join(' · ') : '地点是记忆的坐标，不是成绩',
    accent: 'travel',
  })

  slides.push({
    no: 3,
    kicker: 'CHAPTER 02 / 主线',
    title: s.questsDone ? `你完成了 ${s.questsDone} 条主线` : '主线不必年年都有进展',
    body: s.questsDone
      ? `一共留下 ${s.checkins} 次打卡。有些目标达成了，有些还在路上，两种都算数。`
      : '这一年没有标记完成的主线。推进得慢，不等于没有往前。',
    metric: s.checkins ? String(s.checkins) : '',
    metricLabel: s.checkins ? '次打卡' : '',
    footnote: '休息记为资产，中断不扣分',
    accent: 'quest',
  })

  slides.push({
    no: 4,
    kicker: 'CHAPTER 03 / 同行',
    title: s.newCharacters ? `你认识了 ${s.newCharacters} 个人` : '这一年，还是那些人',
    body: s.topCompanion
      ? `${s.topCompanion.name}最常和你一起出现在足迹里，一共 ${s.topCompanion.count} 次。`
      : (s.newCharacters ? '新认识的人还没写进足迹，故事可以慢慢补。' : '没有新增的角色卡。老朋友还在，也是一种稳定。'),
    metric: s.topCompanion ? String(s.topCompanion.count) : '',
    metricLabel: s.topCompanion ? '次同行' : '',
    footnote: '关系会自然折旧，一次见面就能补回来',
    accent: 'people',
  })

  slides.push({
    no: 5,
    kicker: 'CHAPTER 04 / 原声带',
    title: songName ? `那一年，${songName}` : '这一年还没有配乐',
    body: songName
      ? (yearSong && yearSong.top && yearSong.top.count > 1
          ? `它和 ${yearSong.total} 段足迹连在一起。以后再听到，大概会想起这些地方。`
          : '它和一段足迹连在一起。地点有歌，年份就有了声音。')
      : '在足迹里记下当时在听的歌，明年的年报就会有配乐。',
    metric: songName ? '♪' : '',
    metricLabel: songName ? '这一年的 BGM' : '',
    footnote: songName ? '来自「人生原声带」' : '音乐与足迹可以关联',
    accent: 'music',
  })

  // 已读书目来自「我的书架」的真实录入（含读完日期），没记录就不出现，不硬凑
  if (s.booksReadCount) {
    const titles = (s.booksRead || []).map((b) => String(b.title || '').trim()).filter(Boolean)
    const bookLine = titles.length
      ? '书架上留着《' + titles[0] + '》' + (titles.length > 1 ? '，还有《' + titles[1] + '》等。' : '。')
      : '读完的书还没写上书名，但这一年确实翻过页。'
    slides.push({
      no: slides.length + 1,
      kicker: 'CHAPTER 05 / 读过',
      title: `这一年读完了 ${s.booksReadCount} 本书`,
      body: bookLine + '读书不是打卡，读过的都算。',
      metric: String(s.booksReadCount),
      metricLabel: '本已读',
      footnote: s.bookMinutes ? `约 ${s.bookMinutes} 分钟 · 由书架记录` : '来自「我的书架」，手动录入或 CSV 导入',
      accent: 'books',
    })
  }

  if (peakMonth != null || s.topMood) {
    slides.push({
      no: slides.length + 1,
      kicker: 'CHAPTER 06 / 节奏',
      title: peakMonth != null ? `${MONTH_NAMES[peakMonth]}最热闹` : '这一年有自己的节奏',
      body: (peakMonth != null ? `${MONTH_NAMES[peakMonth]}留下的记录最多。` : '') +
        (s.topMood ? `你最常记下的心情是「${s.topMood.name}」。` : '心情没有标注，也没有关系。'),
      metric: s.topMood ? s.topMood.name : '',
      metricLabel: s.topMood ? '最常出现的心情' : '',
      footnote: '十二个月的起伏，本来就不均匀',
      accent: 'rhythm',
    })
  }

  slides.push({
    no: slides.length + 1,
    kicker: 'THE END / 致这一年',
    title: '不必和谁比较，\n这一年是你的',
    body: s.hasData
      ? '明年不必更好，只要还是你的。想继续记就记，想歇一会儿也完全可以。'
      : '留白也是一年。等你想记的时候，这里一直都在。',
    metric: '', metricLabel: '',
    footnote: `人生主线任务 · ${y} 年报`,
    accent: 'end',
  })

  return slides
}

/** 一句克制的判断，放在年报末尾，不做评价 */
function reportVerdict(snapshot) {
  const s = snapshot || {}
  if (!s.hasData) return '这一年没有留下记录，那就什么也不推断。'
  if (s.footprints >= s.checkins && s.footprints > 0) return '这一年更像在走路，而不是在完成任务——这挺好。'
  if (s.checkins > 0 && s.footprints === 0) return '这一年主要在原地用力，也值得被记下。'
  return '记录本身已经是答案，不需要再给它打分。'
}

/** 原声带模块的叙事文案 */
function soundtrackNarrative(soundtrack) {
  const st = soundtrack || {}
  if (!st.total) return '还没有足迹。等第一段足迹配上歌，这里就会长出一张有声地图。'
  const parts = [`${st.total} 段足迹里，有 ${st.withSong} 段连着一首歌（覆盖 ${st.coverage}%）。`]
  if (st.boundCount) parts.push(`${st.boundCount} 段是当时记下的，`)
  if (st.inferredCount) parts.push(`${st.inferredCount} 段是按导入日期就近推断的（不是事实，仅作线索）。`)
  if (!st.withSong) parts.push('在足迹里记下当时在听的歌，就能让地点带上声音。')
  return parts.join('')
}

module.exports = { buildReportSlides, reportVerdict, soundtrackNarrative, MONTH_NAMES }
