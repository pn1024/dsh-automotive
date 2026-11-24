/**
 * 国际政策入库：美国联邦公报（Federal Register）官方 API
 *
 *   node scripts/ingest-intl.mjs                 # 抓最近一批汽⻋相关政策并写库
 *   node scripts/ingest-intl.mjs --dry           # 只看命中，不落盘
 *   node scripts/ingest-intl.mjs --content-limit=20
 *
 * 只收标题或摘要确实涉及汽车的条目，并抓 raw_text_url 正文；
 * 抓不到正文就保留摘要，绝不拼凑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { enabledSources, loadRegistry, politeFetch, sleep } from './sources.mjs'
import { backupBeforeWrite } from './backup.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const POLICY_FILE = path.join(DATA_DIR, 'policies.json')

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const option = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const CONTENT_LIMIT = Number(option('content-limit', '24'))
// 时间范围：用于补齐指定月份（如 --since=2026-01-01 --until=2026-06-30）
const SINCE = option('since', '')
const UNTIL = option('until', '')

const INCLUDE = /electric vehicle|zero[- ]emission vehicle|clean vehicle|fuel economy|charging (?:infrastructure|station|network)|\bev charger|motor vehicle safety|automobile|light[- ]duty|heavy[- ]duty vehicle|vehicle emissions/i
const EXCLUDE = /air plan|state implementation plan|hazardous air pollutant|hazardous materials|agency information collection|paperwork reduction|pesticide|polyvinyl|aircraft|vessel|locomotive|radioactive|solid waste/i

const QUERIES = [
  { term: '"electric vehicle"', agencies: ['transportation-department', 'energy-department', 'environmental-protection-agency'] },
  { term: '"clean vehicle"', agencies: ['internal-revenue-service', 'transportation-department', 'energy-department'] },
  { term: '"fuel economy"', agencies: ['transportation-department', 'environmental-protection-agency'] },
  { term: '"charging infrastructure"', agencies: ['energy-department', 'transportation-department'] },
  { term: '"zero emission vehicle"', agencies: ['environmental-protection-agency', 'transportation-department'] },
  // 补几组宽一点的词，专门用于按时间范围补齐空月
  { term: '"automobile"', agencies: ['transportation-department', 'environmental-protection-agency'] },
  { term: '"motor vehicle"', agencies: ['transportation-department'] },
  { term: '"EV charging"', agencies: ['energy-department', 'transportation-department'] }
]

const DOC_TYPE = {
  Rule: '规则',
  'Proposed Rule': '规则草案',
  Notice: '公告',
  'Presidential Document': '总统文件'
}

const TOOL_RULES = [
  ['税收', /tax credit|tax|deduction|excise/i],
  ['补贴', /grant|rebate|incentive|subsid|funding/i],
  ['标准', /standard|requirement|compliance|test procedure|safety/i],
  ['基建', /charging|infrastructure|grid|station/i],
  ['贸易', /import|export|tariff|trade/i],
  ['规划', /plan|program|strategy|framework/i]
]

/**
 * 合并新旧记录时保留更完整的正文。
 * 重新抓取同一条 URL 时，新记录可能只有标题没有正文；直接展开会把它覆盖成空。
 */
function mergePolicy(existing, incoming) {
  const merged = { ...(existing ?? {}), ...incoming }
  if ((!incoming.content || incoming.content.length === 0) && existing && existing.content) {
    merged.content = existing.content
    merged.contentStatus = existing.contentStatus
    merged.summary = incoming.summary || existing.summary || ''
  }
  if ((!incoming.docNo || incoming.docNo.length === 0) && existing && existing.docNo) merged.docNo = existing.docNo
  if ((!incoming.summary || incoming.summary.length === 0) && existing && existing.summary) merged.summary = existing.summary
  return merged
}

function classify(text) {
  const tools = TOOL_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  return tools.length > 0 ? tools : ['标准']
}

function isRelevant(item) {
  const haystack = `${item.title ?? ''} ${item.abstract ?? ''}`
  if (!INCLUDE.test(haystack)) return false
  if (EXCLUDE.test(haystack)) return false
  return true
}

