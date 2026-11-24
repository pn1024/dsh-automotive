/**
 * 生成 Word 版研究报告（调用 build_research_docx.py）
 *
 *   node scripts/build-research-docx.mjs                 # 用最近有政策的月份
 *   node scripts/build-research-docx.mjs --month=2026-09
 *
 * Python 解释器优先用 DSH 运行时的内置 Python，找不到再退回 PATH 上的 python。
 * 生成结果写到 data/reports/policy-research-YYYY-MM.docx，面板通过 /report.docx 下载。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPolicyFinanceLinkage } from '../lib/linkage.js'
import { loadLibrary } from '../lib/store.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(HERE, '..')
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.join(PLUGIN_ROOT, 'data')

const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const hit = argv.find((item) => item.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function resolvePython() {
  const candidates = [
    process.env.DSH_PYTHON,
    'C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe',
    'python',
    'python3'
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-c', 'import docx'], { stdio: 'ignore', timeout: 20000 })
      return candidate
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

function latestPolicyMonth() {
  const file = path.join(DATA_DIR, 'policies.json')
  if (!fs.existsSync(file)) return ''
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  const months = [
    ...new Set(
      (doc.policies ?? [])
        .filter((item) => Number(item.level) !== 0 && /^\d{4}-\d{2}/.test(String(item.publishDate ?? '')))
        .map((item) => String(item.publishDate).slice(0, 7))
    )
  ].sort()
  return months.length > 0 ? months[months.length - 1] : ''
}

const month = option('month', '') || latestPolicyMonth()
if (!month) {
  console.error('没有可用的月份，无法生成报告')
  process.exit(1)
}

const python = resolvePython()
if (!python) {
  console.error('找不到可用的 Python（需要 python-docx）')
  process.exit(1)
}

const outDir = path.join(DATA_DIR, 'reports')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, `policy-research-${month}.docx`)

// 先把「政策-财报季度对照」用 lib 算好落盘，Python 侧只读不算，避免 PSI 出现两套实现
try {
  const library = loadLibrary(DATA_DIR)
  const rows = buildPolicyFinanceLinkage(library, { quarters: 6 })
  fs.writeFileSync(
    path.join(DATA_DIR, 'linkage.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), note: '由 lib/linkage.js 计算，供 Word 报告读取', rows }, null, 2) + '\n',
    'utf8'
  )
  console.log(`联动表 ${rows.length} 个季度已写入 data/linkage.json`)
} catch (error) {
  console.log('联动表计算失败（Word 中该表将留空）：', error.message)
}

execFileSync(
  python,
  [path.join(HERE, 'build_research_docx.py'), '--out', outPath, '--month', month],
  { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 180000 }
)

const stat = fs.statSync(outPath)
console.log(`Word 报告已生成：${path.relative(process.cwd(), outPath)}（${(stat.size / 1024).toFixed(0)}KB，月份 ${month}）`)