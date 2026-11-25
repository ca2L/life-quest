/**
 * 内置精选曲目：无需上传、无需登录即可试听的公开演示音源。
 *
 * 音源来自 SoundHelix 官方示例 MP3（https://www.soundhelix.com/examples/mp3/），
 * 由 SoundHelix 提供，可自由用于演示与测试；此处仅作播放器示例，版权归原作者。
 *
 * 边界说明（如实告知）：
 *  - 真机正式版需要把 www.soundhelix.com 加入小程序后台「downloadFile 合法域名」；
 *    开发者工具可勾选「不校验合法域名」直接试听。
 *  - 这些是器乐演示曲，不是流行歌曲；小程序不抓取/不破解任何版权音乐平台。
 *  - 内置曲目不写入本地 storage（只存隐藏名单与改名），删除只是本机隐藏。
 */

const SOUNDHELIX = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-'

const RAW = [
  { no: 1, name: '晨光序曲', desc: '清晨 · 轻盈电子' },
  { no: 2, name: '城市漫游', desc: '通勤 · 流动节拍' },
  { no: 3, name: '午后微光', desc: '专注 · 舒缓旋律' },
  { no: 4, name: '夜航星海', desc: '深夜 · 开阔氛围' },
  { no: 5, name: '山野回声', desc: '散步 · 自然律动' },
]

module.exports = RAW.map((r) => ({
  id: 'builtin-' + String(r.no).padStart(2, '0'),
  name: r.name,
  artist: 'SoundHelix · 演示音源',
  category: '内置精选',
  tags: 'ambient,instrumental,内置精选',
  desc: r.desc,
  source: 'external',
  kind: 'audio',
  path: '',
  url: SOUNDHELIX + r.no + '.mp3',
  size: 0,
  addedAt: '内置',
  builtin: true,
}))
