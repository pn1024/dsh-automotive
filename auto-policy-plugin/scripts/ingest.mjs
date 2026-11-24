/**
 * 政策与销量入库脚本（真实数据）
 *
 * 用法：
 *   node scripts/ingest.mjs                      # 抓国务院文件 + 部门文件，合并进 data/policies.json
 *   node scripts/ingest.mjs --dry                # 只看抓到什么，不落盘
 *   node scripts/ingest.mjs --pages=3 --content  # 多翻页，并抓正文
 *   node scripts/ingest.mjs --only=gw            # 只抓国务院文件
 *
 * 数据源：国务院政策文件库检索接口（sousuo.www.gov.cn/search-gov/data）
 *   t=zhengcelibrary_gw → 国务院文件；t=zhengcelibrary_bm → 部门文件
 * 只抓公开目录页与正文，遵守 1 秒间隔；抓不到就明确报错，不编数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { backupBeforeWrite } from './backup.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const POLICY_FILE = path.join(DATA_DIR, 'policies.json')
const BACKUP_FILE = path.join(DATA_DIR, 'policies.seed.json')

const argv = process.argv.slice(2)
const flag = (name) => argv.some((item) => item === `--${name}`)
const option = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const DRY = flag('dry')
const PAGES = Number(option('pages', '2'))
const WANT_CONTENT = flag('content')
const ONLY = option('only', '')
const KEYWORDS = option('keywords', '新能源汽车,智能网联汽车,汽车,充换电,动力电池').split(',')
// 时间范围：给定时走接口的 timezd 模式，可精确补齐某个年份/月份的政策。
const SINCE = option('since', '')
const UNTIL = option('until', '')

const SOURCES = {
  gw: { t: 'zhengcelibrary_gw', type: 'gwyzcwjk', level: 1, name: '国务院文件' },
  bm: { t: 'zhengcelibrary_bm', type: 'bwyzcwjk', level: 1, name: '部门文件' }
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const stripTags = (value) =>
  String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

/**
 * 相关性闸门：标题必须出现汽车产业口径的词，且不是明显无关的行政事项。
 * 只靠检索接口的关键词会把「艺术节赠送车辆」「家电以旧换新」这类噪声带进来。
 */
const TITLE_AUTO = /汽车|车辆|车规|车联网|充电|换电|电池|新能源|电动|乘用车|商用车|燃油/

const TITLE_BLACKLIST = /艺术节|赠送|积压|联营公司|办事机构|招待所|鸣笛|噪声|计量|非机动车|驾培|驾驶培训/

const DATE_FLOOR = option('since', '2023-01-01')

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

function isRelevant(policy) {
  const title = policy.title || ''
  if (TITLE_BLACKLIST.test(title)) return false
  if (!TITLE_AUTO.test(title)) return false
  if (policy.publishDate && policy.publishDate < DATE_FLOOR) return false
  return true
}

const TOOL_RULES = [
  ['以旧换新', /以旧换新|报废更新|置换更新/],
  ['双积分', /双积分|积分办法|平均燃料消耗量/],
  ['税收', /购置税|车船税|税收|减税|免税/],
  ['补贴', /补贴|补助|奖励|专项资金|以奖代补/],
  ['路权', /限行|路权|通行|牌照|号牌/],
  ['基建', /充电|换电|加氢|基础设施|电网/],
  ['贸易', /出口|关税|反补贴|贸易|自贸/],
  ['标准', /标准|准入|规范|条件|认证|检验/],
  ['规划', /规划|行动方案|实施方案|指导意见|若干措施|意见/]
]

const CHAIN_RULES = [
  ['动力电池', /动力电池|电池|电芯|正极|负极|隔膜|电解液/],
  ['充换电', /充电|换电|加氢|补能/],
  ['智能网联', /智能网联|自动驾驶|车路云|智能座舱/],
  ['车规芯片', /芯片|半导体|功率器件|MCU/i],
  ['回收', /回收|梯次利用|拆解/],
  ['整车', /汽车|整车|乘用车|商用车|车型/]
]

function classify(text) {
  const toolTypes = TOOL_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  const supplyChain = CHAIN_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  return {
    toolTypes: toolTypes.length > 0 ? toolTypes : ['规划'],
    supplyChain: supplyChain.length > 0 ? supplyChain : ['整车']
  }
}

function docTypeOf(title) {
  const map = ['通知', '公告', '意见', '规划', '办法', '方案', '指南', '批复', '决定', '细则', '措施']
  return map.find((item) => title.includes(item)) ?? '文件'
}

