/**
 * 湖南省级政策入库（走省政府站内「文件搜索」）
 *
 *   node scripts/ingest-hunan.mjs                 # 抓多组关键词并合并
 *   node scripts/ingest-hunan.mjs --dry           # 只看命中
 *   node scripts/ingest-hunan.mjs --pages=2       # 每个关键词翻几页
 *
 * 为什么用 curl 而不是 fetch：
 *   searching.hunan.gov.cn 对 Node 的 TLS/HTTP 指纹不应答（超时），curl.exe 稳定返回；
 *   hunan.gov.cn 则需要在 Node 里指定 ecdhCurve=prime256v1。两种通道都封装在这里。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const PAGES = Number(option('pages', '2'))
const CONTENT_LIMIT = Number(option('content-limit', '40'))
const RATE_MS = 3500

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const SEARCH_URL = 'https://searching.hunan.gov.cn/hunan/102000000/file'
const KEYWORDS = (option('keywords', '汽车,新能源汽车,充电,换电,智能网联')).split(',')

// 站内搜索按全文匹配，标题未必与汽车相关（天然气、储能、电价都会被带出来），
// 所以入库前必须过标题相关性，否则会污染政策库。
const TITLE_AUTO = /汽车|新能源|充电|换电|电动|车辆|二手车|报废|动力电池|智能网联|车规|整车|乘用车|商用车/

// 湖南站会转载国家文件，这类条目标题以部委名开头，应归为国家级而不是省级。
const NATIONAL_PREFIX = /^(国务院|中共中央|国家发展改革委|国家能源局|工业和信息化部|财政部|商务部|交通运输部|生态环境部|市场监管总局|国家税务总局)/
// 标题里带这些文号前缀的，也是国家文件（湖南站转载）
const NATIONAL_DOCNO = /(发改能源〔|发改办能源〔|国发〔|国办发〔|工信部联|财建〔|商建函〔)/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const stripTags = (value) =>
  String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

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

function curl(url, timeoutSec = 40) {
  return new Promise((resolve) => {
    execFile(
      'curl.exe',
      ['-s', '--max-time', String(timeoutSec), '-A', UA, url],
      { maxBuffer: 12 * 1024 * 1024, encoding: 'utf8', timeout: (timeoutSec + 10) * 1000 },
      (error, stdout) => {
        if (error && !stdout) {
          resolve({ ok: false, text: '', error: error.message })
          return
        }
        resolve({ ok: true, text: stdout ?? '' })
      }
    )
  })
}

/** 详情页走 Node https（需 TLS 曲线），失败再退回 curl。 */
function nodeGet(url, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const client = https.get(
      url,
      { headers: { 'user-agent': UA }, minVersion: 'TLSv1.2', ecdhCurve: 'prime256v1' },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => resolve({ ok: true, text: Buffer.concat(chunks).toString('utf8') }))
      }
    )
    client.on('error', (error) => resolve({ ok: false, error: error.message }))
    client.setTimeout(timeoutMs, () => client.destroy(new Error('timeout')))
  })
}

async function fetchDetail(url) {
  const direct = await nodeGet(url)
  if (direct.ok && direct.text.length > 500) return direct.text
  const viaCurl = await curl(url)
  return viaCurl.ok ? viaCurl.text : ''
}

function extractArticle(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const patterns = [
    /<div[^>]+class="[^"]*(?:TRS_Editor|pages_content|article[_-]?content|zwxl|content_box)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div/i,
    /<div[^>]+id="(?:zoom|UCAP-CONTENT|content|article|zoomcon)"[^>]*>([\s\S]*?)<\/div>/i,
    /<td[^>]+class="b12c"[^>]*>([\s\S]*?)<\/td>/i
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (!match) continue
    const text = paragraphsOf(match[1])
    if (text.length > 200) return text
  }
  return paragraphsOf(body)
}

