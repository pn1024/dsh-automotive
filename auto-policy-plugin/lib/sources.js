/**
 * 指标来源登记表。
 *
 * 每个数字都要能回答三件事：怎么算的、原始数据在哪、现在是不是真数据。
 * 面板据此把「来源 ↗」做成可点跳转；status 决定标签颜色：
 *   live      —— 官方/接口实时抓取
 *   mixed     —— 同一指标里既有真实也有示例
 *   seed      —— 示例种子，尚未接采集器
 *   derived   —— 由上面几项计算得出（公式随标签一起给出）
 *   assumption—— 研究先验，没有外部数据源
 */
export const STATUS_LABEL = {
  live: '官方数据',
  mixed: '混合数据',
  seed: '示例数据',
  derived: '计算得出',
  assumption: '研究先验'
}

const SALES = 'https://www.dongchedi.com/sales'
const GOV = 'https://sousuo.www.gov.cn/'
const HUNAN = 'https://www.hunan.gov.cn/hnszf/xxgk/wjk/'
const EASTMONEY = 'https://quote.eastmoney.com/'

export function quoteUrl(secid, code) {
  const [market, id] = String(secid || '').split('.')
  if (market === '1') return `${EASTMONEY}sh${id || code}.html`
  if (market === '0') return `${EASTMONEY}sz${id || code}.html`
  if (market === '116') return `${EASTMONEY}hk${id || code}.html`
  return EASTMONEY
}

/** 生成本期来源表：既描述口径，也带上可点击的权威页面。 */
export function buildSources(library, { month, region, counts, brand } = {}) {
  const salesMode = library.salesMeta?.mode ?? 'seed'
  const hunanMode = library.salesMeta?.hunanMode ?? 'seed'
  const liveCount = counts?.live ?? 0
  const seedCount = counts?.seed ?? 0
  const brandName = brand || '奇瑞'
  const salesSource = library.salesMeta?.source ?? '公开销量榜'

  // 全国/品牌已接真实榜，湖南仍无公开分省来源 → 该指标记为“混合”
  const salesStatus = salesMode === 'live' ? (hunanMode === 'live' ? 'live' : 'mixed') : 'seed'

  const policyStatus = liveCount > 0 && seedCount > 0 ? 'mixed' : liveCount > 0 ? 'live' : 'seed'

  return {
    policies: {
      label: '本期政策条数',
      status: policyStatus,
      value: `${liveCount} 条有官方原文的政策`,
      formula: '按 publishDate 落在本月窗口内的条目计数；层级按 level 字段分组',
      source: '国务院政策文件库（sousuo.www.gov.cn）＋ 湖南省政府政策文件库',
      url: region ? HUNAN : GOV,
      altUrl: GOV,
      asOf: library.meta?.updatedAt ?? ''
    },
    psi: {
      label: '政策强度指数 PSI',
      status: 'derived',
      formula: '100 × (1 − e^(−Σ(工具权重 × 层级系数 × 新鲜度) / 18))，新鲜度按 90 天半衰',
      source: '由本期政策条目计算（权重与系数见指标字典）',
      url: GOV,
      asOf: `${month}-28`
    },
    nev: {
      label: 'NEV 渗透率',
      status: salesStatus,
      formula: '新能源乘用车零售 ÷ 乘用车零售',
      source: salesSource,
      url: SALES,
      asOf: month
    },
    brands: {
      label: '品牌份额',
      status: salesMode === 'live' ? 'live' : 'seed',
      formula: '品牌零售 ÷ 全国乘用车零售',
      source: salesSource,
      url: SALES,
      asOf: month
    },
    cr5: {
      label: '品牌集中度 CR5',
      status: 'derived',
      formula: '前五品牌份额之和',
      source: '由品牌份额计算',
      url: SALES,
      asOf: month
    },
    brand: {
      label: `${brandName} 零售 / 份额`,
      status: salesMode === 'live' ? 'live' : 'seed',
      formula: '品牌零售 ÷ 全国乘用车零售；无出口与同比来源时不展示',
      source: salesSource,
      url: SALES,
      asOf: month
    },
    sensitivity: {
      label: '文本相关度（非因果）',
      status: 'derived',
      formula: 'Σ(命中关注点权重 × 层级系数) 经 100×(1−e^(−x/10)) 归一化',
      source: '关注点权重为研究先验（出口 3.0、购置税 3.0、退坡 2.4…），待回归标定',
      url: GOV,
      asOf: month
    },
    hunan: {
      label: '湖南销量 / 渗透率',
      status: hunanMode === 'live' ? 'live' : 'seed',
      formula: '湖南乘用车零售与新能源零售；渗透率 = 新能源 ÷ 乘用车',
      source: hunanMode === 'live' ? '省级上险/零售数据（导入）' : '示例数据：公开榜单接口不提供分省销量',
      url: SALES,
      asOf: month
    },
    market: {
      label: '上市公司行情',
      status: 'live',
      formula: '现价、涨跌幅、总市值、PE(TTM) 直接取接口字段；迷你图为近 20 个交易日收盘',
      source: '东方财富公开行情接口（push2 / push2his）',
      url: EASTMONEY,
      asOf: '实时（缓存 10 分钟）'
    },
    chain: {
      label: '政策—产业传导链',
      status: 'assumption',
      formula: '工具 → 中介变量 → 结果，弹性系数为文献区间',
      source: '文献与历史回归的先验区间，尚未用本库数据标定',
      url: '',
      asOf: ''
    }
  }
}