/**
 * 生成 Word 版报告（Markdown → DOCX 单一来源）
 *
 *   node scripts/build-research-docx.mjs                 # 用最近有政策的月份
 *   node scripts/build-research-docx.mjs --month=2026-09
 *   node scripts/build-research-docx.mjs --brand=奇瑞
 *
 * 与旧版的关键区别：
 *   正文只由 lib/report.js 生成一份 Markdown，Word 只是它的排版结果。
 *   这样 Markdown 报告与 Word 报告的章节、数据、结论完全一致（都含宏观/中观/微观三层）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildLibraryOverview, buildOverview } from '../lib/overview.js'
import { lintReport, renderReport } from '../lib/report.js'
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

const library = loadLibrary(DATA_DIR)
const brand = option('brand', '奇瑞')
const month = option('month', '') || ''
const overview = buildOverview(library, { month: month || undefined, brand })

const markdown = renderReport(overview.analysis, {
  regionStats: overview.regionStats,
  libraryOverview: buildLibraryOverview(library),
  financials: library.financials,
  linkage: overview.linkage,
  salesMonths: library.monthly.length,
  sourceHealth: []
})
const lint = lintReport(markdown)

const outDir = path.join(DATA_DIR, 'reports')
fs.mkdirSync(outDir, { recursive: true })
const mdPath = path.join(outDir, `policy-research-${overview.month}.md`)
const outPath = path.join(outDir, `policy-research-${overview.month}.docx`)
fs.writeFileSync(mdPath, markdown, 'utf8')

const python = resolvePython()
if (!python) {
  console.error('找不到可用的 Python（需要 python-docx）')
  process.exit(1)
}

execFileSync(
  python,
  [path.join(HERE, 'md_to_docx.py'), '--md', mdPath, '--out', outPath],
  { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, timeout: 180000 }
)

const stat = fs.statSync(outPath)
const sections = (markdown.match(/^## /gm) || []).length
console.log(`\n月份 ${overview.month}｜品牌 ${brand}`)
console.log(`Markdown：${path.relative(process.cwd(), mdPath)}（${lint.words} 字）`)
console.log(`Word    ：${path.relative(process.cwd(), outPath)}（${(stat.size / 1024).toFixed(0)} KB）`)
console.log(`章节 ${sections} 个｜引用覆盖率 ${lint.citationCoverage}%｜质检 ${lint.ok ? '通过' : '未通过：' + lint.errors.join('；')}`)
console.log('两者内容一致（Word 由同一份 Markdown 渲染）')