function idOf(item) {
  const key = item.index || item.url || item.pcode
  let hash = 0
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-GOV-${String(hash).padStart(8, '0')}`
}

async function search(source, keyword, page) {
  const url =
    'https://sousuo.www.gov.cn/search-gov/data?' +
    new URLSearchParams({
      t: source.t,
      q: keyword,
      timetype: SINCE || UNTIL ? 'timezd' : 'timeqb',
      mintime: SINCE ?? '',
      maxtime: UNTIL ?? '',
      sort: 'pubtime',
      sortType: '1',
      searchfield: 'title',
      p: String(page),
      n: '20',
      type: source.type
    }).toString()

  const response = await fetch(url, {
    headers: { 'user-agent': UA, referer: 'https://sousuo.www.gov.cn/' },
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`检索失败 HTTP ${response.status}`)
  const payload = await response.json()
  const list = payload?.searchVO?.listVO
  // 没有命中时接口不返回 listVO，这是「空结果」而不是错误
  if (!Array.isArray(list)) return []
  return list
}

/**
 * 正文抽取：政府网站版式不统一，把所有候选容器的结果都算出来，取最长的那个。
 * 表格类政策（技术要求、目录）也转成文本，否则会只剩一句“见附件”。
 */
function extractArticle(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')

  const candidates = []

  const patterns = [
    /<div[^>]+id="UCAP-CONTENT"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer)/i,
    /<div[^>]+class="[^"]*pages_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<footer)/i,
    /<div[^>]+class="[^"]*(?:artibody|article|TRS_Editor|content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/article)/i,
    /<td[^>]+class="b12c"[^>]*>([\s\S]*?)<\/td>/i
  ]

  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (match) candidates.push(blockToText(match[1]))
  }

  // 兜底：整页所有段落
  candidates.push(blockToText(body))

  return candidates.sort((a, b) => b.length - a.length)[0].slice(0, 8000)
}

function blockToText(fragment) {
  // 表格：逐行拼「单元格 | 单元格」，避免技术要求类政策丢内容
  const withTables = fragment.replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
      [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => stripTags(cell[1])).filter(Boolean).join(' | ')
    )
    return rows.filter((line) => line.length > 0).map((line) => `\n${line}\n`).join('')
  })

  const paragraphs = [...withTables.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((text) => text.length > 8 && !/^(打印|关闭|分享|字体|扫一扫|版权所有)/.test(text))

  if (paragraphs.length > 0) return paragraphs.join('\n').trim()

  const plain = stripTags(withTables).replace(/\s{2,}/g, ' ')
  return plain.length > 120 ? plain : ''
}

async function fetchContent(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, referer: 'https://www.gov.cn/' },
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      if (attempt < 2 && response.status >= 500) {
        await sleep(800)
        return fetchContent(url, attempt + 1)
      }
      return ''
    }
    return extractArticle(await response.text())
  } catch {
    if (attempt < 2) {
      await sleep(800)
      return fetchContent(url, attempt + 1)
    }
    return ''
  }
}

const contentStatusOf = (text) => (text.length > 300 ? 'full' : text.length > 0 ? 'short' : 'none')

function normalize(item, source) {
  const title = stripTags(item.title)
  const summary = stripTags(item.summary)
  const text = `${title} ${summary} ${item.childtype ?? ''}`
  const { toolTypes, supplyChain } = classify(text)
  const publishDate = String(item.pubtimeStr || '').replace(/\./g, '-')
  return {
    id: idOf(item),
    title,
    docNo: stripTags(item.pcode || item.wenhao || ''),
    issuer: stripTags(item.puborg || ''),
    level: source.level,
    region: '100000',
    regionName: '全国',
    publishDate,
    docType: docTypeOf(title),
    toolTypes,
    supplyChain,
    nevSpecific: /新能源汽车|电动汽车|智能网联/.test(text),
    summary: summary.slice(0, 160),
    content: '',
    clauses: [],
    sourceUrl: item.url || '',
    provenance: `国务院政策文件库 · ${source.name}`,
    contentStatus: 'none',
    fetchedAt: new Date().toISOString(),
    versions: [{ versionNo: 1, date: publishDate, note: '首次入库' }]
  }
}

/**
 * 导入销量：支持 CSV（month,scope,total,nev,yoyTotal,yoyNev,chery_retail,chery_export）
 * 与插件同结构的 JSON。乘联会官网对脚本抓取返回 403，所以要么用他们的数据服务/落库导出，
 * 要么每月手工导一次 CSV —— 这条命令就是入口。
 */
async function importSales(file) {
  const absolute = path.resolve(file)
  if (!fs.existsSync(absolute)) throw new Error(`找不到销量文件：${absolute}`)

  const salesPath = path.join(DATA_DIR, 'sales.json')
  const sales = JSON.parse(fs.readFileSync(salesPath, 'utf8'))
  const byMonth = new Map(sales.monthly.map((entry) => [entry.month, entry]))

  const text = fs.readFileSync(absolute, 'utf8')
  let imported = 0

  if (absolute.toLowerCase().endsWith('.csv')) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
    const header = lines[0].split(',').map((cell) => cell.trim())
    const index = Object.fromEntries(header.map((name, position) => [name, position]))
    if (index.month === undefined || index.scope === undefined || index.total === undefined) {
      throw new Error('CSV 表头至少要包含 month,scope,total（可选 nev,yoyTotal,yoyNev,chery_retail,chery_export）')
    }
    const num = (cells, name) => {
      const position = index[name]
      if (position === undefined) return null
      const value = Number(String(cells[position] ?? '').trim())
      return Number.isFinite(value) ? value : null
    }
    for (const line of lines.slice(1)) {
      const cells = line.split(',').map((cell) => cell.trim())
      const month = cells[index.month]
      const scope = cells[index.scope]
      if (!/^\d{4}-\d{2}$/.test(month) || !['national', 'hunan'].includes(scope)) {
        console.log(`  ! 跳过行：${line}`)
        continue
      }
      const entry = byMonth.get(month) ?? { month }
      entry[scope] = { total: num(cells, 'total'), nev: num(cells, 'nev'), yoyTotal: num(cells, 'yoyTotal'), yoyNev: num(cells, 'yoyNev') }
      if (scope === 'national' && num(cells, 'chery_retail')) {
        entry.chery = { retail: num(cells, 'chery_retail'), yoy: num(cells, 'chery_yoy'), export: num(cells, 'chery_export') }
      }
      byMonth.set(month, entry)
      imported += 1
    }
  } else {
    const payload = JSON.parse(text)
    const list = Array.isArray(payload) ? payload : payload.monthly
    if (!Array.isArray(list)) throw new Error('JSON 需要是 monthly 数组或直接给数组')
    for (const entry of list) {
      const merged = { ...(byMonth.get(entry.month) ?? {}), ...entry }
      byMonth.set(entry.month, merged)
      imported += 1
    }
  }

  const monthly = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
  sales.monthly = monthly
  sales.dataset = {
    ...sales.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `由 ${path.basename(absolute)} 导入，共 ${imported} 行；品牌排行为既有数据（未随本文件更新）。`
  }
  backupBeforeWrite('sales');
  fs.writeFileSync(salesPath, JSON.stringify(sales, null, 2) + '\n', 'utf8')
  console.log(`写入 ${path.relative(process.cwd(), salesPath)}：${monthly.length} 个月，导入 ${imported} 行`)
}

/** 清掉历史抓取里的噪声条目（标题口径不符或过旧），默认只报告不删除。 */
async function prune() {
  const doc = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'))
  const drop = doc.policies.filter((policy) => !isRelevant(policy))
  console.log(`共 ${doc.policies.length} 条，命中清洗条件 ${drop.length} 条：`)
  for (const policy of drop.slice(0, 20)) {
    console.log(`  - ${policy.publishDate} ${policy.title.slice(0, 40)}`)
  }
  if (drop.length > 20) console.log(`  …另有 ${drop.length - 20} 条`)
  if (flag('dry')) {
    console.log('\n--dry：未删除')
    return
  }
  const keep = doc.policies.filter((policy) => isRelevant(policy))
  backupBeforeWrite('POLICY_FILE');
  fs.writeFileSync(POLICY_FILE, JSON.stringify({ ...doc, policies: keep }, null, 2) + '\n', 'utf8')
  console.log(`\n保留 ${keep.length} 条，删除 ${drop.length} 条`)
}

/** 只补正文：把已有条目里 contentStatus 不是 full 的再抓一遍，抓不到就保持 none。 */
async function refreshContent() {
  if (!fs.existsSync(POLICY_FILE)) throw new Error('还没有 policies.json，先跑一次政策抓取')
  const doc = JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8'))
  const limit = Number(option('limit', '80'))
  const targets = doc.policies
    .filter((policy) => policy.sourceUrl && policy.contentStatus !== 'full')
    .slice(0, limit)

  console.log(`待补正文 ${targets.length} 条（上限 ${limit}）`)
  let filled = 0
  for (const [index, policy] of targets.entries()) {
    const text = await fetchContent(policy.sourceUrl)
    policy.content = text
    policy.contentStatus = contentStatusOf(text)
    if (text) filled += 1
    console.log(`  ${index + 1}/${targets.length} ${text ? '✓' : '×'} ${policy.title.slice(0, 28)} (${text.length} 字)`)
    await sleep(700)
  }

  doc.dataset = { ...doc.dataset, updatedAt: new Date().toISOString().slice(0, 10) }
  backupBeforeWrite('POLICY_FILE');
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n补到正文 ${filled}/${targets.length} 条；其余点击详情页的「打开官方原文」直接看。`)
}

