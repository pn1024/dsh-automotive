import { matchesRegion, policiesInWindow } from './store.js?v=20261124g'
import { clausesOf } from './clauses.js?v=20261124g'

/**
 * 每个品牌的关注点不同：出口导向的看贸易，纯电看购置税与充电，
 * 智驾标签的看智能网联。权重是研究口径的先验，写在明面上，可版本化调整。
 */
export const BRAND_PROFILES = {
  奇瑞: {
    note: '出口占比高、A0/A 级走量，最吃出口规则与购置税门槛',
    topics: [
      ['出口', 3.0, '出口规则直接改毛利'],
      ['购置税', 3.0, 'A0/A 级主销价格带对税负最敏感'],
      ['退坡', 2.4, '退坡时抢装与次年空窗'],
      ['以旧换新', 2.2, '置换是走量主入口'],
      ['置换', 2.0, '常与补贴并列'],
      ['下乡', 2.0, '县域渠道与低价车型匹配'],
      ['A0', 2.0, '直接点名价格带'],
      ['补贴', 2.0, '购置端直接降价'],
      ['价格', 1.2, '价格战表述'],
      ['智能网联', 1.0, '配置竞赛，非主战场']
    ]
  },
  比亚迪: {
    note: '规模与垂直一体化，价格战与出口双向敏感',
    topics: [
      ['补贴', 2.6, '走量车型直接受益'],
      ['购置税', 2.4, '价格带覆盖广'],
      ['价格', 2.4, '价格战主导者也是承压方'],
      ['出口', 2.2, '海外扩张是增量来源'],
      ['双积分', 1.8, '积分富余方，规则变化影响变现'],
      ['智能网联', 1.2, '智能化补课'],
      ['充电', 1.2, '配套影响下沉市场']
    ]
  },
  吉利: {
    note: '多品牌矩阵，主流价格带与置换政策相关',
    topics: [
      ['以旧换新', 2.4, '置换需求'],
      ['补贴', 2.2, '主流价格带'],
      ['购置税', 2.2, '税负敏感'],
      ['出口', 1.8, '海外渠道扩张'],
      ['智能网联', 1.6, '银河/极氪智驾'],
      ['标准', 1.2, '合规成本']
    ]
  },
  长安: {
    note: '自主与合资并行，下乡与置换受益明显',
    topics: [
      ['以旧换新', 2.4, '置换'],
      ['补贴', 2.2, '主流价格带'],
      ['下乡', 2.0, '县域渠道'],
      ['购置税', 2.0, '税负'],
      ['智能网联', 1.4, '深蓝/阿维塔']
    ]
  },
  上汽: {
    note: '合资承压，出口与海外基地是主要变量',
    topics: [
      ['出口', 2.4, '海外销量占比高'],
      ['双积分', 2.0, '合资燃油占比高'],
      ['补贴', 1.8, '自主品牌走量'],
      ['购置税', 1.8, '税负'],
      ['标准', 1.4, '合规']
    ]
  },
  长城: {
    note: '皮卡与 SUV 出口导向，海外市场是主战场',
    topics: [
      ['出口', 2.6, '海外收入占比高'],
      ['补贴', 1.8, '国内走量'],
      ['下乡', 1.8, '县域与皮卡场景'],
      ['标准', 1.6, '合规与认证'],
      ['购置税', 1.8, '税负']
    ]
  },
  特斯拉: {
    note: '纯电单一品牌，购置税与价格政策最敏感',
    topics: [
      ['购置税', 3.0, '单车税负占比高'],
      ['补贴', 2.0, '购置端'],
      ['价格', 2.4, '频繁调价'],
      ['智能网联', 2.2, 'FSD/智驾合规'],
      ['充电', 1.8, '超充网络']
    ]
  },
  理想: {
    note: '增程与纯电并行，家庭场景，税负与智驾',
    topics: [
      ['购置税', 2.8, '高价车型税负敏感'],
      ['智能网联', 2.2, '智驾与座舱'],
      ['充电', 1.6, '纯电车型补能'],
      ['补贴', 1.6, '购置端'],
      ['价格', 1.8, '价格带']
    ]
  },
  小鹏: {
    note: '智驾标签，智能网联与数据合规影响大',
    topics: [
      ['智能网联', 2.8, '智驾是核心卖点'],
      ['购置税', 2.4, '税负'],
      ['充电', 1.6, '补能网络'],
      ['价格', 1.8, '价格带'],
      ['补贴', 1.4, '购置端']
    ]
  },
  蔚来: {
    note: '换电模式，基建与换电政策直接决定成本',
    topics: [
      ['换电', 3.0, '换电模式依赖政策与基建'],
      ['充电', 2.0, '补能网络'],
      ['购置税', 2.4, '税负'],
      ['智能网联', 2.0, '智驾'],
      ['价格', 1.6, '价格带']
    ]
  },
  零跑: {
    note: '性价比路线，价格与补贴弹性最大',
    topics: [
      ['价格', 2.6, '性价比定位'],
      ['补贴', 2.0, '购置端'],
      ['购置税', 2.0, '税负'],
      ['下乡', 1.6, '县域'],
      ['智能网联', 1.4, '配置']
    ]
  },
  小米: {
    note: '生态与流量驱动，智驾与价格并重',
    topics: [
      ['智能网联', 2.6, '智驾与生态'],
      ['价格', 2.2, '价格带'],
      ['购置税', 2.0, '税负'],
      ['补贴', 1.6, '购置端'],
      ['充电', 1.4, '补能']
    ]
  }
}

