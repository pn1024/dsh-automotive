/**
 * 湖南省工业和信息化厅 · 规范性文件入库
 *
 *   node scripts/ingest-gxt.mjs              # 抓取并合并
 *   node scripts/ingest-gxt.mjs --dry        # 只看命中
 *   node scripts/ingest-gxt.mjs --pages=3    # 翻几页
 *
 * 为什么要走 PowerShell：
 *   该站对 Node 与 curl 的 TLS/HTTP 指纹都不应答（Node 超时、curl 返回 0 字节），
 *   只有 Windows 自带的 Invoke-WebRequest（schannel）能取到内容。
 *   为避免 PowerShell 5.1 的编码问题，命令里只传 ASCII，HTML 以 base64 回传再在 Node 里解码。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
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

const PAGES = Number(option('pages', '4'))
const CONTENT_LIMIT = Number(option('content-limit', '40'))
const RATE_MS = 2000
const BASE = 'https://gxt.hunan.gov.cn'
const LIST_PATH = '/gxt/xxgk_71033/zcfg/gfxwj'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 只保留与汽车产业相关的文件
const TITLE_AUTO = /汽车|新能源汽车|车辆|充电|换电|动力电池|智能网联|零部件|整车|工程机械|电动/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const strip = (value) =>
  String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

function psFetch(url, timeoutSec = 60, attempts = 3) {
  const command = [
    "$ErrorActionPreference='Stop'",
    "$ProgressPreference='SilentlyContinue'",
    `$r=Invoke-WebRequest -Uri '${url}' -UseBasicParsing -TimeoutSec ${timeoutSec} -Headers @{'User-Agent'='${UA}'}`,
    '[Convert]::ToBase64String($r.RawContentStream.ToArray())'
  ].join('; ')

  let lastError = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stdout = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: (timeoutSec + 30) * 1000 }
      )
      return { ok: true, html: Buffer.from(stdout.trim(), 'base64').toString('utf8') }
    } catch (error) {
      lastError = String(error.message ?? error).slice(0, 120)
      // 站点偶发超时，退避后重试
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Seconds ${attempt * 3}`], { timeout: 20000 })
    }
  }
  return { ok: false, error: lastError }
}

function listUrl(pageNo) {
  // 站点翻页规则：index.html / index_2.html / index_3.html …（第一页无下划线）
  return pageNo === 1 ? `${BASE}${LIST_PATH}/index.html` : `${BASE}${LIST_PATH}/index_${pageNo}.html`
}

/** 从 t20261120_34107682.html 里取日期 */
function dateOf(href) {
  const match = href.match(/t(\d{4})(\d{2})(\d{2})_\d+\.html/)
  if (!match) return ''
  return `${match[1]}-${match[2]}-${match[3]}`
}

/**
 * 列表是表格：<td><a href="...tYYYYMMDD_ID.html">标题</a></td><td>文号</td><td>日期</td>
 * 比只用锚文本更可靠，能同时拿到文号与发布日期。
 */
function parseList(html) {
  const items = []
  const rowPattern = /<tr[^>]*>([\s\S]{0,800}?)<\/tr>/g
  for (const row of html.matchAll(rowPattern)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])
    const link = row[1].match(/<a[^>]+href="([^"]*t\d{8}_\d+\.html)"[^>]*(?:title="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/)
    if (!link) continue
    const title = strip(link[2] || link[3])
    if (title.length < 6) continue
    const docNo = strip(cells[1] ?? '')
    const dateText = (row[1].match(/(20\d{2}-\d{2}-\d{2})/) ?? [])[1] ?? ''
    items.push({
      url: link[1].startsWith('http') ? link[1] : `${BASE}${link[1]}`,
      title,
      docNo: /〔\d{4}〕/.test(docNo) ? docNo : '',
      publishDate: dateText || dateOf(link[1])
    })
  }
  return items
}

function extractContent(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const patterns = [
    /<div[^>]+class="[^"]*(?:TRS_Editor|pages_content|article[_-]?content|zwxl|content_box|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|table|footer)/i,
    /<div[^>]+id="(?:zoom|UCAP-CONTENT|content|article|zoomcon)"[^>]*>([\s\S]*?)<\/div>/i,
    /<td[^>]+class="b12c"[^>]*>([\s\S]*?)<\/td>/i
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (!match) continue
    const text = paragraphs(match[1])
    if (text.length > 200) return text
  }
  return paragraphs(body)
}

function paragraphs(fragment) {
  return [...fragment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => strip(match[1]))
    .filter((text) => text.length > 12 && !/^(打印|关闭|分享|扫一扫|字体)/.test(text))
    .join('\n')
    .slice(0, 8000)
}

