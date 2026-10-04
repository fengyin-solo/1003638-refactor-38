#!/usr/bin/env node
/**
 * 上线前部署检查。
 *
 * 检查项：
 *   1. 构建产物存在（先跑 npm run build）
 *   2. 示例数据 seed.json 结构完整，且与旧数据快照的样地编号一一对应（补全不改样地编号）
 *   3. 共用状态规则自检：已归档锁定、并发复核只落一次、要求复核清旧测量值
 *   4. 逐样地校验（必填字段、状态合法、需复核无旧测量值残留、历史带调查批次）
 *
 * 断点续跑：逐样地检查的进度写在 .deploy-check.state.json，每通过一个样地就落盘。
 * 检查中断（Ctrl+C、进程被杀）后重跑，会自动跳过已通过样地，从缺失样地继续；
 * 全部通过后状态文件自动清除。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  HISTORY_KEY,
  STATUS,
  STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  applyReview,
  applyTransition,
  checkHistoryBatch,
  checkPlot,
} from '../src/shared/treegrowth-rules.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const seedPath = `${root}src/data/seed.json`
const legacyPath = `${root}data/legacy-treegrowth.json`
const distEntry = `${root}dist/index.html`
const statePath = `${root}.deploy-check.state.json`

let failed = false

function fail(message) {
  failed = true
  console.error(`[check] ✗ ${message}`)
}

function pass(message) {
  console.log(`[check] ✓ ${message}`)
}

// ---- 1. 构建产物 -----------------------------------------------------------
if (existsSync(distEntry)) {
  pass('构建产物 dist/index.html 存在')
} else {
  fail('缺少构建产物，请先执行 npm run build')
}

// ---- 2. 示例数据结构与样地编号对齐 -----------------------------------------
if (!existsSync(seedPath)) {
  fail('缺少 src/data/seed.json，请先执行 npm run seed')
}
const seed = existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, 'utf8')) : {}
const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'))
const treegrowth = Array.isArray(seed.treegrowth) ? seed.treegrowth : []
const historyRows = Array.isArray(seed[HISTORY_KEY]) ? seed[HISTORY_KEY] : []

const legacyPlots = legacy.map((row) => String(row['样地编号'] ?? '')).sort()
const seedPlots = treegrowth.map((row) => String(row['样地编号'] ?? '')).sort()
if (legacyPlots.join('|') === seedPlots.join('|')) {
  pass(`样地编号与旧数据一致（${seedPlots.length} 个样地）`)
} else {
  fail(`样地编号与旧数据不一致：旧数据 ${legacyPlots.join(', ')}，示例数据 ${seedPlots.join(', ')}`)
}

const duplicated = seedPlots.filter((plot, index) => seedPlots.indexOf(plot) !== index)
if (duplicated.length === 0) {
  pass('样地编号无重复')
} else {
  fail(`样地编号重复：${[...new Set(duplicated)].join(', ')}`)
}

// ---- 3. 共用状态规则自检（纯内存，不落库） ----------------------------------
// meta 直接由共用流转表组装，检查的就是线上真正使用的那份规则。
const meta = {
  entity: '林木生长记录',
  statuses: [...STATUSES],
  actions: TRANSITIONS.map((rule) => rule.action),
  actionTargets: Object.fromEntries(TRANSITIONS.map((rule) => [rule.action, rule.to])),
  terminalStatuses: [...TERMINAL_STATUSES],
  flow: TRANSITIONS,
}

const archived = applyTransition(meta, { id: 1, status: STATUS.ARCHIVED }, '要求复核')
if (!archived.ok) {
  pass('已归档记录锁定，任何动作都被拒绝')
} else {
  fail('已归档记录仍可被改动')
}

const stale = applyTransition(
  meta,
  { id: 2, status: STATUS.REVIEWED, 记录编号: 'TREE-X', 样地编号: 'PLOT-X', 调查批次: '自检批次', 平均胸径: '20', 平均树高: '15', 郁闭度: '0.7' },
  '要求复核',
)
const residue = ['平均胸径', '平均树高', '郁闭度'].some((field) => stale.row?.[field])
if (stale.ok && !residue && stale.history?.['测量快照'] && stale.history?.['调查批次'] === '自检批次') {
  pass('要求复核后旧测量值已清走并快照进历史（带调查批次）')
} else {
  fail('要求复核后旧测量值仍残留，或历史缺少调查批次')
}

const recheck = { id: 3, status: STATUS.RECHECK, 记录编号: 'TREE-Y', 样地编号: 'PLOT-Y', 调查批次: '自检批次' }
const first = applyReview(meta, recheck, { pass: false })
const second = applyReview(meta, first.row ?? recheck, { pass: false })
if (first.ok && !second.ok) {
  pass('并发复核只落一次，重复请求被拒绝')
} else {
  fail('复核可被重复落库，并发守卫失效')
}

// ---- 4. 逐样地检查（断点续跑） ----------------------------------------------
/** @type {{ passed: string[] }} */
let state = { passed: [] }
if (existsSync(statePath)) {
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    state = { passed: [] }
  }
}
const done = new Set(state.passed)
const todo = treegrowth.filter((row) => !done.has(String(row['样地编号'] ?? '')))
if (done.size > 0) {
  console.log(`[check] 续跑：${done.size} 个样地已通过，剩余 ${todo.length} 个待检查`)
}

const saveState = () => writeFileSync(statePath, `${JSON.stringify({ passed: [...done] })}\n`)
const plotProblems = []
for (const row of todo) {
  const plot = String(row['样地编号'] ?? '')
  const problems = checkPlot(row)
  if (problems.length > 0) {
    plotProblems.push(`${plot || '(无样地编号)'}: ${problems.join('、')}`)
  } else {
    done.add(plot)
    saveState() // 每通过一个就落盘，中断后从缺失样地继续
  }
}
if (plotProblems.length > 0) {
  fail(`以下样地未通过检查：\n  ${plotProblems.join('\n  ')}`)
}

const historyProblems = checkHistoryBatch(historyRows)
if (historyProblems.length > 0) {
  fail(`历史记录问题：\n  ${historyProblems.join('\n  ')}`)
} else {
  pass(`历史记录 ${historyRows.length} 条均带调查批次`)
}

// ---- 汇总 -------------------------------------------------------------------
if (failed) {
  console.error(`[check] 未通过，进度已保存（${done.size}/${treegrowth.length} 个样地），修复后重跑将从缺失样地继续`)
  process.exit(1)
}
rmSync(statePath, { force: true })
pass(`全部 ${treegrowth.length} 个样地检查通过，可以上线`)