function paragraphsOf(fragment) {
  return [...fragment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((text) => text.length > 12 && !/^(打印|关闭|分享|扫一扫|字体)/.test(text))
    .join('\n')
    .slice(0, 7000)
}

const TOOL_RULES = [
  ['补贴', /补贴|补助|奖励|专项资金/],
  ['税收', /购置税|车船税|税收|减免/],
  ['以旧换新', /以旧换新|报废更新|置换/],
  ['基建', /充电|换电|加氢|基础设施/],
  ['标准', /标准|准入|规范|认证|检验/],
  ['路权', /限行|通行|牌照|号牌/],
  ['贸易', /出口|进口|贸易/],
  ['双积分', /双积分|积分/],
  ['规划', /规划|行动|方案|意见|措施|计划|办法/]
]

const CHAIN_RULES = [
  ['动力电池', /动力电池|电池|锂电|正极|负极/],
  ['充换电', /充电|换电|加氢|补能/],
  ['智能网联', /智能网联|自动驾驶|车路云/],
  ['回收', /回收|梯次利用|拆解/],
  ['整车', /汽车|乘用车|商用车|整车|车辆/]
]

function classify(text) {
  const tools = TOOL_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  const chain = CHAIN_RULES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
  return { tools: tools.length ? tools : ['规划'], chain: chain.length ? chain : ['整车'] }
}

/** 解析文件搜索结果：标题、链接、文件类型、发文字号、发布日期。 */
function parseResults(html) {
  const blocks = html.split('<div class="resultbox">').slice(1)
  const items = []
  for (const block of blocks) {
    const link = block.match(/<div class="list-name">[\s\S]*?<a[^>]+href="([^"]+)"[^>]*title="([^"]*)"/)
    if (!link) continue
    const date = block.match(/发布日期<\/span><p>(\d{4}-\d{2}-\d{2})/) ?? block.match(/(\d{4}-\d{2}-\d{2})/)
    const docNo = block.match(/发文字号<\/span><p>([^<]+)</)
    const kind = block.match(/文件类型<\/span><p>([^<]+)</)
    items.push({
      url: link[1].trim(),
      title: stripTags(link[2]),
      publishDate: date ? date[1] : '',
      docNo: docNo ? stripTags(docNo[1]) : '',
      kind: kind ? stripTags(kind[1]) : ''
    })
  }
  return items
}

function idOf(url) {
  let hash = 0
  for (const char of String(url)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-HN-${String(hash).padStart(8, '0')}`
}

function issuerOf(title) {
  const hit = title.match(/^(湖南省[^关]{2,20}?(?:厅|局|委|办|政府|委员会))/)
  if (hit) return hit[1]
  if (title.startsWith('湖南省人民政府')) return '湖南省人民政府'
  return '湖南省直部门'
}

async function main() {
  const found = new Map()

  for (const keyword of KEYWORDS) {
    for (let page = 1; page <= PAGES; page += 1) {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`
      const result = await curl(url)
      if (!result.ok) {
        console.log(`  ! 「${keyword}」第 ${page} 页失败：${result.error}`)
        break
      }
      const items = parseResults(result.text)
      const total = (result.text.match(/相关结果约\s*(\d+)\s*个/) ?? [])[1]
      let added = 0
      for (const item of items) {
        if (!item.url || found.has(item.url)) continue
        // 站内搜索会把国务院/国家部委文件也带出来，这些已由国务院库覆盖，跳过避免重复。
        if (!/hunan\.gov\.cn/i.test(item.url)) continue
        if (!TITLE_AUTO.test(item.title)) continue
        found.set(item.url, item)
        added += 1
      }
      console.log(`  「${keyword}」第 ${page} 页：解析 ${items.length} 条，新增 ${added}（合计 ${found.size}，站内约 ${total ?? '?'}）`)
      if (items.length === 0) break
      await sleep(RATE_MS)
    }
  }

  const items = [...found.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  console.log(`\n合计 ${items.length} 份湖南文件`)

  const policies = []
  for (const [index, item] of items.entries()) {
    const { tools, chain } = classify(item.title)
    const isNational = NATIONAL_PREFIX.test(item.title) || NATIONAL_DOCNO.test(item.title)
    const record = {
      id: idOf(item.url),
      title: item.title,
      docNo: item.docNo,
      issuer: isNational ? issuerOf(item.title) : issuerOf(item.title),
      level: isNational ? 1 : 2,
      region: isNational ? '100000' : '430000',
      regionName: isNational ? '全国' : '湖南省',
      publishDate: item.publishDate,
      docType: item.kind || '文件',
      toolTypes: tools,
      supplyChain: chain,
      nevSpecific: /新能源|充电|换电|电动|汽车/.test(item.title),
      summary: '',
      content: '',
      contentStatus: 'none',
      clauses: [],
      sourceUrl: item.url.replace(/^http:/, 'https:'),
      provenance: '湖南省政府文件搜索',
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publishDate, note: '首次入库' }]
    }

    if (!DRY && index < CONTENT_LIMIT) {
      await sleep(RATE_MS)
      const html = await fetchDetail(record.sourceUrl)
      record.content = extractArticle(html)
      record.contentStatus = record.content.length > 300 ? 'full' : record.content.length > 0 ? 'short' : 'none'
      record.summary = record.content.replace(/\s+/g, ' ').slice(0, 160)
      if (!record.docNo) {
        const docNo = record.content.match(/[\u4e00-\u9fa5]{1,8}〔\d{4}〕\d+号/)
        if (docNo) record.docNo = docNo[0]
      }
      console.log(`  ${index + 1}/${items.length} ${record.contentStatus === 'full' ? '✓' : '×'} ${item.title.slice(0, 34)}`)
    }
    policies.push(record)
  }

  if (DRY) {
    for (const policy of policies.slice(0, 15)) {
      console.log(`  ${policy.publishDate} [${policy.toolTypes.join('/')}] ${policy.title.slice(0, 52)}`)
    }
    console.log('\n--dry：未写入')
    return
  }
  if (policies.length === 0) {
    console.log('没有命中，不写库')
    return
  }

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const policy of policies) byUrl.set(policy.sourceUrl, mergePolicy(byUrl.get(policy.sourceUrl), policy))

  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const hunan = merged.filter((policy) => policy.region === '430000').length
  backupBeforeWrite('hunan')
  doc.policies = merged
  doc.dataset = {
    ...doc.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `政策来自国务院政策文件库、湖南省政府文件搜索与美国联邦公报；湖南条目 ${hunan} 条。`
  }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n写入：${merged.length} 条（新增/更新 ${byUrl.size - before}，湖南合计 ${hunan}）`)
}

main().catch((error) => {
  console.error('湖南政策入库失败：', error.message ?? error)
  process.exit(1)
})