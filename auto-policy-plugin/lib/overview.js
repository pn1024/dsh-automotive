import { buildAnalysis } from './analyze.js?v=20261124g'
import { levelMix, policyStrengthIndex, toolMix } from './indicators.js?v=20261124g'
import { buildPolicyFinanceLinkage } from './linkage.js?v=20261124g'
import { buildSources } from './sources.js?v=20261124g'
import { latestMonth, matchesRegion, policiesInWindow, shiftMonth } from './store.js?v=20261124g'

const LEVEL_NAMES = { 0: '国际', 1: '国家', 2: '省级', 3: '市级' }

/** 可渲染的月份，升序。 */
export function availableMonths(library) {
  const months = new Set(library.monthly.map((entry) => entry.month))
  for (const policy of library.policies) months.add(String(policy.publishDate).slice(0, 7))
  return [...months].filter((month) => /^\d{4}-\d{2}$/.test(month)).sort()
}

function salesPoint(entry) {
  if (!entry) return null
  const pick = (scope) => {
    const bucket = entry[scope]
    if (!bucket || !bucket.total) return null
    return {
      total: bucket.total,
      nev: bucket.nev,
      share: Math.round((bucket.nev / bucket.total) * 1000) / 10,
      yoyNev: bucket.yoyNev ?? null
    }
  }
  return { month: entry.month, national: pick('national'), hunan: pick('hunan') }
}

/** 区域画像：只算该地区（省 + 其下市州）的政策，让湖南视图与全国视图真正不同。 */
function buildRegionStats(library, month, region) {
  if (!region) return null
  const scoped = policiesInWindow(library, { month }).filter((policy) => matchesRegion(policy, region))
  if (scoped.length === 0) return null
  const label = scoped[0]?.regionName ?? String(region)

  const series = []
  for (let offset = 5; offset >= 0; offset -= 1) {
    const windowMonth = shiftMonth(month, -offset)
    const slice = policiesInWindow(library, { month: windowMonth }).filter((policy) => matchesRegion(policy, region))
    series.push({
      month: windowMonth,
      psi: policyStrengthIndex(slice, { asOf: `${windowMonth}-28` }).value,
      count: slice.length
    })
  }

  const byIssuer = new Map()
  for (const policy of scoped) {
    const key = policy.issuer ?? '未标注'
    byIssuer.set(key, (byIssuer.get(key) ?? 0) + 1)
  }
  const byCity = new Map()
  for (const policy of scoped.filter((item) => Number(item.level) === 3)) {
    const key = policy.regionName ?? '未标注'
    byCity.set(key, (byCity.get(key) ?? 0) + 1)
  }

  return {
    label,
    policyIds: scoped.map((policy) => policy.id),
    count: scoped.length,
    live: scoped.filter((policy) => policy.sourceUrl).length,
    psi: policyStrengthIndex(scoped, { asOf: `${month}-28` }).value,
    series,
    levelMix: levelMix(scoped),
    toolMix: toolMix(scoped).slice(0, 5),
    issuers: [...byIssuer.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4),
    cities: [...byCity.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5)
  }
}

/**
 * 面板载荷：当月分析（含品牌专项）+ 图表序列 + 区域画像 + 来源表。
 * month 缺省回落到有销量数据的最新月份；region 与 brand 都会改变结果。
 */
