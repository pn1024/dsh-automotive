import {
  brandTable,
  concentration,
  levelMix,
  monthOverMonth,
  penetration,
  percent,
  policyStrengthIndex,
  policyWeight,
  regionMix,
  thousands,
  toolMix
} from './indicators.js?v=20261124g'
import { BRANDS, buildBrand } from './brand.js?v=20261124g'
import { clausesOf } from './clauses.js?v=20261124g'
import { LEVEL_NAMES, matchesRegion, previousMonth, policiesInWindow } from './store.js?v=20261124g'

const DIRECTION_LABEL = { positive: '利好', negative: '利空', neutral: '中性' }
const round = (value, digits = 1) => (value === null || value === undefined ? null : Math.round(value * 10 ** digits) / 10 ** digits)

function policyScore(policy) {
  return Math.round(policyWeight(policy) * (policy.level === 1 ? 1.5 : policy.level === 0 ? 1.4 : policy.level === 2 ? 1.0 : 0.7) * 100) / 100
}

/**
 * 从真实来源构造分析。所有无官方 URL 的政策已在 store 层被剔除；
 * 这里不再出现“示例/待补”的兜底数字。
 */
export function buildAnalysis(library, options = {}) {
  const { month, region, topN = 5, brand = '奇瑞' } = options
  if (!month) throw new Error('缺少 month 参数，格式 YYYY-MM')

  const inMonth = policiesInWindow(library, { month })
  const filterByRegion = (list) => (region ? list.filter((policy) => matchesRegion(policy, region)) : list)
  const macroScope = inMonth.filter((policy) => Number(policy.level) <= 1)
  const mesoScope = filterByRegion(inMonth.filter((policy) => Number(policy.level) === 2))
  const microScope = filterByRegion(inMonth.filter((policy) => Number(policy.level) === 3))
  const scoped = region ? filterByRegion(inMonth) : inMonth

  const current = policyStrengthIndex(inMonth, { asOf: `${month}-28` })
  const priorMonth = previousMonth(month)
  const previous = policyStrengthIndex(policiesInWindow(library, { month: priorMonth }), { asOf: `${priorMonth}-28` })

  const national = penetration(library, month, 'national')
  const hunan = penetration(library, month, 'hunan')
  const brands = brandTable(library, month)
  const cr5 = concentration(brands, 5)
  const regionLabel = region ? (regionNameOf(library, region) ?? String(region)) : '全国'
  const gaps = []

  const macro = []
  if (inMonth.length > 0) {
    macro.push({
      id: 'M1',
      text: `${month} 收录有官方原文的政策 ${inMonth.length} 条，其中国家级 ${inMonth.filter((p) => p.level === 1).length} 条、国际 ${inMonth.filter((p) => p.level === 0).length} 条、省级 ${inMonth.filter((p) => p.level === 2).length} 条、市级 ${inMonth.filter((p) => p.level === 3).length} 条。`,
      evidence: inMonth.map((policy) => policy.id),
      confidence: 'high'
    })
    const topTools = toolMix(inMonth).slice(0, 3)
    if (topTools.length > 0) {
      macro.push({
        id: 'M2',
        text: `政策工具结构以 ${topTools.map((item) => `${item.tool}（${item.count} 条）`).join('、')} 为主；一策多工具时分别计入，因此工具占比不加总为 100%。`,
        evidence: inMonth.map((policy) => policy.id),
        confidence: 'high'
      })
    }
    const ranked = [...inMonth].sort((a, b) => policyScore(b) - policyScore(a))
    for (const [index, policy] of ranked.slice(0, Math.min(2, topN)).entries()) {
      const clause = clausesOf(policy, 1)[0]
      macro.push({
        id: `M${index + 3}`,
        text: `重点政策：${policy.issuer}《${policy.title}》（${policy.publishDate}）${clause ? `。原文要点：${clause.text}` : '。'}`,
        evidence: [policy.id],
        confidence: 'high'
      })
    }
  }

  // 国际政策已按产品要求整体排除，不再作为缺口提示。

  const meso = []
  if (national) {
    meso.push({
      id: 'S1',
      text: `全国乘用车零售 ${thousands(national.total)} 辆，其中新能源 ${thousands(national.nev)} 辆，渗透率 ${national.share}%。`,
      evidence: [`D-SALES-CN-${month}`],
      confidence: 'high'
    })
    const mom = monthOverMonth(library, month, 'national')
    if (mom !== null) {
      meso.push({
        id: 'S2',
        text: `全国乘用车零售环比 ${percent(mom)}；环比按相邻两个月的同源数据计算。`,
        evidence: [`D-SALES-CN-${month}`],
        confidence: 'high'
      })
    }
  }
  if (hunan) {
    meso.push({
      id: 'S3',
      text: `湖南乘用车零售 ${thousands(hunan.total)} 辆，其中新能源 ${thousands(hunan.nev)} 辆，渗透率 ${hunan.share}%。`,
      evidence: [`D-SALES-HN-${month}`],
      confidence: 'high'
    })
  } else if (region) {
    gaps.push('区域销量：当前公开榜单不提供有效分省销量，未展示湖南销量与渗透率。')
  }
  if (region && mesoScope.length > 0) {
    meso.push({
      id: 'S4',
      text: `${regionLabel}本期有官方原文的省级政策 ${mesoScope.length} 条，工具以 ${toolMix(mesoScope)[0]?.tool ?? '未分类'} 为主。`,
      evidence: mesoScope.map((policy) => policy.id),
      confidence: 'high'
    })
  }

  const clauseImpacts = []
  for (const policy of [...macroScope, ...mesoScope, ...microScope]) {
    for (const clause of clausesOf(policy, 5)) {
      clauseImpacts.push({
        policyId: policy.id,
        policyTitle: policy.title,
        issuer: policy.issuer,
        sourceUrl: policy.sourceUrl,
        paragraph: clause.paragraph,
        quote: clause.quote,
        clauseNo: clause.no,
        clauseText: clause.text,
        target: clause.impact.target,
        direction: clause.impact.direction,
        directionLabel: DIRECTION_LABEL[clause.impact.direction] ?? '中性',
        magnitude: clause.impact.magnitude,
        note: clause.impact.note ?? ''
      })
    }
  }
  clauseImpacts.sort((a, b) => b.magnitude - a.magnitude || policyScore(library.byId.get(b.policyId)) - policyScore(library.byId.get(a.policyId)))

  const micro = clauseImpacts.slice(0, topN).map((impact, index) => ({
    id: `C${index + 1}`,
    text: `《${impact.policyTitle}》${impact.clauseNo}：${impact.clauseText}（原文第 ${impact.paragraph} 段；对象：${impact.target}；方向：${impact.directionLabel}）`,
    evidence: [impact.policyId],
    confidence: 'medium'
  }))

  if (brands && brands.length > 0) {
    const top = brands.slice(0, 3)
    micro.push({
      id: 'B1',
      text: `品牌零售前三为 ${top.map((row) => `${row.brand} ${thousands(row.retail)} 辆（份额 ${row.share}%）`).join('、')}，前五品牌合计份额 CR5 为 ${cr5}%。`,
      evidence: [`D-BRAND-${month}`],
      confidence: 'high'
    })
  } else {
    gaps.push(`品牌数据：${month} 没有可核验的品牌零售记录，未展示品牌份额。`)
  }

  const evidenceIndex = [...new Map([...macroScope, ...mesoScope, ...microScope].map((policy) => [policy.id, policy])).values()]
    .map((policy) => ({
      id: policy.id,
      title: policy.title,
      issuer: policy.issuer,
      publishDate: policy.publishDate,
      level: policy.level,
      levelName: LEVEL_NAMES[policy.level] ?? '未知',
      docType: policy.docType ?? '',
      regionName: policy.regionName ?? '',
      version: (policy.versions ?? []).length,
      tools: policy.toolTypes ?? [],
      sourceUrl: policy.sourceUrl,
      contentStatus: policy.contentStatus ?? 'unknown'
    }))

  return {
    meta: {
      month,
      region: region ?? null,
      regionName: regionLabel,
      generatedAt: new Date().toISOString(),
      dataMode: library.meta.mode ?? 'unknown',
      datasetName: library.meta.name ?? '未命名数据集',
      datasetNote: library.meta.note ?? '',
      engine: 'evidence-rules-v2'
    },
    counts: {
      total: inMonth.length,
      live: inMonth.length,
      seed: 0,
      byLevel: levelMix(inMonth),
      byTool: toolMix(inMonth),
      byRegion: regionMix(inMonth)
    },
    psi: {
      current: current.value,
      previous: previous.value,
      delta: round(current.value - previous.value),
      byTool: current.byTool,
      byLevel: current.byLevel
    },
    sales: { national, hunan, momNational: monthOverMonth(library, month, 'national'), month },
    brands: brands ? { rows: brands, cr5 } : { rows: [], cr5: null },
    layers: {
      macro: { scope: macroScope.map((policy) => policy.id), findings: macro },
      meso: { scope: mesoScope.map((policy) => policy.id), findings: meso },
      micro: { scope: microScope.map((policy) => policy.id), clauseImpacts: clauseImpacts.slice(0, 12), findings: micro }
    },
    transmission: [],
    gaps,
    evidenceIndex,
    brand: buildBrand(library, month, region, brand),
    brandOptions: BRANDS
  }
}

function regionNameOf(library, region) {
  const hit = library.policies.find((policy) => matchesRegion(policy, region))?.regionName
  if (hit) return hit
  const names = { '430000': '湖南省', '430100': '长沙市', '430200': '株洲市', '430300': '湘潭市', '100000': '全国' }
  return names[String(region)] ?? String(region)
}