async function main() {
  if (flag('refresh-content')) {
    await refreshContent()
    return
  }

  if (flag('prune')) {
    await prune()
    return
  }

  const salesFile = option('sales-file', '')
  if (salesFile) {
    await importSales(salesFile)
    return
  }

  const existing = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const before = existing.policies ?? []
  const byUrl = new Map(before.filter((item) => item.sourceUrl).map((item) => [item.sourceUrl, item]))
  const byId = new Map(before.map((item) => [item.id, item]))

  const picked = []
  const seen = new Set()
  const errors = []

  for (const [key, source] of Object.entries(SOURCES)) {
    if (ONLY && ONLY !== key) continue
    for (const keyword of KEYWORDS) {
      for (let page = 1; page <= PAGES; page += 1) {
        try {
          const list = await search(source, keyword, page)
          if (list.length === 0) break
          for (const item of list) {
            const policy = normalize(item, source)
            if (!policy.sourceUrl || seen.has(policy.sourceUrl)) continue
            if (!isRelevant(policy)) continue
            seen.add(policy.sourceUrl)
            picked.push(policy)
          }
          console.log(`· ${source.name} 「${keyword}」第 ${page} 页：+${list.length}`)
          await sleep(1000)
        } catch (error) {
          errors.push(`${source.name}「${keyword}」p${page}: ${error.message}`)
          break
        }
      }
    }
  }

  // 同一篇政策可能被多个关键词命中：URL 去重后按发布时间倒序
  picked.sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  console.log(`\n抓到 ${picked.length} 条（已按 URL 去重）`)

  if (WANT_CONTENT) {
    const targets = picked.slice(0, Number(option('content-limit', '30')))
    console.log(`抓正文 ${targets.length} 条…`)
    for (const policy of targets) {
      policy.content = await fetchContent(policy.sourceUrl)
      policy.contentStatus = contentStatusOf(policy.content)
      if (!policy.content) console.log(`  ! 正文抓取失败：${policy.title.slice(0, 24)}（详情页会直接给官方链接）`)
      await sleep(900)
    }
  }

  if (DRY) {
    for (const policy of picked.slice(0, 12)) {
      console.log(`  ${policy.publishDate} [${policy.toolTypes.join('/')}] ${policy.title.slice(0, 42)} — ${policy.issuer.slice(0, 18)}`)
    }
    console.log('\n--dry：未写入任何文件')
    if (errors.length) console.log('错误：\n' + errors.join('\n'))
    return
  }

  // 合并：同 URL 覆盖，其余保留（湖南等地方条目暂时沿用既有数据）
  for (const policy of picked) byUrl.set(policy.sourceUrl, mergePolicy(byUrl.get(policy.sourceUrl), policy))
  for (const policy of picked) byId.set(policy.id, mergePolicy(byId.get(policy.id), policy))

  const merged = [...byId.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const live = merged.filter((item) => item.provenance && item.provenance.includes('国务院政策文件库')).length
  const mode = live === merged.length ? 'live' : live > 0 ? 'mixed' : 'seed'

  if (!fs.existsSync(BACKUP_FILE) && before.length > 0) {
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(existing, null, 2) + '\n', 'utf8')
    console.log(`已备份原数据到 ${path.relative(process.cwd(), BACKUP_FILE)}`)
  }

  const next = {
    dataset: {
      ...existing.dataset,
      name: existing.dataset?.name ?? '汽车政策研究库',
      mode,
      updatedAt: new Date().toISOString().slice(0, 10),
      note:
        mode === 'live'
          ? '由 scripts/ingest.mjs 从国务院政策文件库抓取，含官方原文链接。'
          : `混合数据：${live} 条来自国务院政策文件库，其余为示例种子或地方待接入条目。`,
      fields: existing.dataset?.fields ?? {}
    },
    policies: merged
  }

  backupBeforeWrite('POLICY_FILE');
  fs.writeFileSync(POLICY_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  console.log(`\n写入 ${path.relative(process.cwd(), POLICY_FILE)}：${merged.length} 条（live ${live}）mode=${mode}`)
  if (errors.length) console.log('\n未完成的源：\n' + errors.join('\n'))
}

main().catch((error) => {
  console.error('ingest 失败：', error)
  process.exit(1)
})