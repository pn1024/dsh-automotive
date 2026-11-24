import assert from 'node:assert/strict'

import { buildOverview } from '../lib/overview.js'
import { clausesOf } from '../lib/clauses.js'
import { lintReport, renderReport } from '../lib/report.js'
import { loadLibrary, latestMonth } from '../lib/store.js'

// 不启动 DSH 的数据与报告回归：node scripts/smoke.mjs [month] [region] [brand]
const library = loadLibrary()
const month = process.argv[2] ?? latestMonth(library)
const region = process.argv[3]
const brand = process.argv[4] ?? '奇瑞'

assert(library.policies.length > 0, '政策库为空')
assert(library.policies.every((policy) => /^https?:\/\//.test(policy.sourceUrl)), '存在无官方链接的政策')
assert(library.monthly.every((entry) => entry.national.total > 0), '存在无效全国销量')
if (library.salesMeta.hunanMode !== 'live') {
  assert(library.monthly.every((entry) => entry.hunan === null), '无来源的湖南销量仍在参与计算')
}

const overview = buildOverview(library, { month, region, brand })
assert(overview.analysis.counts.seed === 0, '分析结果仍含示例政策')
assert(overview.analysis.evidenceIndex.every((policy) => policy.sourceUrl), '证据索引缺链接')

// 没有销量数据的月份（如 2025-10）不应该有品牌表；有销量的月份必须有。
const hasSales = Boolean(overview.analysis.sales.national)
if (hasSales) {
  assert(overview.analysis.brands.rows.length > 0, '有销量的月份品牌表为空')
  assert(Number.isFinite(overview.analysis.brands.cr5), 'CR5 非数值')
} else {
  assert(overview.analysis.brands.rows.length === 0, '无销量月份不应凭空生成品牌表')
}

const models = overview.modelMonthly[month] ?? []
const brandModels = models.filter((row) => row.brand === brand)
if (brandModels.length > 0 && overview.brand.latest) {
  const sum = brandModels.reduce((total, row) => total + row.count, 0)
  assert.equal(sum, overview.brand.latest.retail, '车型明细之和与品牌汇总不一致')
}

for (const policy of library.policies) {
  for (const clause of clausesOf(policy)) {
    assert.equal(clause.sourceUrl, policy.sourceUrl, '条款缺少对应原文链接')
    assert(policy.content.includes(clause.quote.slice(0, 40)), '条款不是正文原文')
  }
}

const markdown = renderReport(overview.analysis, { regionStats: overview.regionStats })
const lint = lintReport(markdown)
assert(lint.ok, `报告质检失败：${lint.errors.join('；')}`)
assert(!/示例待补|乘联会口径（示例数据）/.test(markdown), '报告含示例口径')

console.log(JSON.stringify({
  ok: true,
  month,
  region: region ?? '全国',
  brand,
  policies: library.policies.length,
  salesMonths: library.monthly.length,
  models: brandModels.length,
  clauses: overview.analysis.layers.micro.clauseImpacts.length,
  report: lint
}, null, 2))
