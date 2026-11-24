/**
 * 湖南省发展和改革委员会 · 通知公告入库
 *
 *   node scripts/ingest-fgw.mjs            # 扫描全部页并抓取相关条目
 *   node scripts/ingest-fgw.mjs --dry
 *   node scripts/ingest-fgw.mjs --pages=25
 *
 * 为什么走 PowerShell：该站与省工信厅一样，对 Node 与 curl 都不应答，只有 Windows
 * Invoke-WebRequest（schannel）能取；且频繁中断，需要退避重试。
 *
 * 栏目：/fgw/xxgk_70899/tzgg/newxxgklist_nochn.html（25 页 500 条）
 * 只收充电设施/新能源汽车相关；成品油价格调整通知属重复性价格公告，不入库。
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

const PAGES = Number(option('pages', '25'))
const RATE_MS = 1500
const BASE = 'https://fgw.hunan.gov.cn'
const LIST = '/fgw/xxgk_70899/tzgg'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// 只保留充电设施/新能源汽车类；成品油价格通知是重复性公告，不进政策库
const KEEP = /充电|换电|新能源汽车|电动汽车|智能网联|动力电池/
const DROP = /成品油价格/

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
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stdout = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: (timeoutSec + 30) * 1000
      })
      return { ok: true, html: Buffer.from(stdout.trim(), 'base64').toString('utf8') }
    } catch (error) {
      if (attempt === attempts) return { ok: false, error: String(error.message ?? error).slice(0, 80) }
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Seconds ${attempt * 6}`], { timeout: 40000 })
    }
  }
  return { ok: false, error: 'unknown' }
}

function listUrl(pageNo) {
  return pageNo === 1 ? `${BASE}${LIST}/newxxgklist_nochn.html` : `${BASE}${LIST}/newxxgklist_nochn_${pageNo}.html`
}

function extractContent(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const patterns = [
    /<div[^>]+class="[^"]*(?:TRS_Editor|pages_content|article[_-]?content|zwxl|content_box|article-content)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<(?:div|table|footer)/i,
    /<div[^>]+id="(?:zoom|UCAP-CONTENT|content|article|zoomcon)"[^>]*>([\s\S]*?)<\/div>/i
  ]
  for (const pattern of patterns) {
    const match = body.match(pattern)
    if (!match) continue
    const text = paragraphs(match[1])
    if (text.length > 150) return text
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

function idOf(url) {
  let hash = 0
  for (const char of String(url)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-HNFGW-${String(hash).padStart(8, '0')}`
}

async function main() {
  const found = new Map()

  for (let page = 1; page <= PAGES; page += 1) {
    const result = psFetch(listUrl(page))
    if (!result.ok) {
      console.log(`  page ${page} 失败，跳过`)
      await sleep(2500)
      continue
    }
    const items = [...result.html.matchAll(/<a[^>]+href="([^"]*t20\d{6}_\d+\.html)"[^>]*>([\s\S]{0,200}?)<\/a>/g)]
      .map((m) => ({
        href: m[1],
        raw: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      }))
      .filter((item) => item.raw.length > 6)

    let fresh = 0
    for (const item of items) {
      const date = item.raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? ''
      const title = item.raw.replace(/^\d{4}-\d{2}-\d{2}\s*/, '')
      if (DROP.test(title)) continue
      if (!KEEP.test(title)) continue
      const url = item.href.startsWith('http') ? item.href : BASE + item.href
      if (found.has(url)) continue
      found.set(url, { url, title, publishDate: date })
      fresh += 1
    }
    console.log(`  page ${page}: 解析 ${items.length} 条，相关新增 ${fresh}（累计 ${found.size}）`)
    await sleep(RATE_MS)
  }

  if (found.size === 0) {
    console.log('没有命中充电/新能源汽车相关通知')
    return
  }

  const records = []
  for (const item of found.values()) {
    const record = {
      id: idOf(item.url),
      title: item.title,
      docNo: '',
      issuer: '湖南省发展和改革委员会',
      level: 2,
      region: '430000',
      regionName: '湖南省',
      publishDate: item.publishDate,
      docType: '通知公告',
      toolTypes: [/充电|换电/.test(item.title) ? '基建' : '规划'],
      supplyChain: [/充电|换电/.test(item.title) ? '充换电' : '整车'],
      nevSpecific: /新能源|电动|充电/.test(item.title),
      summary: '',
      content: '',
      contentStatus: 'none',
      clauses: [],
      sourceUrl: item.url,
      provenance: '湖南省发展和改革委员会（通知公告）',
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: item.publishDate, note: '首次入库' }]
    }

    if (!DRY) {
      await sleep(RATE_MS)
      const detail = psFetch(item.url)
      if (detail.ok) {
        record.content = extractContent(detail.html)
        record.contentStatus = record.content.length > 300 ? 'full' : record.content.length > 0 ? 'short' : 'none'
        record.summary = record.content.replace(/\s+/g, ' ').slice(0, 160)
        const docNo = record.content.match(/[\u4e00-\u9fa5]{1,8}〔\d{4}〕\d+号/)
        if (docNo) record.docNo = docNo[0]
      }
      console.log(`    ${record.contentStatus === 'full' ? '✓' : '×'} ${record.title.slice(0, 40)}`)
    }
    records.push(record)
  }

  if (DRY) {
    for (const record of records) console.log(`  ${record.publishDate} | ${record.title.slice(0, 52)}`)
    console.log('\n--dry：未写入')
    return
  }

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const record of records) byUrl.set(record.sourceUrl, mergePolicy(byUrl.get(record.sourceUrl), record))

  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const hunan = merged.filter((policy) => policy.region === '430000').length
  backupBeforeWrite('fgw')
  doc.policies = merged
  doc.dataset = {
    ...doc.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `政策来自国务院政策文件库、湖南省政府文件搜索、省工信厅规范性文件、省发改委通知公告、国家法律法规数据库与美国联邦公报；湖南条目 ${hunan} 条。`
  }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n写入：${merged.length} 条（新增/更新 ${byUrl.size - before}，湖南合计 ${hunan}）`)
}

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
  console.error('省发改委入库失败：', error.message ?? error)
  process.exit(1)
})