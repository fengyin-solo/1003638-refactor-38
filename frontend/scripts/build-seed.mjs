#!/usr/bin/env node
/**
 * 示例数据构建：以上线前的旧数据（data/legacy-treegrowth.json）为源，
 * 跑共用补全规则生成 src/data/seed.json 里的林木生长部分，其余模块原样保留。
 *
 * 补全规则来自 src/shared/treegrowth-rules.mjs（与页面、部署检查同一份）：
 * 缺调查员 / 林分类型 / 调查批次时补默认值，样地编号一律不动。
 *
 * 用法：
 *   node scripts/build-seed.mjs              重新构建并写回 seed.json
 *   node scripts/build-seed.mjs --if-missing 仅当 seed.json 缺失时才构建（predev/prebuild 用）
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { HISTORY_KEY, backfillRow, checkPlot } from '../src/shared/treegrowth-rules.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const seedPath = `${root}src/data/seed.json`
const legacyPath = `${root}data/legacy-treegrowth.json`

if (process.argv.includes('--if-missing') && existsSync(seedPath)) {
  console.log('[seed] seed.json 已存在，跳过构建')
  process.exit(0)
}

if (!existsSync(seedPath)) {
  console.error('[seed] 缺少 src/data/seed.json，请先从版本库恢复基础示例数据')
  process.exit(1)
}

/** @type {Record<string, any[]>} */
const seed = JSON.parse(readFileSync(seedPath, 'utf8'))
/** @type {Array<Record<string, any>>} */
const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))

// 逐条补全旧数据；样地编号在补全前后必须完全一致。
const plotsBefore = legacy.map((row) => String(row['样地编号'] ?? ''))
let filled = 0
const treegrowth = legacy.map((row) => {
  const { row: next, changed } = backfillRow(row)
  if (changed) {
    filled += 1
  }
  return next
})
const plotsAfter = treegrowth.map((row) => String(row['样地编号'] ?? ''))
if (plotsBefore.join('|') !== plotsAfter.join('|')) {
  console.error('[seed] 补全改动了样地编号，已中止')
  process.exit(1)
}

const problems = treegrowth.flatMap((row) =>
  checkPlot(row).map((problem) => `${row['样地编号']}: ${problem}`),
)
if (problems.length > 0) {
  console.error(`[seed] 补全后仍有样地不合格：\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

// 示例历史：每条都带调查批次，演示「历史记录不丢批次」。
seed[HISTORY_KEY] = [
  {
    id: 1,
    status: '历史',
    pending: false,
    abnormal: false,
    记录编号: 'TREE-0003',
    样地编号: 'PLOT-0003',
    调查批次: '2026-09批次',
    动作: '要求复核',
    原状态: '已审核',
    新状态: '需复核',
    测量快照: JSON.stringify({ 平均胸径: '21.0', 平均树高: '15.8', 郁闭度: '0.66' }),
    时间: '2026-09-20T08:30:00.000Z',
  },
  {
    id: 2,
    status: '历史',
    pending: false,
    abnormal: false,
    记录编号: 'TREE-0004',
    样地编号: 'PLOT-0004',
    调查批次: '2026-08批次',
    动作: '确认归档',
    原状态: '已审核',
    新状态: '已归档',
    测量快照: '',
    时间: '2026-08-31T10:00:00.000Z',
  },
]
seed.treegrowth = treegrowth

writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`)
console.log(
  `[seed] 构建完成：林木生长 ${treegrowth.length} 条（补全 ${filled} 条），历史 ${seed[HISTORY_KEY].length} 条`,
)
