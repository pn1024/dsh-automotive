/**
 * 国家法律法规数据库 · 湖南省地方性法规入库
 *
 *   node scripts/ingest-flk.mjs            # 抓取并合并
 *   node scripts/ingest-flk.mjs --dry      # 只看命中
 *
 * 数据源：https://flk.npc.gov.cn/law-search/search/list（官方检索接口，POST JSON）
 * 只取制定机关含「湖南」且标题与汽车/道路运输相关的条目。
 *
 * 限制（已在 README 标注）：该库只给元数据，正文在内部 OSS（172.16.x 内网），
 * 公开端拿不到全文，因此 contentStatus 记为 none，只保留官方详情链接。
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

const MAX_PAGES = Number(option('pages', '5'))
const RATE_MS = 800
const ENDPOINT = 'https://flk.npc.gov.cn/law-search/search/list'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const KEYWORDS = option('keywords', '汽车,新能源汽车,车辆,机动车,道路运输,道路交通安全,电动自行车,停车,超限').split(',')
// 标题必须与车相关，避免把纯水利/消防类地方性法规带进来
const TITLE_RELEVANT = /汽车|车辆|机动车|道路运输|道路交通安全|电动自行车|停车|超限|公路/

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const strip = (value) => String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

async function search(keyword, pageNum, pageSize = 100) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'user-agent': UA,
      referer: 'https://flk.npc.gov.cn/',
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      searchRange: 1,
      searchType: 2,
      sxx: [],
      gbrqYear: [],
      flfgCodeId: [],
      zdjgCodeId: [],
      searchContent: keyword,
      pageNum,
      pageSize
    }),
    signal: AbortSignal.timeout(25000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function idOf(value) {
  let hash = 0
  for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) % 0xffffffff
  return `P-FLK-${String(hash).padStart(8, '0')}`
}

function levelOf(org) {
  if (/长沙市|株洲市|湘潭市|衡阳市|岳阳市|常德市|郴州市|邵阳市|益阳市|永州市|怀化市|娄底市|湘西/.test(org)) return 3
  return 2
}

function regionOf(org) {
  const city = org.match(/(长沙市|株洲市|湘潭市|衡阳市|岳阳市|常德市|郴州市|邵阳市|益阳市|永州市|怀化市|娄底市|湘西土家族苗族自治州)/)
  if (city) return { code: '430000', name: city[1] }
  return { code: '430000', name: '湖南省' }
}

async function main() {
  const found = new Map()

  for (const keyword of KEYWORDS) {
    let pageNum = 1
    let total = 0
    while (pageNum <= MAX_PAGES) {
      let payload
      try {
        payload = await search(keyword, pageNum)
      } catch (error) {
        console.log(`  ! 「${keyword}」第 ${pageNum} 页失败：${error.message}`)
        break
      }
      const rows = payload.rows ?? []
      total = payload.total ?? 0
      if (rows.length === 0) break

      for (const row of rows) {
        const org = strip(row.zdjgName)
        const title = strip(row.title)
        if (!/湖南/.test(org)) continue
        if (!TITLE_RELEVANT.test(title)) continue
        if (!row.bbbs) continue
        if (!found.has(row.bbbs)) found.set(row.bbbs, { ...row, title, org })
      }
      if (pageNum * 100 >= total) break
      pageNum += 1
      await sleep(RATE_MS)
    }
    console.log(`  「${keyword}」total=${total}，湖南车辆相关累计 ${found.size}`)
    await sleep(RATE_MS)
  }

  if (found.size === 0) {
    console.log('没有命中湖南车辆相关地方性法规')
    return
  }

  // 同一标题有多个版本时只留最新公布的
  const byTitle = new Map()
  for (const row of found.values()) {
    const key = row.title
    const existing = byTitle.get(key)
    if (!existing || String(row.gbrq ?? '') > String(existing.gbrq ?? '')) byTitle.set(key, row)
  }

  const records = []
  for (const row of byTitle.values()) {
    const level = levelOf(row.org)
    const region = regionOf(row.org)
    const url = `https://flk.npc.gov.cn/detail2.html?${Buffer.from(row.bbbs, 'utf8').toString('base64')}`
    records.push({
      id: idOf(row.bbbs),
      title: row.title,
      docNo: '',
      issuer: row.org,
      level,
      region: region.code,
      regionName: region.name,
      publishDate: String(row.gbrq ?? '').slice(0, 10),
      docType: strip(row.flxz) || '地方性法规',
      toolTypes: [/道路运输|道路交通安全/.test(row.title) ? '路权' : '标准'],
      supplyChain: ['整车'],
      nevSpecific: /新能源|电动/.test(row.title),
      summary: `${strip(row.flxz)}｜制定机关：${row.org}｜施行日期：${String(row.sxrq ?? '未标注').slice(0, 10)}`,
      content: '',
      contentStatus: 'none',
      clauses: [],
      sourceUrl: url,
      provenance: '国家法律法规数据库（地方性法规）',
      fetchedAt: new Date().toISOString(),
      versions: [{ versionNo: 1, date: String(row.gbrq ?? '').slice(0, 10), note: '首次入库（元数据，正文在官方详情页）' }]
    })
  }

  console.log(`\n去重后 ${records.length} 条湖南地方性法规：`)
  for (const record of records) {
    console.log(`  ${record.publishDate} | ${record.level === 3 ? '市州' : '省级'} | ${record.title}`)
  }

  if (DRY) {
    console.log('\n--dry：未写入')
    return
  }

  const doc = fs.existsSync(POLICY_FILE) ? JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) : { dataset: {}, policies: [] }
  const byUrl = new Map((doc.policies ?? []).filter((policy) => policy.sourceUrl).map((policy) => [policy.sourceUrl, policy]))
  const before = byUrl.size
  for (const record of records) byUrl.set(record.sourceUrl, { ...(byUrl.get(record.sourceUrl) ?? {}), ...record })

  const merged = [...byUrl.values()].sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1))
  const hunan = merged.filter((policy) => policy.region === '430000').length
  backupBeforeWrite('flk')
  doc.policies = merged
  doc.dataset = {
    ...doc.dataset,
    mode: 'live',
    updatedAt: new Date().toISOString().slice(0, 10),
    note: `政策来自国务院政策文件库、湖南省政府文件搜索、国家法律法规数据库与美国联邦公报；湖南条目 ${hunan} 条。`
  }
  fs.writeFileSync(POLICY_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log(`\n写入：${merged.length} 条（新增/更新 ${byUrl.size - before}，湖南合计 ${hunan}）`)
}

main().catch((error) => {
  console.error('国家法律法规数据库入库失败：', error.message ?? error)
  process.exit(1)
})