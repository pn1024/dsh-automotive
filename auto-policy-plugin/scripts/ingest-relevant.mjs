/**
 * 正文相关性入库：抓标题里没有「汽车」、但正文含汽车条款的国家政策
 *
 *   node scripts/ingest-relevant.mjs                       # 近一年
 *   node scripts/ingest-relevant.mjs --since=2026-01-01 --until=2026-12-31
 *   node scripts/ingest-relevant.mjs --keywords=消费,设备更新,交通 --content-limit=60
 *   node scripts/ingest-relevant.mjs --dry
 *
 * 为什么需要它：
 *   大量利好政策的标题不含汽车（如《提振消费专项行动方案》《推动大规模设备更新…行动方案》），
 *   只按标题检索会漏掉。这里按主题词抓候选，再用正文汽车提及次数判断相关性。
 *
 * 方向判定（文本归类，不是量化评估）：
 *   利好：支持/鼓励/补贴/免征/减免/扩大/促进/推动/优化/便利
 *   约束：不得/禁止/限制/取消/退坡/收紧/处罚
 */
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

const PAGES = Number(option('pages', '2'))
const CONTENT_LIMIT = Number(option('content-limit', '80'))
const MIN_HITS = Number(option('min-hits', '3'))
const RATE_MS = 1100

function defaultWindow() {
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 1))
  const fmt = (d) => d.toISOString().slice(0, 10)
  return { since: fmt(start), until: fmt(end) }
}

const window = defaultWindow()
const SINCE = option('since', window.since)
const UNTIL = option('until', window.until)

// 主题词：覆盖消费、投资、设备、交通、能源、制造等可能带汽车条款的方向
const KEYWORDS = option(
  'keywords',
  '消费,设备更新,以旧换新,交通运输,物流,制造业,能源,城市更新,科技创新,扩大内需,服务业,绿色低碳'
).split(',')

const SEARCH = 'https://sousuo.www.gov.cn/search-gov/data'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

const AUTO_TEXT = /汽车|新能源汽车|智能网联|充换电|动力电池|整车|乘用车|商用车|车辆/g
// 非汽车领域：标题命中且汽车提及不足 10 次时丢弃（铁路、船舶、农业等）
const DROP_TITLE = /铁路|民航|船舶|水运|港口|农业|林业|水利|旅游|邮政|房车营地/
const DROP_TITLE_MIN_HITS = 10
const POSITIVE = /支持|鼓励|补贴|免征|减免|扩大|促进|推动|优化|便利|奖励|试点|推广|放开|不得限购/
const NEGATIVE = /不得|禁止|限制|取消|退坡|收紧|处罚|严禁|暂停/

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

async function search(q, page, type, t) {
  const url =
    SEARCH +
    '?' +
    new URLSearchParams({
      t,
      q,
      timetype: SINCE && UNTIL ? 'timezd' : 'timeqb',
      mintime: SINCE || '',
      maxtime: UNTIL || '',
      sort: 'pubtime',
      sortType: '1',
      searchfield: 'title',
      p: String(page),
      n: '100',
      type
    }).toString()
  const response = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://sousuo.www.gov.cn/' }, signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json()
  return payload?.searchVO?.listVO ?? []
}

function extractContent(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const patterns = [
    /<div[^>]+class="[^"]*(?:pages_content|TRS_Editor|article|content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|footer)/i,
    /<div[^>]+id="(?:UCAP-CONTENT|zoom|content)"[^>]*>([\s\S]*?)<\/div>/i
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (!match) continue
    const text = [...match[1].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((row) => strip(row[1]))
      .filter((line) => line.length > 10)
      .join('\n')
    if (text.length > 200) return text
  }
  return ''
}

async function fetchArticle(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.gov.cn/' }, signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return extractContent(await response.text())
}

const hitsOf = (text) => (String(text).match(AUTO_TEXT) || []).length

function directionOf(text) {
  const positive = (String(text).match(POSITIVE) || []).length
  const negative = (String(text).match(NEGATIVE) || []).length
  if (positive === 0 && negative === 0) return 'neutral'
  if (positive > negative) return 'positive'
  if (negative > positive) return 'negative'
  return 'neutral'
}

