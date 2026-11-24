/**
 * 政策与财报的季度对照。
 *
 * 把国内政策按季度聚合（条数 + 季度末 PSI），再与 A 股样本公司的季度财务指标对齐，
 * 用于观察「政策密集期」与「盈利变化」是否同向。这只是相关性观察，不做因果归因。
 */
import { policyStrengthIndex } from './indicators.js?v=20261124g'

const QUARTER_OF = (dateText) => {
  const month = Number(String(dateText ?? '').slice(5, 7))
  if (!month) return ''
  const quarter = Math.ceil(month / 3)
  return `${String(dateText).slice(0, 4)}Q${quarter}`
}

const quarterEndOf = (quarter) => {
  const year = Number(quarter.slice(0, 4))
  const q = Number(quarter.slice(5, 6))
  const month = q * 3
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/**
 * @param library 已加载的库
 * @param options.quarters 参与对照的季度数（默认 6）
 */
export function buildPolicyFinanceLinkage(library, { quarters = 6 } = {}) {
  const domestic = (library.policies ?? []).filter((policy) => Number(policy.level) !== 0)
  const financials = library.financials ?? {}
  const companies = Object.values(financials).filter((company) => company.market === 'A')

  // 1) 政策按季度聚合
  const policyByQuarter = new Map()
  for (const policy of domestic) {
    const quarter = QUARTER_OF(policy.publishDate)
    if (!quarter) continue
    const bucket = policyByQuarter.get(quarter) ?? []
    bucket.push(policy)
    policyByQuarter.set(quarter, bucket)
  }

  // 2) 财报按季度聚合：平均毛利率、平均营收同比
  const financeByQuarter = new Map()
  for (const company of companies) {
    const periods = company.periods ?? []
    const byDate = new Map(periods.map((period) => [period.reportDate, period]))
    for (const period of periods) {
      const quarter = QUARTER_OF(period.reportDate)
      if (!quarter) continue
      const bucket = financeByQuarter.get(quarter) ?? { margins: [], grows: [] }
      if (period.grossMargin !== null && period.grossMargin !== undefined) bucket.margins.push(period.grossMargin)
      // 同比：同一季度上一年
      const lastYearDate = `${Number(period.reportDate.slice(0, 4)) - 1}${period.reportDate.slice(4)}`
      const base = byDate.get(lastYearDate)
      if (base && base.revenue > 0 && period.revenue > 0) {
        bucket.grows.push(((period.revenue - base.revenue) / base.revenue) * 100)
      }
      financeByQuarter.set(quarter, bucket)
    }
  }

  // 3) 合并：只保留财报覆盖的季度，按时间倒序取最近 N 个
  const allQuarters = [...new Set([...financeByQuarter.keys()])].sort().reverse().slice(0, quarters)

  return allQuarters.map((quarter) => {
    const policies = policyByQuarter.get(quarter) ?? []
    const finance = financeByQuarter.get(quarter) ?? { margins: [], grows: [] }
    const avg = (list) => (list.length === 0 ? null : Math.round((list.reduce((sum, v) => sum + v, 0) / list.length) * 10) / 10)
    const psi = policies.length > 0 ? policyStrengthIndex(policies, { asOf: quarterEndOf(quarter) }).value : 0
    return {
      quarter,
      policyCount: policies.length,
      psi: Math.round(psi * 10) / 10,
      avgGrossMargin: avg(finance.margins),
      avgRevenueGrowth: avg(finance.grows),
      sampleCompanies: {
        margin: finance.margins.length,
        growth: finance.grows.length
      }
    }
  })
}