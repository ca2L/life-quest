// 数据访问层：基于 createTableAccess 封装三张表，页面只调用这些方法。
// owner 归属由服务端 DEFAULT auth.uid() 与 RLS 决定，前端不传 owner_id。
const { cloud } = require('./cloud')
const { createTableAccess } = require('./workbuddy-data-access')
const { rollReward } = require('./gamification')

const profileAccess = createTableAccess(cloud, {
  table: 'player_profile',
  columns: ['id', 'birthday', 'target_age', 'level', 'xp', 'title', 'owner_name'],
  toRow(row) {
    const out = {}
    if ('birthday' in row) out.birthday = row.birthday
    if ('target_age' in row) out.target_age = row.target_age
    if ('level' in row) out.level = row.level
    if ('xp' in row) out.xp = row.xp
    if ('title' in row) out.title = row.title
    if ('owner_name' in row) out.owner_name = row.owner_name
    return out
  },
})

const questAccess = createTableAccess(cloud, {
  table: 'quests',
  columns: ['id', 'quest_type', 'chapter', 'title', 'description', 'xp_reward', 'status', 'progress', 'target', 'due_date', 'created_at'],
  toRow(row) {
    const out = {}
    const fields = ['quest_type', 'chapter', 'title', 'description', 'xp_reward', 'status', 'progress', 'target', 'due_date']
    fields.forEach((key) => {
      if (key in row) out[key] = row[key]
    })
    return out
  },
  orderBy: { column: 'created_at', ascending: false },
})

const checkinAccess = createTableAccess(cloud, {
  table: 'checkins',
  columns: ['id', 'quest_id', 'checkin_date', 'note', 'created_at'],
  toRow(row) {
    const out = {}
    if ('quest_id' in row) out.quest_id = row.quest_id
    if ('checkin_date' in row) out.checkin_date = row.checkin_date
    if ('note' in row) out.note = row.note
    return out
  },
  orderBy: { column: 'created_at', ascending: false },
})

// 足迹的国家不写云端表列（避免未执行 SQL 的老表 insert 失败），
// 而是按记录 id 存本地映射，list 时再合并回来；坐标识别仍作为兜底。
const FOOTPRINT_COUNTRY_KEY = 'footprintCountries'

function readCountryMap() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const v = wx.getStorageSync(FOOTPRINT_COUNTRY_KEY)
      return v && typeof v === 'object' ? v : {}
    }
  } catch (e) { /* storage 不可用时当作空映射 */ }
  return {}
}

function writeCountryMap(map) {
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(FOOTPRINT_COUNTRY_KEY, map)
    }
  } catch (e) { /* 忽略写入失败，country 会回落到坐标识别 */ }
}

const footprintBase = createTableAccess(cloud, {
  table: 'footprints',
  columns: ['id', 'occurred_at', 'title', 'scene', 'people', 'location_name', 'latitude', 'longitude', 'mood', 'images', 'quest_id', 'chapter', 'category', 'created_at'],
  toRow(row) {
    const out = {}
    const fields = ['occurred_at', 'title', 'scene', 'people', 'location_name', 'latitude', 'longitude', 'mood', 'images', 'quest_id', 'chapter', 'category']
    fields.forEach((key) => {
      if (key in row) out[key] = row[key]
    })
    return out
  },
  orderBy: { column: 'occurred_at', ascending: false },
})

const footprintAccess = {
  list() {
    return footprintBase.list().then((res) => {
      if (res && !res.error && Array.isArray(res.data)) {
        const map = readCountryMap()
        res.data = res.data.map((r) => Object.assign({}, r, {
          country: r.country || map[r.id] || '',
        }))
      }
      return res
    })
  },
  create(payload) {
    const country = payload && payload.country ? String(payload.country) : ''
    return footprintBase.create(payload).then((res) => {
      if (country && res && !res.error && res.data && res.data.id != null) {
        const map = readCountryMap()
        map[res.data.id] = country
        writeCountryMap(map)
      }
      return res
    })
  },
  update(id, payload) {
    const country = payload && payload.country != null ? String(payload.country) : null
    return footprintBase.update(id, payload).then((res) => {
      if (country != null && res && !res.error) {
        const map = readCountryMap()
        if (country) map[id] = country
        else delete map[id]
        writeCountryMap(map)
      }
      return res
    })
  },
  remove(id) {
    return footprintBase.remove(id).then((res) => {
      if (res && !res.error) {
        const map = readCountryMap()
        delete map[id]
        writeCountryMap(map)
      }
      return res
    })
  },
}

