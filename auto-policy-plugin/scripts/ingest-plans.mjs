/**
 * 「十五五」专项规划入库：抓标题含「十五五」的国家规划，再按正文筛选与汽车相关的内容。
 *
 *   node scripts/ingest-plans.mjs                # 抓取并合并
 *   node scripts/ingest-plans.mjs --dry
 *   node scripts/ingest-plans.mjs --pages=3 --content-limit=40
 *
 * 为什么需要单独脚本：
 *   综合交通枢纽、碳达峰、扩大消费、产业基础能力提升等「十五五」规划正文里都有汽车条款，
 *   但标题不含汽车，普通标题检索抓不到。这里改为「先按标题抓候选，再按正文判相关性」。
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

const PAGES = Number(option('pages', '3'))
const CONTENT_LIMIT = Number(option('content-limit', '40'))
const KEYWORD = option('keyword', '十五五')
// 只保留十四五及以后的规划：更早的规划属于历史沿革，会让「当前政策」视图失真
const SINCE = option('since', '2021-01-01')
const RATE_MS = 1200
const SEARCH = 'https://sousuo.www.gov.cn/search-gov/data'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'

// 正文相关：至少出现 2 次汽车类词
const AUTO_TEXT = /汽车|新能源汽车|智能网联|充换电|动力电池|整车|乘用车|商用车/g
// 批次公告不是政策，排除
const EXCLUDE_TITLE = /道路机动车辆生产企业及产品|享受车船税减免优惠的节约能源/
// 与汽车无关的领域：标题命中且汽车提及不足 10 次时丢弃，避免铁路、农业类规划混入
const DROP_TITLE = /铁路|民航|船舶|水运|港口|农业|林业|水利|旅游|邮政/
const DROP_TITLE_MIN_HITS = 10
// 只收当前周期（十五五）的规划：检索会带回十四五等历史规划，标题不含关键词的一律跳过
const ONLY_KEYWORD_IN_TITLE = true

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
  const url = SEARCH + '?' + new URLSearchParams({
    t,
    q,
    timetype: 'timeqb',
    mintime: '',
    maxtime: '',
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
      .filter((t) => t.length > 10)
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

function autoHits(text) {
  return (String(text).match(AUTO_TEXT) || []).length
}

function idOf(url) {
  let hash = 0
  for (const char of String(url)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-PLAN-${String(hash).padStart(8, '0')}`
}

function classify(text) {
  const tools = []
  if (/补贴|补助|奖励/.test(text)) tools.push('补贴')
  if (/税|减免/.test(text)) tools.push('税收')
  if (/充电|换电|加氢|基础设施/.test(text)) tools.push('基建')
  if (/标准|准入|规范|认证/.test(text)) tools.push('标准')
  if (/出口|进口|贸易/.test(text)) tools.push('贸易')
  if (/以旧换新|报废更新/.test(text)) tools.push('以旧换新')
  return tools.length > 0 ? tools : ['规划']
}

async function main() {
  const existing = new Set(
    (fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')).policies : [])
      .map((policy) => policy.sourceUrl)
      .filter(Boolean)
  )

  const candidates = new Map()
  for (const [type, t] of [['bwyzcwjk', 'zhengcelibrary_bm'], ['gwyzcwjk', 'zhengcelibrary_gw']]) {
    for (let page = 1; page <= PAGES; page += 1) {
      let rows = []
      try {
        rows = await search(KEYWORD, page, type, t)
      } catch (error) {
        console.log(`  ! ${type} 第 ${page} 页失败：${error.message}`)
        break
      }
      for (const row of rows) {
        const title = strip(row.title)
        const url = strip(row.url)
        const publishDate = String(row.pubtimeStr ?? '').replace(/\./g, '-').slice(0, 10)
        if (!title || !url) continue
        if (EXCLUDE_TITLE.test(title)) continue
        if (SINCE && publishDate && publishDate < SINCE) continue
        if (ONLY_KEYWORD_IN_TITLE && !title.includes(KEYWORD)) continue
        if (existing.has(url) || candidates.has(url)) continue
        candidates.set(url, { title, url, publishDate, issuer: strip(row.puborg ?? '国务院有关部门') })
      }
      if (rows.length === 0) break
      await sleep(RATE_MS)
    }
  }

  console.log(`候选「${KEYWORD}」规划 ${candidates.size} 条（已排除库内与批次公告）`)

  const records = []
  let index = 0
  for (const item of candidates.values()) {
    if (!DRY && index >= CONTENT_LIMIT) break
    index += 1
    let content = ''
    try {
      await sleep(RATE_MS)
      content = await fetchArticle(item.url)
    } catch (error) {
      console.log(`  ! 正文失败 ${item.title.slice(0, 26)}：${error.message}`)
      continue
    }
    const hits = autoHits(content) + autoHits(item.title) * 2
    if (hits < 2) continue
    // 铁路、农业等领域的规划通常只有顺带提及，提及不足 10 次时不入库
    if (DROP_TITLE.test(item.title) && hits < DROP_TITLE_MIN_HITS) {
      console.log(`  · 跳过（非汽车领域）${item.title.slice(0, 40)} 提及 ${hits}`)
      continue
    }
    const record = {
      id: idOf(item.url),
      title: item.title,
      docNo: '',
      issuer: item.issuer,
      level: 1,
      region: '100000',
      regionName: '全国',
      publishDate: item.publishDate,
      docType: '专项规划',
      toolTypes: classify(`${item.title} ${content}`),
      supplyChain: ['整车'],
      nevSpecific: /新能源|电动|充电/.test(`${item.title}${content}`),
      summary: content.replace(/\s+/g, ' ').slice(0, 160),
      content,
      contentStatus: content.length > 300 ? 'full' : 'none',
      clauses: [],
      sourceUrl: item.url,
      provenance: '国务院政策文件库（五年规划·汽车条款）',
      planAutoMentions: hits,
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publishDate, note: '首次入库（按正文筛出汽车条款）' }]
    }
    records.push(record)
    console.log(`  ✓ ${item.publishDate} 汽车提及 ${hits} 次 | ${item.title.slice(0, 44)}`)
  }

  console.log(`\n筛出含汽车内容的规划 ${records.length} 条`)
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
  backupBeforeWrite('plans')
  doc.policies = merged
  doc.dataset = { ...doc.dataset, updatedAt: new Date().toISOString().slice(0, 10) }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`写入：${merged.length} 条（新增 ${byUrl.size - before}）`)
}

main().catch((error) => {
  console.error('十五五规划入库失败：', error.message ?? error)
  process.exit(1)
})