export const BRANDS = Object.keys(BRAND_PROFILES)

const DEFAULT_PROFILE = {
  note: '通用口径：购置端与标准类政策为主',
  topics: [
    ['补贴', 2.0, '购置端'],
    ['购置税', 2.0, '税负'],
    ['以旧换新', 1.8, '置换'],
    ['标准', 1.4, '合规'],
    ['智能网联', 1.4, '配置']
  ]
}

const LEVEL_FACTOR = { 0: 0.8, 1: 1.0, 2: 0.55, 3: 0.3 }

export function profileOf(brand) {
  return BRAND_PROFILES[brand] ?? DEFAULT_PROFILE
}

/**
 * 品牌专项：月度零售序列、当月位置、政策暴露与最相关条款。
 * 序列优先取 sales.json 的 brandMonthly；奇瑞额外带出口量。
 */
export function buildBrand(library, month, region, brandName = '奇瑞') {
  const brand = BRAND_PROFILES[brandName] ? brandName : brandName || '奇瑞'
  const profile = profileOf(brand)

  const monthly = library.brandMonthly?.[brand] ?? []
  const months = monthly
    .filter((row) => row.month <= month)
    .slice(-12)
    .map((row) => {
      const row0 = row
      const entry = library.monthly.find((item) => item.month === row0.month)
      const national = entry?.national?.total ?? 0
      const exportVolume = brand === '奇瑞' ? entry?.chery?.export ?? null : null
      const brandRow = (library.brands?.[row0.month] ?? []).find((item) => item.brand === brand)
      const yoy = brandRow ? brandRow.yoy ?? null : brand === '奇瑞' ? entry?.chery?.yoy ?? null : null
      return {
        month: row0.month,
        retail: row0.retail,
        yoy,
        export: exportVolume,
        share: national ? Math.round((row0.retail / national) * 1000) / 10 : null,
        exportShare: exportVolume && row0.retail ? Math.round((exportVolume / row0.retail) * 1000) / 10 : null
      }
    })

  const latest = months.length > 0 ? months[months.length - 1] : null
  const first = months.length > 0 ? months[0] : null

  const inMonth = policiesInWindow(library, { month }).filter(
    (policy) => Number(policy.level) <= 1 || !region || matchesRegion(policy, region)
  )

  let raw = 0
  const hits = new Map()
  const policyHits = []

  for (const policy of inMonth) {
    const haystack = [policy.title, policy.summary, policy.content, ...(policy.clauses ?? []).map((clause) => clause.text)]
      .filter(Boolean)
      .join(' ')

    const matched = []
    for (const [key, weight, note] of profile.topics) {
      const count = haystack.split(key).length - 1
      if (count === 0) continue
      matched.push({ key, weight, count })
      const bucket = hits.get(key) ?? { key, weight, count: 0, note }
      bucket.count += count
      hits.set(key, bucket)
    }
    if (matched.length === 0) continue

    const weight = matched.reduce((sum, item) => sum + item.weight, 0)
    const score = weight * (LEVEL_FACTOR[policy.level] ?? 0.4)
    raw += score
    policyHits.push({
      id: policy.id,
      title: policy.title,
      issuer: policy.issuer,
      publishDate: policy.publishDate,
      sourceUrl: policy.sourceUrl,
      score: Math.round(score * 10) / 10,
      topics: matched.map((item) => item.key),
      clause: clausesOf(policy, 3)
        .map((clause) => ({ no: clause.no, text: clause.text, impact: clause.impact ?? null }))
        .sort((a, b) => (b.impact?.magnitude ?? 0) - (a.impact?.magnitude ?? 0))[0] ?? null
    })
  }

  policyHits.sort((a, b) => b.score - a.score)

  return {
    brand,
    profileNote: profile.note,
    months,
    hasSeries: months.length > 1,
    latest,
    // 奇瑞另有官网公告口径（集团销量/出口），与国内上险口径并列展示，不混算。
    official: brand === '奇瑞' ? library.cheryOfficial?.[month] ?? null : null,
    change: latest && first ? Math.round((latest.retail - first.retail) * 10) / 10 : null,
    policies: policyHits.slice(0, 4),
    sensitivity: {
      score: Math.round(100 * (1 - Math.exp(-raw / 10)) * 10) / 10,
      raw: Math.round(raw * 10) / 10,
      hits: [...hits.values()].sort((a, b) => b.weight * b.count - a.weight * a.count).slice(0, 5),
      note: `按「${profile.topics.map(([key]) => key).slice(0, 6).join('/')}」等关注点加权，层级系数折减；分数越高，当月政策对该品牌的边际影响越大。`
    },
    hitCount: policyHits.length
  }
}