function classifyTools(text) {
  const tools = []
  if (/补贴|补助|奖励|专项资金/.test(text)) tools.push('补贴')
  if (/税|减免|免征/.test(text)) tools.push('税收')
  if (/充电|换电|加氢|基础设施/.test(text)) tools.push('基建')
  if (/标准|准入|认证|规范/.test(text)) tools.push('标准')
  if (/出口|进口|贸易|关税/.test(text)) tools.push('贸易')
  if (/以旧换新|报废更新|置换/.test(text)) tools.push('以旧换新')
  if (/限行|限购|牌照|路权/.test(text)) tools.push('路权')
  return tools.length > 0 ? tools : ['规划']
}

function idOf(url) {
  let hash = 0
  for (const char of String(url)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-REL-${String(hash).padStart(8, '0')}`
}

async function main() {
  const existing = new Set(
    (fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')).policies : [])
      .map((policy) => policy.sourceUrl)
      .filter(Boolean)
  )

  const candidates = new Map()
  for (const keyword of KEYWORDS) {
    for (const [type, t] of [['bwyzcwjk', 'zhengcelibrary_bm'], ['gwyzcwjk', 'zhengcelibrary_gw']]) {
      for (let page = 1; page <= PAGES; page += 1) {
        let rows = []
        try {
          rows = await search(keyword, page, type, t)
        } catch (error) {
          console.log(`  ! 「${keyword}」${type} 第 ${page} 页失败：${error.message}`)
          break
        }
        for (const row of rows) {
          const title = strip(row.title)
          const url = strip(row.url)
          const publishDate = String(row.pubtimeStr ?? '').replace(/\./g, '-').slice(0, 10)
          if (!title || !url) continue
          if (existing.has(url) || candidates.has(url)) continue
          candidates.set(url, { title, url, publishDate, issuer: strip(row.puborg ?? '国务院有关部门'), keyword })
        }
        if (rows.length === 0) break
        await sleep(RATE_MS)
      }
    }
    console.log(`  「${keyword}」候选累计 ${candidates.size}`)
  }

  console.log(`\n时间窗 ${SINCE} ~ ${UNTIL}，候选 ${candidates.size} 条`)

  const records = []
  let index = 0
  for (const item of candidates.values()) {
    if (index >= CONTENT_LIMIT) break
    index += 1
    let content = ''
    try {
      await sleep(RATE_MS)
      content = await fetchArticle(item.url)
    } catch (error) {
      continue
    }
    const hits = hitsOf(content)
    if (hits < MIN_HITS) continue
    if (DROP_TITLE.test(item.title) && hits < DROP_TITLE_MIN_HITS) {
      console.log(`  · 跳过（非汽车领域）${item.title.slice(0, 38)} 提及 ${hits}`)
      continue
    }
    const direction = directionOf(content)
    records.push({
      id: idOf(item.url),
      title: item.title,
      docNo: '',
      issuer: item.issuer,
      level: 1,
      region: '100000',
      regionName: '全国',
      publishDate: item.publishDate,
      docType: '政策文件',
      toolTypes: classifyTools(`${item.title} ${content}`),
      supplyChain: ['整车'],
      nevSpecific: /新能源|电动|充电/.test(`${item.title}${content}`),
      direction,
      autoMentions: hits,
      summary: content.replace(/\s+/g, ' ').slice(0, 160),
      content,
      contentStatus: content.length > 300 ? 'full' : 'none',
      clauses: [],
      sourceUrl: item.url,
      provenance: '国务院政策文件库（正文含汽车条款）',
      matchedKeyword: item.keyword,
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publishDate, note: '首次入库（正文相关性筛选）' }]
    })
    console.log(`  ✓ ${item.publishDate} 汽车提及 ${hits} 次 | ${direction === 'positive' ? '利好' : direction === 'negative' ? '约束' : '中性'} | ${item.title.slice(0, 40)}`)
  }

  console.log(`\n筛出正文含汽车条款的政策 ${records.length} 条`)
  if (DRY) {
    console.log('--dry：未写入')
    return
  }
  if (records.length === 0) return

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const record of records) byUrl.set(record.sourceUrl, { ...(byUrl.get(record.sourceUrl) ?? {}), ...record })
  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  backupBeforeWrite('relevant')
  doc.policies = merged
  doc.dataset = { ...doc.dataset, updatedAt: new Date().toISOString().slice(0, 10) }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`写入：${merged.length} 条（新增 ${byUrl.size - before}）`)
}

main().catch((error) => {
  console.error('正文相关性入库失败：', error.message ?? error)
  process.exit(1)
})