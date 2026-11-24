import {
  LEVEL_FACTORS,
  LEVEL_NAMES,
  TOOL_WEIGHTS,
  monthBounds,
  previousMonth,
  salesEntry
} from './store.js?v=20261124g'

const DAY_MS = 24 * 60 * 60 * 1000

const weightOf = (tool) => (TOOL_WEIGHTS[tool] ?? 1.0)

/** Mean tool weight of one policy: mixed instruments score between their parts. */
export function policyWeight(policy) {
  const tools = policy.toolTypes ?? []
  if (tools.length === 0) return 1.0
  return tools.reduce((sum, tool) => sum + weightOf(tool), 0) / tools.length
}

/** Freshness decay: a 90-day half-life keeps last quarter's policy visible without dominating. */
export function freshness(policy, asOf) {
  const days = Math.max(0, (new Date(asOf) - new Date(policy.publishDate)) / DAY_MS)
  return Math.exp(-days / 90)
}

/**
 * Policy Strength Index on a 0—100 scale.
 * raw = Σ (tool weight × level factor × freshness); psi = 100 × (1 − e^(−raw / 18)).
 * The mapping is monotonic and saturating, so a very heavy month nears 100 instead of unbounded.
 */
export function policyStrengthIndex(policies, { asOf, level } = {}) {
  const filterLevel = level === undefined ? null : Number(level)
  let raw = 0
  const byTool = new Map()
  const byLevel = new Map()

  for (const policy of policies) {
    if (filterLevel !== null && Number(policy.level) !== filterLevel) continue
    const weight = policyWeight(policy) * (LEVEL_FACTORS[policy.level] ?? 0.5) * freshness(policy, asOf)
    raw += weight
    const tools = policy.toolTypes ?? ['未分类']
    for (const tool of tools) {
      const share = weight / tools.length
      byTool.set(tool, (byTool.get(tool) ?? 0) + share)
    }
    byLevel.set(policy.level, (byLevel.get(policy.level) ?? 0) + weight)
  }

  const psi = 100 * (1 - Math.exp(-raw / 18))
  const round = (value) => Math.round(value * 10) / 10

  return {
    value: round(psi),
    raw: round(raw),
    byTool: [...byTool.entries()]
      .map(([tool, value]) => ({ tool, contribution: round(value) }))
      .sort((a, b) => b.contribution - a.contribution),
    byLevel: [...byLevel.entries()]
      .map(([levelCode, value]) => ({ level: Number(levelCode), name: LEVEL_NAMES[levelCode] ?? '未知', contribution: round(value) }))
      .sort((a, b) => b.contribution - a.contribution)
  }
}

export function toolMix(policies) {
  const counts = new Map()
  for (const policy of policies) {
    for (const tool of policy.toolTypes ?? ['未分类']) counts.set(tool, (counts.get(tool) ?? 0) + 1)
  }
  const total = policies.length || 1
  return [...counts.entries()]
    .map(([tool, count]) => ({ tool, count, share: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count)
}

export function levelMix(policies) {
  const counts = new Map()
  for (const policy of policies) counts.set(policy.level, (counts.get(policy.level) ?? 0) + 1)
  return [...counts.entries()]
    .map(([level, count]) => ({ level: Number(level), name: LEVEL_NAMES[level] ?? '未知', count }))
    .sort((a, b) => a.level - b.level)
}

export function regionMix(policies) {
  const counts = new Map()
  for (const policy of policies) {
    const key = policy.regionName ?? policy.region ?? '未标注'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/** NEV share of the given scope for one month, or null when the month is missing. */
export function penetration(library, month, scope = 'national') {
  const entry = salesEntry(library, month)
  if (!entry) return null
  const bucket = entry[scope]
  if (!bucket || !bucket.total) return null
  return {
    total: bucket.total,
    nev: bucket.nev,
    share: Math.round((bucket.nev / bucket.total) * 1000) / 10,
    yoyTotal: bucket.yoyTotal ?? null,
    yoyNev: bucket.yoyNev ?? null
  }
}

export function monthOverMonth(library, month, scope = 'national') {
  const current = penetration(library, month, scope)
  const prior = penetration(library, previousMonth(month), scope)
  if (!current || !prior) return null
  return Math.round(((current.total - prior.total) / prior.total) * 1000) / 10
}

export function brandTable(library, month) {
  const entry = salesEntry(library, month)
  const rows = library.brands[month]
  if (!entry || !Array.isArray(rows)) return null
  const total = entry.national.total
  return rows.map((row) => ({
    brand: row.brand,
    retail: row.retail,
    yoy: row.yoy ?? null,
    nevRatio: row.nevRatio ?? null,
    share: Math.round((row.retail / total) * 1000) / 10
  }))
}

export function concentration(rows, topN = 5) {
  if (!rows || rows.length === 0) return null
  const sum = rows.slice(0, topN).reduce((acc, row) => acc + row.share, 0)
  return Math.round(sum * 10) / 10
}

export function windowBounds(month) {
  return monthBounds(month)
}

export const percent = (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`

export const thousands = (value) =>
  Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 })

export const yiyuan = (value) => `${(value / 10000).toFixed(1)} 万辆`