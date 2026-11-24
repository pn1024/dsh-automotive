/**
 * 存量数据快照与回滚
 *
 *   node scripts/backup.mjs snapshot        # 立即给 policies/sales/sources 打一份快照
 *   node scripts/backup.mjs list            # 列出已有快照
 *   node scripts/backup.mjs restore <文件名> # 从快照恢复（会先给当前状态再打一份快照）
 *
 * 每次入库脚本写盘前都会自动调用 backupBeforeWrite()，避免误覆盖后无法回溯。
 * 快照保存在 data/archive/，默认保留最近 40 份。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.AUTO_POLICY_DATA_DIR || path.resolve(HERE, '../data')
const ARCHIVE = path.join(DATA_DIR, 'archive')
const KEEP = 40
const FILES = ['policies.json', 'sales.json', 'sources.json', 'source-health.json']

function stamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function prune() {
  const entries = fs
    .readdirSync(ARCHIVE)
    .filter((name) => name.endsWith('.json'))
    .sort()
  const groups = new Map()
  for (const name of entries) {
    const prefix = name.split('__')[0]
    const bucket = groups.get(prefix) ?? []
    bucket.push(name)
    groups.set(prefix, bucket)
  }
  for (const bucket of groups.values()) {
    const excess = bucket.length - KEEP
    for (let index = 0; index < excess; index += 1) {
      fs.unlinkSync(path.join(ARCHIVE, bucket[index]))
    }
  }
}

/**
 * 给当前数据打快照。返回快照目录，便于日志打印。
 * label 用来区分是哪个脚本触发的（policies / sales / manual …）。
 */
export function backupBeforeWrite(label = 'manual') {
  fs.mkdirSync(ARCHIVE, { recursive: true })
  const dir = path.join(ARCHIVE, `${stamp()}-${label}`)
  fs.mkdirSync(dir, { recursive: true })
  let copied = 0
  for (const name of FILES) {
    const from = path.join(DATA_DIR, name)
    if (!fs.existsSync(from)) continue
    fs.copyFileSync(from, path.join(dir, name))
    copied += 1
  }
  // 顶层再放一份 policies 的扁平副本，便于只靠文件名找回
  const policyFile = path.join(DATA_DIR, 'policies.json')
  if (fs.existsSync(policyFile)) {
    fs.copyFileSync(policyFile, path.join(ARCHIVE, `policies__${stamp()}__${label}.json`))
  }
  prune()
  return { dir, copied }
}

export function listSnapshots() {
  if (!fs.existsSync(ARCHIVE)) return []
  return fs
    .readdirSync(ARCHIVE)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => {
      const stat = fs.statSync(path.join(ARCHIVE, name))
      return { name, bytes: stat.size, at: stat.mtime.toISOString() }
    })
}

export function restoreSnapshot(name) {
  const source = path.join(ARCHIVE, name)
  if (!fs.existsSync(source)) throw new Error(`找不到快照：${name}`)
  backupBeforeWrite('before-restore')
  fs.copyFileSync(source, path.join(DATA_DIR, 'policies.json'))
  return path.join(DATA_DIR, 'policies.json')
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/backup.mjs')
if (isMain) {
  const command = process.argv[2] ?? 'snapshot'
  if (command === 'snapshot') {
    const result = backupBeforeWrite('manual')
    console.log(`已快照 ${result.copied} 个文件到 ${path.relative(process.cwd(), result.dir)}`)
  } else if (command === 'list') {
    const items = listSnapshots()
    if (items.length === 0) console.log('还没有快照')
    for (const item of items.slice(0, 20)) {
      console.log(`  ${item.name}  ${(item.bytes / 1024).toFixed(0)}KB  ${item.at}`)
    }
  } else if (command === 'restore') {
    const name = process.argv[3]
    if (!name) throw new Error('用法：node scripts/backup.mjs restore <快照文件名>')
    const target = restoreSnapshot(name)
    console.log(`已恢复到 ${target}（恢复前已为当前状态打快照）`)
  } else {
    console.log('用法：node scripts/backup.mjs [snapshot|list|restore <file>]')
  }
}