export function buildOverview(library, { month, region, brand } = {}) {
  const months = availableMonths(library)

  // 有政策证据的月份：面板默认停在这里，而不是最新销量月。
  // 区域视图只统计该区域的政策，否则湖南会落在“全国有政策、湖南没有”的空月份。
  const scopePolicies = region ? library.policies.filter((policy) => matchesRegion(policy, region)) : library.policies
  const policyMonths = [
    ...new Set(
      scopePolicies.map((policy) => String(policy.publishDate ?? '').slice(0, 7))
    )
  ]
    .filter((value) => /^\d{4}-\d{2}$/.test(value))
    .sort()
  const latestPolicyMonth = policyMonths.length > 0 ? policyMonths[policyMonths.length - 1] : ''

  // 默认月份优先选「政策与销量都有」的最近月份：
  // 政策月通常比销量月新一个月，直接取政策月会让渗透率和品牌图变空。
  const salesMonthsSet = new Set((library.monthly ?? []).map((entry) => entry.month))
  const policyMonthsWithSales = policyMonths.filter((value) => salesMonthsSet.has(value))
  const fallback =
    (policyMonthsWithSales.length > 0 ? policyMonthsWithSales[policyMonthsWithSales.length - 1] : '') ||
    latestPolicyMonth ||
    (region ? '' : latestMonth(library)) ||
    months[months.length - 1]
  const target = month && months.includes(month) ? month : fallback || months[months.length - 1]
  const activeBrand = brand && brand.length > 0 ? brand : '奇瑞'

  const analysis = buildAnalysis(library, { month: target, region, topN: 5, brand: activeBrand })

  const inScope = (policy) => !region || matchesRegion(policy, region)

  const psiSeries = []
  for (let offset = 5; offset >= 0; offset -= 1) {
    const windowMonth = shiftMonth(target, -offset)
    const slice = policiesInWindow(library, { month: windowMonth }).filter(inScope)
    psiSeries.push({
      month: windowMonth,
      psi: policyStrengthIndex(slice, { asOf: `${windowMonth}-28` }).value,
      count: slice.length
    })
  }

  const salesSeries = library.monthly
    .map((entry) => entry.month)
    .filter((entry) => entry <= target)
    .slice(-12)
    .map((entryMonth) => salesPoint(library.monthly.find((item) => item.month === entryMonth)))

  const liveMonths = [
    ...new Set(
      library.policies
        .filter((policy) => typeof policy.sourceUrl === 'string' && policy.sourceUrl.length > 0)
        .map((policy) => String(policy.publishDate).slice(0, 7))
    )
  ]
    .filter((month) => /^\d{4}-\d{2}$/.test(month))
    .sort()

  return {
    ok: true,
    month: target,
    region: region ?? '',
    regionStats: buildRegionStats(library, target, region),
    brand: analysis.brand,
    brands: analysis.brandOptions,
    months,
    policyMonths,
    latestPolicyMonth,
    liveMonths,
    latestLiveMonth: liveMonths.length > 0 ? liveMonths[liveMonths.length - 1] : '',
    dataset: {
      name: library.meta.name ?? '未命名数据集',
      mode: library.meta.mode ?? 'unknown',
      note: library.meta.note ?? '',
      updatedAt: library.meta.updatedAt ?? '',
      salesMode: library.salesMeta?.mode ?? 'seed',
      hunanMode: library.salesMeta?.hunanMode ?? 'seed',
      salesSource: library.salesMeta?.source ?? ''
    },
    library: {
      total: library.policies.length,
      byLevel: countBy(library.policies, (policy) => policy.level).map((item) => ({
        ...item,
        name: LEVEL_NAMES[Number(item.key)] ?? item.key
      })),
      byTool: countBy(library.policies, (policy) => policy.toolTypes ?? ['未分类'])
    },
    analysis,
    psiSeries,
    salesSeries,
    // 国内政策全库：面板提供“全部政策”浏览，不局限于所选月份
    libraryList: library.policies
      .map((policy) => ({
        id: policy.id,
        title: policy.title,
        publishDate: policy.publishDate,
        month: String(policy.publishDate ?? '').slice(0, 7),
        level: policy.level,
        levelName: LEVEL_NAMES[policy.level] ?? '未知',
        regionName: policy.regionName ?? '',
        issuer: policy.issuer ?? '',
        tools: policy.toolTypes ?? [],
        docNo: policy.docNo ?? '',
        sourceUrl: policy.sourceUrl
      }))
      .sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1)),
    libraryYears: [...new Set(library.policies.map((policy) => String(policy.publishDate ?? '').slice(0, 4)))]
      .filter((year) => /^\d{4}$/.test(year))
      .sort()
      .reverse(),
    excludedInternational: library.meta.excludedInternational ?? 0,
    modelMonthly: library.modelMonthly,
    financials: library.financials,
    linkage: buildPolicyFinanceLinkage(library, { quarters: 6 }),
    sources: buildSources(library, { month: target, region, counts: analysis.counts, brand: activeBrand })
  }
}

/** 全库概览：报告附录用，统计的是整库（不只当期）。 */
export function buildLibraryOverview(library) {
  const policies = library.policies ?? []
  if (policies.length === 0) return null
  const byYear = new Map()
  const byLevel = new Map()
  const byTool = new Map()
  for (const policy of policies) {
    const year = String(policy.publishDate ?? '').slice(0, 4)
    if (year) byYear.set(year, (byYear.get(year) ?? 0) + 1)
    const level = LEVEL_NAMES[policy.level] ?? '未知'
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1)
    for (const tool of policy.toolTypes ?? ['未分类']) {
      byTool.set(tool, (byTool.get(tool) ?? 0) + 1)
    }
  }
  const dates = policies.map((policy) => policy.publishDate).filter(Boolean).sort()
  const fmt = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} ${count}`)
    .join(' · ')
  return {
    total: policies.length,
    byYear: [...byYear.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, count]) => `${key} ${count}`).join(' · '),
    byLevel: fmt(byLevel),
    byTool: [...byTool.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => `${key} ${count}`).join(' · '),
    from: dates[0] ?? '',
    to: dates[dates.length - 1] ?? ''
  }
}

function countBy(policies, pick) {
  const counts = new Map()
  for (const policy of policies) {
    const keys = pick(policy)
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key: String(key), count }))
    .sort((a, b) => b.count - a.count)
}