function idOf(documentNumber) {
  let hash = 0
  for (const char of String(documentNumber)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-INTL-FR-${String(hash).padStart(8, '0')}`
}

function plainText(raw) {
  if (!raw) return ''
  return raw
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 40)
    .join('\n')
    .slice(0, 7000)
}

async function fetchDocumentText(item, rateLimitMs) {
  const url = item.raw_text_url
  if (!url) return ''
  const result = await politeFetch(url, { rateLimitMs, timeoutMs: 20000 })
  if (!result.ok) return ''
  return plainText(result.text)
}

async function main() {
  const registry = loadRegistry()
  const source = enabledSources(registry, 'federal-register')[0]
  if (!source) throw new Error('us-federal-register 未启用，检查 data/sources.json')

  const collected = new Map()
  for (const query of QUERIES) {
    const params = new URLSearchParams({ per_page: '60', order: 'newest' })
    params.append('conditions[term]', query.term)
    for (const agency of query.agencies) params.append('conditions[agencies][]', agency)
    // 时间范围：补齐指定月份的国际政策（国内库标题检索覆盖不到的空月）。
    if (SINCE) params.append('conditions[publication_date][gte]', SINCE)
    if (UNTIL) params.append('conditions[publication_date][lte]', UNTIL)
    for (const field of ['title', 'type', 'abstract', 'document_number', 'html_url', 'raw_text_url', 'publication_date', 'agencies']) {
      params.append('fields[]', field)
    }
    const result = await politeFetch(`${source.url}?${params}`, { rateLimitMs: source.rateLimitMs ?? 800 })
    if (!result.ok || !result.json) {
      console.log(`  ! 查询失败 ${query.term}：${result.error ?? result.status}`)
      continue
    }
    let hits = 0
    for (const item of result.json.results ?? []) {
      if (!isRelevant(item) || collected.has(item.document_number)) continue
      collected.set(item.document_number, item)
      hits += 1
    }
    console.log(`  ${query.term} → 命中 ${hits}（累计 ${collected.size}）`)
  }

  const items = [...collected.values()].sort((a, b) => (a.publication_date < b.publication_date ? 1 : -1))
  console.log(`\n合计 ${items.length} 条相关文件`)

  const policies = []
  for (const [index, item] of items.entries()) {
    const tools = classify(`${item.title} ${item.abstract ?? ''}`)
    const record = {
      id: idOf(item.document_number),
      title: item.title,
      docNo: item.document_number,
      issuer: (item.agencies ?? []).map((agency) => agency.name).join(' · ') || 'United States Government',
      level: 0,
      region: 'US',
      regionName: '美国',
      publishDate: item.publication_date,
      docType: DOC_TYPE[item.type] ?? item.type ?? '文件',
      toolTypes: tools,
      supplyChain: ['整车'],
      nevSpecific: /electric|zero[- ]emission|charging/i.test(`${item.title} ${item.abstract ?? ''}`),
      summary: (item.abstract ?? '').replace(/\s+/g, ' ').slice(0, 160),
      content: '',
      contentStatus: 'none',
      clauses: [],
      sourceUrl: item.html_url,
      provenance: '美国联邦公报 · Federal Register API',
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publication_date, note: '首次入库' }]
    }
    if (index < CONTENT_LIMIT && !DRY) {
      record.content = await fetchDocumentText(item, source.rateLimitMs ?? 800)
      record.contentStatus = record.content.length > 300 ? 'full' : record.content.length > 0 ? 'short' : 'none'
      if (!record.content) console.log(`  ! 正文未取到：${item.title.slice(0, 40)}`)
    }
    policies.push(record)
  }

  if (DRY) {
    for (const policy of policies.slice(0, 12)) {
      console.log(`  ${policy.publishDate} [${policy.toolTypes.join('/')}] ${policy.title.slice(0, 60)}`)
    }
    console.log('\n--dry：未写入')
    return
  }

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const policy of policies) byUrl.set(policy.sourceUrl, mergePolicy(byUrl.get(policy.sourceUrl), policy))

  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const intl = merged.filter((policy) => Number(policy.level) === 0).length
  doc.policies = merged
  doc.dataset = {
    ...doc.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `政策来自国务院政策文件库与美国联邦公报；国际条目 ${intl} 条。未获取的源见 data/sources.json。`
  }
  backupBeforeWrite('POLICY_FILE');
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n写入 ${path.relative(process.cwd(), POLICY_FILE)}：${merged.length} 条（新增 ${byUrl.size - before}，国际 ${intl}）`)
}

main().catch((error) => {
  console.error('国际政策入库失败：', error)
  process.exit(1)
})