const TOOL_RULES = [
  ['补贴', /补贴|补助|奖励|专项资金/],
  ['税收', /购置税|车船税|税收|减免/],
  ['以旧换新', /以旧换新|报废更新|置换/],
  ['基建', /充电|换电|加氢|基础设施/],
  ['标准', /标准|准入|规范|认证|检验|导则|办法/],
  ['路权', /限行|通行|牌照|号牌/],
  ['贸易', /出口|进口|贸易/],
  ['双积分', /双积分|积分/],
  ['规划', /规划|行动|方案|意见|措施|计划|通知/]
]

function classify(title) {
  const tools = TOOL_RULES.filter(([, pattern]) => pattern.test(title)).map(([name]) => name)
  return tools.length > 0 ? tools : ['规划']
}

function idOf(url) {
  let hash = 0
  for (const char of String(url)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-HNGXT-${String(hash).padStart(8, '0')}`
}

async function main() {
  const found = new Map()

  for (let page = 1; page <= PAGES; page += 1) {
    const url = listUrl(page)
    const result = psFetch(url)
    if (!result.ok) {
      console.log(`  ! 第 ${page} 页失败：${result.error}`)
      break
    }
    const items = parseList(result.html)
    let fresh = 0
    for (const item of items) {
      if (found.has(item.url)) continue
      if (!TITLE_AUTO.test(item.title)) continue
      found.set(item.url, item)
      fresh += 1
    }
    console.log(`  第 ${page} 页：解析 ${items.length} 条，车辆相关新增 ${fresh}（累计 ${found.size}）`)
    if (items.length === 0) break
    await sleep(RATE_MS)
  }

  if (found.size === 0) {
    console.log('没有命中汽车相关规范性文件')
    return
  }

  const records = []
  let index = 0
  for (const item of found.values()) {
    const record = {
      id: idOf(item.url),
      title: item.title,
      docNo: item.docNo ?? '',
      issuer: '湖南省工业和信息化厅',
      level: 2,
      region: '430000',
      regionName: '湖南省',
      publishDate: item.publishDate,
      docType: '规范性文件',
      toolTypes: classify(item.title),
      supplyChain: ['整车'],
      nevSpecific: /新能源|电动|充电|换电/.test(item.title),
      summary: '',
      content: '',
      contentStatus: 'none',
      clauses: [],
      sourceUrl: item.url,
      provenance: '湖南省工业和信息化厅（规范性文件）',
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publishDate, note: '首次入库' }]
    }

    if (!DRY && index < CONTENT_LIMIT) {
      await sleep(RATE_MS)
      const detail = psFetch(record.sourceUrl)
      if (detail.ok) {
        record.content = extractContent(detail.html)
        record.contentStatus = record.content.length > 300 ? 'full' : record.content.length > 0 ? 'short' : 'none'
        record.summary = record.content.replace(/\s+/g, ' ').slice(0, 160)
        const docNo = record.content.match(/[\u4e00-\u9fa5]{1,8}〔\d{4}〕\d+号/)
        if (docNo) record.docNo = docNo[0]
      } else {
        console.log(`    ! 正文失败 ${record.title.slice(0, 22)}：${detail.error}`)
      }
      console.log(`  ${index + 1}/${found.size} ${record.contentStatus === 'full' ? '✓' : '×'} ${record.title.slice(0, 34)}`)
    }
    records.push(record)
    index += 1
  }

  if (DRY) {
    for (const record of records) console.log(`  ${record.publishDate} [${record.toolTypes.join('/')}] ${record.title.slice(0, 52)}`)
    console.log('\n--dry：未写入')
    return
  }
  if (records.length === 0) return

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const record of records) byUrl.set(record.sourceUrl, mergePolicy(byUrl.get(record.sourceUrl), record))

  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const hunan = merged.filter((policy) => policy.region === '430000').length
  backupBeforeWrite('gxt')
  doc.policies = merged
  doc.dataset = {
    ...doc.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `政策来自国务院政策文件库、湖南省政府文件搜索、省工信厅规范性文件、国家法律法规数据库与美国联邦公报；湖南条目 ${hunan} 条。`
  }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n写入：${merged.length} 条（新增/更新 ${byUrl.size - before}，湖南合计 ${hunan}）`)
}

/** 合并时保留更完整的正文，避免重复抓取把已有内容覆盖成空。 */
function mergePolicy(existing, incoming) {
  const merged = { ...(existing ?? {}), ...incoming }
  if ((!incoming.content || incoming.content.length === 0) && existing && existing.content) {
    merged.content = existing.content
    merged.contentStatus = existing.contentStatus
    merged.summary = incoming.summary || existing.summary || ''
  }
  if (existing && existing.docNo && !incoming.docNo) merged.docNo = existing.docNo
  return merged
}

main().catch((error) => {
  console.error('省工信厅入库失败：', error.message ?? error)
  process.exit(1)
})