/**
 * 内置精选曲目：无需上传、无需登录即可试听的公开演示音源。
 *
 * 音源来自 SoundHelix 官方示例 MP3（https://www.soundhelix.com/examples/mp3/），
 * 由 SoundHelix 提供，可自由用于演示与测试；此处仅作播放器示例，版权归原作者。
 *
 * ── 合规边界（务必如实告知）────────────────────────────────
 * 1. 真机正式版需要把 www.soundhelix.com 加入小程序后台「downloadFile 合法域名」；
 *    开发者工具可勾选「不校验合法域名」直接试听。
 * 2. 这些是器乐演示曲，不是流行歌曲，也不是任何游戏的官方原声。
 *    「塞尔达」条目是「海拉鲁风格管弦致敬示范」，「主机 BGM」条目是
 *    复古/管弦/街机/钢琴/尾章等常见配乐语汇的风格化示范，与任天堂、
 *    Sony、Microsoft 及任何游戏 IP 无关；官方音乐请到 Nintendo Music
 *    等正规渠道收听。
 * 3. 想要真正的乡村 / 游戏 BGM：配置 utils/free-library.js 的 Jamendo client_id
 *    拉取 CC 授权曲目，或在音乐面板导入自己有权使用的音源。
 * 4. 内置曲目不写入本地 storage（只存隐藏名单与改名），删除只是本机隐藏。
 */

const SOUNDHELIX = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'

// category / tags 决定每日推荐的场景匹配；新增曲目请沿用同样的键名。
const RAW = [
  { no: 1, name: '晨光序曲', desc: '清晨 · 轻盈电子', category: '内置精选', tags: 'ambient,electronic,内置精选' },
  { no: 2, name: '城市漫游', desc: '通勤 · 流动节拍', category: '内置精选', tags: 'electronic,commute,内置精选' },
  { no: 3, name: '午后微光', desc: '专注 · 舒缓旋律', category: '内置精选', tags: 'ambient,electronic,内置精选' },
  { no: 4, name: '夜航星海', desc: '深夜 · 开阔氛围', category: '内置精选', tags: 'ambient,calm,内置精选' },
  { no: 5, name: '山野回声', desc: '散步 · 自然律动', category: '内置精选', tags: 'ambient,folk,内置精选' },

  // 乡村音乐曲库（示范音源；真实 CC 乡村曲目走 Jamendo）
  { no: 6, name: '乡村公路', desc: '公路 · 旷野气息', category: '乡村曲库', tags: 'country,乡村,folk,americana,内置精选' },
  { no: 7, name: '谷仓晨曲', desc: '清晨 · 田园慢拍', category: '乡村曲库', tags: 'country,乡村,acoustic,内置精选' },

  // 主机游戏 BGM（示范音源；非任何游戏官方原声）
  { no: 8, name: '像素开场', desc: '游戏 · 开场主题', category: '游戏 BGM', tags: 'game,ost,chiptune,游戏bgm,内置精选' },
  { no: 9, name: 'Boss 战前夜', desc: '游戏 · 紧张节拍', category: '游戏 BGM', tags: 'game,ost,electronic,游戏bgm,内置精选' },
  { no: 10, name: '存档点', desc: '游戏 · 休整时刻', category: '游戏 BGM', tags: 'game,ost,ambient,游戏bgm,内置精选' },

  // 塞尔达风格致敬（管弦氛围示范，与任天堂无关）
  { no: 11, name: '海拉鲁风起', desc: '管弦 · 开阔冒险（风格致敬示范）', category: '塞尔达致敬', tags: 'zelda,hyrule,orchestral,塞尔达,内置精选' },
  { no: 12, name: '大师剑之光', desc: '管弦 · 史诗旋律（风格致敬示范）', category: '塞尔达致敬', tags: 'zelda,hyrule,epic,塞尔达,内置精选' },

  // 各类主机游戏 BGM（风格化示范音源，非任何游戏/平台官方原声）
  // 覆盖 chiptune / 管弦史诗 / 街机电子 / 治愈钢琴 / 尾章氛围五种常见主机配乐语汇。
  { no: 13, name: '像素序曲', desc: '8-bit · 开机主题（复古主机风格）', category: '主机 BGM', tags: 'game,ost,chiptune,游戏bgm,主机,retro,内置精选' },
  { no: 14, name: '史诗战场', desc: '管弦 · 大战前奏（日式 RPG 风格）', category: '主机 BGM', tags: 'game,ost,orchestral,epic,游戏bgm,主机,jrpg,内置精选' },
  { no: 15, name: '街机回路', desc: '电子 · 高速关卡（街机风格）', category: '主机 BGM', tags: 'game,ost,electronic,arcade,游戏bgm,主机,内置精选' },
  { no: 16, name: '掌机漫步', desc: '钢琴 · 小镇休整（治愈系风格）', category: '主机 BGM', tags: 'game,ost,piano,calm,游戏bgm,主机,内置精选' },
  { no: 17, name: '终章存档', desc: '氛围 · 通关之后（尾章风格）', category: '主机 BGM', tags: 'game,ost,ambient,游戏bgm,主机,ending,内置精选' },
]

module.exports = RAW.map((r) => ({
  id: 'builtin-' + String(r.no).padStart(2, '0'),
  name: r.name,
  artist: 'SoundHelix · 演示音源',
  category: r.category || '内置精选',
  tags: r.tags || 'ambient,instrumental,内置精选',
  desc: r.desc,
  source: 'external',
  kind: 'audio',
  path: '',
  url: SOUNDHELIX + r.no + '.mp3',
  size: 0,
  addedAt: '内置',
  builtin: true,
}))
