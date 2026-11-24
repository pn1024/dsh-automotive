import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(here, '..')

/** Tool weights used by the policy-strength index (PSI). Higher = closer to purchase cost. */
export const TOOL_WEIGHTS = {
  补贴: 3.0,
  以旧换新: 2.4,
  税收: 2.8,
  双积分: 2.6,
  路权: 2.5,
  贸易: 2.2,
  标准: 1.8,
  基建: 1.6,
  规划: 1.2
}

/** Level factors: a national notice outranks a municipal one for the same tool. */
export const LEVEL_FACTORS = { 0: 0.8, 1: 1.0, 2: 0.55, 3: 0.3 }

export const LEVEL_NAMES = { 0: '国际', 1: '国家', 2: '省级', 3: '市级' }

/** Resolve the data directory: explicit config, then env, then the bundled sample set. */
export function resolveDataDir(configured) {
  if (typeof configured === 'string' && configured.trim()) return path.resolve(configured)
  const fromEnv = process.env.AUTO_POLICY_DATA_DIR
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv)
  return path.join(packageRoot, 'data')
}

function readJson(file, what) {
  if (!fs.existsSync(file)) {
    throw new Error(`缺少${what}：${file}。请把数据文件放到该路径，或设置 AUTO_POLICY_DATA_DIR 指向数据目录。`)
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${what}不是合法 JSON（${file}）：${error.message}`)
  }
}

const cache = new Map()

function fingerprint(file) {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return 'missing'
  }
}

/**
 * Load and index the library once per data directory.
 * The cached copy is invalidated when either JSON file changes, so replacing
 * data/*.json takes effect on the next call — no process restart, no stale panel.
 */
export function loadLibrary(dataDirInput) {
  const dataDir = resolveDataDir(dataDirInput)
  const policyFile = path.join(dataDir, 'policies.json')
  const salesFile = path.join(dataDir, 'sales.json')

  if (!fs.existsSync(policyFile) && !fs.existsSync(salesFile)) {
    throw new Error(`未找到数据文件：${policyFile}。请把 policies.json 与 sales.json 放到该目录，或设置 AUTO_POLICY_DATA_DIR。`)
  }

  // 缓存指纹必须覆盖所有会被读到的大文件，否则新增的财报/官方公告数据不会生效。
  const stamp = [
    fingerprint(policyFile),
    fingerprint(salesFile),
    fingerprint(path.join(dataDir, 'financials.json')),
    fingerprint(path.join(dataDir, 'chery-official.json'))
  ].join('|')
  const cached = cache.get(dataDir)
  if (cached && cached.stamp === stamp) return cached.library

  const policyDoc = readJson(policyFile, '政策数据')
  const salesDoc = readJson(salesFile, '销量数据')

  // 奇瑞官方公告（集团口径）独立存放，缺失时不影响主流程
  let cheryOfficial = {}
  try {
    const officialFile = path.join(dataDir, 'chery-official.json')
    if (fs.existsSync(officialFile)) {
      const parsed = JSON.parse(fs.readFileSync(officialFile, 'utf8'))
      for (const row of parsed.months ?? []) cheryOfficial[row.month] = row
    }
  } catch {
    cheryOfficial = {}
  }

  // 生产口径：只有带官方 URL 的政策才算数。示例条目保留在文件中供开发对照，
  // 但绝不进入检索、指标、面板或报告。
  // 2026-11 起按要求只保留国内政策（level 0 = 国际，数据文件仍保留，面板与报告不再纳入）。
  const allWithUrl = (policyDoc.policies ?? [])
    .filter((item) => /^https?:\/\//i.test(String(item.sourceUrl ?? '')))
    .map((item) => ({ ...item }))
  const policies = allWithUrl.filter((item) => Number(item.level) !== 0)
  const excludedInternational = allWithUrl.length - policies.length

  // 上市公司季度财报（东财数据中心），缺失时不影响主流程
  let financials = {}
  try {
    const finFile = path.join(dataDir, 'financials.json')
    if (fs.existsSync(finFile)) {
      const parsed = JSON.parse(fs.readFileSync(finFile, 'utf8'))
      for (const company of parsed.companies ?? []) financials[company.code] = company
    }
  } catch {
    financials = {}
  }

  const salesLive = salesDoc.dataset?.mode === 'live'
  const hunanLive = salesDoc.dataset?.hunanMode === 'live'
  const monthly = salesLive
    ? (salesDoc.monthly ?? [])
        .filter((entry) => entry?.national?.total > 0 && entry?.national?.nev >= 0)
        .map((entry) => ({
          ...entry,
          hunan: hunanLive && entry?.hunan?.total > 0 ? entry.hunan : null,
          chery: entry.chery ? { ...entry.chery, export: null, exportShare: null } : null
        }))
    : []

  const brandMonthly = salesLive ? salesDoc.brandMonthly ?? {} : {}
  const brands = {}
  if (salesLive) {
    const months = new Set([
      ...Object.keys(salesDoc.brands ?? {}),
      ...monthly.map((entry) => entry.month)
    ])
    for (const month of months) {
      brands[month] = Object.entries(brandMonthly)
        .map(([brand, rows]) => ({
          brand,
          retail: rows.find((row) => row.month === month)?.retail ?? 0,
          yoy: rows.find((row) => row.month === shiftMonth(month, -12))?.retail
            ? Math.round(((rows.find((row) => row.month === month).retail / rows.find((row) => row.month === shiftMonth(month, -12)).retail - 1) * 1000)) / 10
            : null,
          nevRatio: null
        }))
        .filter((row) => row.retail > 0)
        .sort((a, b) => b.retail - a.retail)
    }
  }

  const byId = new Map(policies.map((item) => [item.id, item]))
  const byDate = [...policies].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))

  const library = {
    dataDir,
    meta: {
      ...policyDoc.dataset,
      mode: policies.length > 0 ? 'live' : 'empty',
      name: '汽车政策研究库（官方原文）',
      note: '仅使用带官方原文链接的国内政策；国际政策与无来源条目在加载时已排除。',
      excludedInternational
    },
    salesMeta: {
      ...(salesDoc.dataset ?? {}),
      name: salesLive ? '全国乘用车销量（公开销量榜）' : '暂无销量数据'
    },
    policies,
    byDate,
    byId,
    monthly,
    brandMonthly,
    brands,
    modelMonthly: salesLive ? salesDoc.modelMonthly ?? {} : {},
    cheryOfficial,
    financials
  }
  cache.set(dataDir, { stamp, library })
  return library
}

export function monthOf(date) {
  return typeof date === 'string' ? date.slice(0, 7) : ''
}

/** Bounds of a `YYYY-MM` month as inclusive ISO dates. */
export function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number)
  if (!year || !mon) throw new Error(`月份格式应为 YYYY-MM，收到：${month}`)
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

export function previousMonth(month) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function tokensOf(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[\s,，、;；]+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

/**
 * Keyword search over title/summary/content/issuer/tags.
 * Filters run before scoring, so a filtered search never hides a better in-scope hit.
 */
export function searchPolicies(library, options = {}) {
  const {
    query = '',
    region,
    level,
    toolType,
    nevOnly = false,
    from,
    to,
    limit = 10
  } = options

  const tokens = tokensOf(query)
  const scored = []

  for (const policy of library.policies) {
    if (region && !matchesRegion(policy, region)) continue
    if (level !== undefined && Number(policy.level) !== Number(level)) continue
    if (toolType && !(policy.toolTypes ?? []).includes(toolType)) continue
    if (nevOnly && policy.nevSpecific !== true) continue
    if (from && policy.publishDate < from) continue
    if (to && policy.publishDate > to) continue

    let score = 0
    const title = (policy.title ?? '').toLowerCase()
    const summary = (policy.summary ?? '').toLowerCase()
    const issuer = (policy.issuer ?? '').toLowerCase()
    const content = (policy.content ?? '').toLowerCase()
    const tags = [...(policy.toolTypes ?? []), ...(policy.supplyChain ?? [])].join(' ').toLowerCase()

    for (const token of tokens) {
      if (title.includes(token)) score += 5
      if (summary.includes(token)) score += 3
      if (issuer.includes(token)) score += 3
      if (tags.includes(token)) score += 2
      if (content.includes(token)) score += 1
    }

    if (tokens.length > 0 && score === 0) continue
    if (tokens.length === 0) score = 1
    scored.push({ policy, score })
  }

  scored.sort((a, b) =>
    b.score - a.score ||
    (a.policy.publishDate < b.policy.publishDate ? 1 : -1))

  const total = scored.length
  return {
    total,
    items: scored.slice(0, Math.max(1, Math.min(limit, 50))).map((entry) => entry.policy)
  }
}

export const REGION_ALIASES = {
  全国: '100000',
  国家: '100000',
  湖南: '430000',
  长沙: '430100',
  株洲: '430200',
  湘潭: '430300',
  欧盟: 'EU',
  美国: 'US'
}

/** Resolve a user-supplied region (code, province alias, or city name) to a comparable key. */
export function resolveRegion(region) {
  const wanted = String(region ?? '').trim()
  if (!wanted) return ''
  return REGION_ALIASES[wanted] ?? wanted
}

const isProvinceCode = (code) => /^\d{2}0000$/.test(code)

/** Accepts a numeric code (`430000`), a short name (`湖南`), or a full name. */
export function matchesRegion(policy, region) {
  const wanted = resolveRegion(region)
  if (!wanted) return true
  const code = String(policy.region ?? '')
  const name = String(policy.regionName ?? '')
  if (code === wanted || name === wanted) return true
  // A province query also covers its cities: 430000 matches 430100/430200.
  if (isProvinceCode(wanted) && /^\d{6}$/.test(code)) return code.slice(0, 2) === wanted.slice(0, 2)
  if (name.includes(wanted) || wanted.includes(name)) return true
  return false
}

export function policiesInWindow(library, { month, region, level } = {}) {
  const bounds = month ? monthBounds(month) : null
  return library.policies.filter((policy) => {
    if (bounds && (policy.publishDate < bounds.from || policy.publishDate > bounds.to)) return false
    if (region && !matchesRegion(policy, region)) return false
    if (level !== undefined && Number(policy.level) !== Number(level)) return false
    return true
  })
}

export function salesEntry(library, month) {
  return library.monthly.find((entry) => entry.month === month) ?? null
}

export function brandRows(library, month) {
  const rows = library.brands[month]
  return Array.isArray(rows) ? rows : null
}

export function latestMonth(library) {
  const months = library.monthly.map((entry) => entry.month).sort()
  return months.length > 0 ? months[months.length - 1] : null
}