const characterAccess = createTableAccess(cloud, {
  table: 'characters',
  columns: ['id', 'name', 'avatar', 'relation', 'color', 'met_date', 'story', 'avatar_url', 'intimacy', 'meet_count', 'created_at'],
  fromRow(row) {
    return {
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      relation: row.relation,
      color: row.color,
      metDate: row.met_date,
      story: row.story,
      avatarUrl: row.avatar_url,
      intimacy: row.intimacy,
      meetCount: row.meet_count,
      createdAt: row.created_at,
    }
  },
  toRow(row) {
    const out = {}
    if ('name' in row) out.name = row.name
    if ('avatar' in row) out.avatar = row.avatar
    if ('relation' in row) out.relation = row.relation
    if ('color' in row) out.color = row.color
    if ('metDate' in row) out.met_date = row.metDate
    if ('met_date' in row) out.met_date = row.met_date
    if ('story' in row) out.story = row.story
    if ('avatarUrl' in row) out.avatar_url = row.avatarUrl
    if ('avatar_url' in row) out.avatar_url = row.avatar_url
    if ('intimacy' in row) out.intimacy = row.intimacy
    if ('meetCount' in row) out.meet_count = row.meetCount
    if ('meet_count' in row) out.meet_count = row.meet_count
    return out
  },
  orderBy: { column: 'created_at', ascending: true },
})

// 等级阈值：每级所需累计 XP。等级由累计 XP 推导，避免前端手填。
const LEVEL_TITLES = [
  '见习冒险者', '新手旅人', '进阶行者', '资深探索者',
  '人生赢家', '传奇勇者', '传说主宰', '不朽传说',
]

function levelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp) || 0)
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1
  const title = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)]
  const currentLevelBase = Math.pow(level - 1, 2) * 100
  const nextLevelBase = Math.pow(level, 2) * 100
  return {
    level,
    title,
    xp: safeXp,
    currentLevelXp: safeXp - currentLevelBase,
    nextLevelXp: nextLevelBase - currentLevelBase,
    progressPercent: Math.min(100, Math.round(((safeXp - currentLevelBase) / (nextLevelBase - currentLevelBase)) * 100)),
  }
}

function todayStr() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 领取任务奖励（含暴击），返回新旧等级用于展示升级反馈。
async function claimReward(baseXp) {
  const reward = rollReward(baseXp)
  const res = await profileAccess.list()
  const profile = (res.data && res.data[0]) || null
  if (!profile) return { error: null, reward, leveledUp: false, profile: null }
  const oldLevel = levelFromXp(profile.xp || 0).level
  const newXp = (profile.xp || 0) + reward.xp
  const levelInfo = levelFromXp(newXp)
  const update = await profileAccess.update(profile.id, {
    xp: newXp,
    level: levelInfo.level,
    title: levelInfo.title,
  })
  if (update.error) return { error: update.error, reward, leveledUp: false, profile: null }
  return {
    error: null,
    reward,
    leveledUp: levelInfo.level > oldLevel,
    newLevel: levelInfo.level,
    profile,
  }
}

// 统一的打卡动作：更新进度 + 写打卡记录 + 完成时发放奖励。
async function checkInQuest(quest) {
  if (!quest) return { error: { message: '任务不存在' } }
  const target = Math.max(1, Number(quest.target) || 1)
  const nextProgress = Math.min(target, (quest.progress || 0) + 1)
  const isDone = nextProgress >= target
  const updated = await questAccess.update(quest.id, {
    progress: nextProgress,
    status: isDone ? 'done' : 'active',
  })
  if (updated.error) return { error: updated.error }

  const recorded = await checkinAccess.create({
    quest_id: quest.id,
    checkin_date: todayStr(),
    note: '',
  })
  const recordError = recorded && recorded.error

  let claim = null
  if (isDone && quest.status !== 'done') {
    claim = await claimReward(quest.xp_reward)
  }
  return {
    error: recordError || (claim && claim.error) || null,
    isDone,
    justCompleted: isDone && quest.status !== 'done',
    claim,
  }
}

module.exports = {
  cloud,
  profileAccess,
  questAccess,
  checkinAccess,
  footprintAccess,
  characterAccess,
  levelFromXp,
  todayStr,
  claimReward,
  checkInQuest,
}
