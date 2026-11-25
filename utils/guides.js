// 首页「人生书架」开源指南入口。
// star / description 均为 2026-11-25 通过 GitHub REST API 抓取的快照，仅用于展示，不做实时请求。
// 小程序个人主体不支持 web-view 打开外部网页，因此入口交互为「查看详情 + 复制链接」。

const GUIDES = [
  {
    id: 'live',
    icon: '🌱',
    title: '人生指南',
    subtitle: 'HowToLiveBetter',
    repo: 'eternity4719/HowToLiveBetter',
    url: 'https://github.com/eternity4719/HowToLiveBetter',
    stars: '7.7万',
    starsExact: '77,454',
    lang: 'HTML',
    tag: '生活决策',
    brief: '长寿防病、理财、法律红线…每条都标成本与证据等级',
    fullDesc: '高性价比人生指南：长寿防病、急救、省钱理财、法律红线、失业与工伤、医保社保、恋爱婚育、怀孕育儿、创业与做平台合规、出国与技能。每条写明成本、收益、证据等级和原始出处，只引期刊论文与官方文件。',
    tip: '建议先看「证据等级」——作者只引用期刊论文与官方文件，不夹带个人经验。',
  },
  {
    id: 'cook',
    icon: '🍳',
    title: '做饭指南',
    subtitle: 'HowToCook',
    repo: 'Anduin2017/HowToCook',
    url: 'https://github.com/Anduin2017/HowToCook',
    stars: '10.4万',
    starsExact: '104,255',
    lang: 'Markdown',
    tag: '日常烟火',
    brief: '程序员写的在家做饭指南，从买菜到菜谱照着做',
    fullDesc: "Programmer's guide about how to cook at home. 用工程化的思路把「在家做饭」拆成可执行的步骤：厨具与调料清单、买菜与备菜、家常菜谱，以及大量可直接照做的实操说明。",
    tip: 'README 按食材与场景分类，适合直接翻到想吃的那道菜照着做。',
  },
  {
    id: 'skill',
    icon: '🛠️',
    title: '技能指南',
    subtitle: 'cs-self-learning',
    repo: 'PKUFlyingPig/cs-self-learning',
    url: 'https://github.com/PKUFlyingPig/cs-self-learning',
    home: 'https://csdiy.wiki',
    stars: '7.7万',
    starsExact: '76,854',
    lang: 'HTML',
    tag: '技能成长',
    brief: '把名校公开课与教材排成一条可执行的自学路径',
    fullDesc: '计算机自学指南（CS 自学指南 / csdiy.wiki）：把国内外名校公开课、经典教材与实践项目按主题排成学习路径，讲清楚每门课学什么、学多久、怎么验收，覆盖数学基础、编程、系统、算法与方向进阶。',
    tip: '配套站点 csdiy.wiki 可直接在线阅读，比翻仓库 README 更顺手。',
    note: 'GitHub 检索结论：没有精确名为「技能指南」的标杆仓库，选取了中文社区最贴近「技能学习路径」的高星项目；如需换成交互式技能路线图（nilbuild/developer-roadmap，37.3万★）可随时替换。',
  },
]

module.exports = { GUIDES }
