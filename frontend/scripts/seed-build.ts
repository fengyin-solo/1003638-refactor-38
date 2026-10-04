/**
 * 示例数据构建：npm run seed:build 运行。
 * 单一数据源就是本文件，产物 seed.generated.json 提交进仓库，
 * 应用读产物、部署检查校验产物，保证三处（开发环境/示例数据/部署）看到的数据一致。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { MODULES } from '@/data/modules'
import { CURRENT_SCHEMA_VERSION, migrateAll } from '@/domain/legacy'
import { TREE_FIELDS } from '@/domain/legacy-constants'
import type { EntryRow } from '@/data/types'

// 经 esbuild 打包后入口位于临时目录，路径一律相对前端工程根目录（运行时 cwd）解析。
const here = resolve(process.cwd(), 'scripts')
const OUT_FILE = resolve(here, '..', 'src', 'data', 'seed.generated.json')

type SeedEnvelope = {
  version: number
  generatedAt: string
  rows: Record<string, EntryRow[]>
}

function makeRows(key: string): EntryRow[] {
  const meta = MODULES.find((item) => item.key === key)!
  return [1, 2, 3].map((seq) => {
    const row: EntryRow = {
      id: seq,
      status: meta.statuses[Math.min(seq - 1, meta.statuses.length - 1)],
      pending: true,
      abnormal: seq === 2,
    }
    meta.fields.forEach((field, index) => {
      // 日期列给稳定日期，其余列用「模块名样例N」，保持与首版示例一致的占位风格。
      if (field.includes('日期') || field.includes('时间') || field.includes('时段')) {
        row[field] = `2026-09-0${seq}`
      } else if (index === 0) {
        row[field] = `${key.slice(0, 4).toUpperCase()}-${String(seq).padStart(4, '0')}`
      } else {
        row[field] = `${meta.name}样例${seq}`
      }
    })
    return row
  })
}

/** 林木生长专用示例：覆盖录入、审核通过、复核失败（旧值进历史）、归档各环节。 */
function treegrowthRows(): EntryRow[] {
  const base = (id: number, status: string, extra: Record<string, string>): EntryRow => ({
    id,
    status,
    pending: status !== '已归档',
    abnormal: false,
    [TREE_FIELDS.recordCode]: `TREE-${String(id).padStart(4, '0')}`,
    [TREE_FIELDS.history]: '',
    ...extra,
  })
  return [
    base(1, '已录入', {
      [TREE_FIELDS.plotCode]: 'YD-2026-001',
      [TREE_FIELDS.forestArea]: '青松岭林区',
      [TREE_FIELDS.standType]: '马尾松纯林',
      [TREE_FIELDS.avgDbh]: '14.2',
      [TREE_FIELDS.avgHeight]: '11.6',
      [TREE_FIELDS.canopy]: '0.62',
      [TREE_FIELDS.investigator]: '陈海生',
      [TREE_FIELDS.batchCode]: '2026-09',
    }),
    base(2, '已审核', {
      [TREE_FIELDS.plotCode]: 'YD-2026-002',
      [TREE_FIELDS.forestArea]: '青松岭林区',
      [TREE_FIELDS.standType]: '杉木纯林',
      [TREE_FIELDS.avgDbh]: '18.5',
      [TREE_FIELDS.avgHeight]: '15.1',
      [TREE_FIELDS.canopy]: '0.71',
      [TREE_FIELDS.investigator]: '林晓东',
      [TREE_FIELDS.batchCode]: '2026-09',
    }),
    // 复核失败样例：旧测量值（胸径越界）已带批次进历史，当前列待补测。
    base(3, '需复核', {
      [TREE_FIELDS.plotCode]: 'YD-2026-003',
      [TREE_FIELDS.forestArea]: '白桦坡林区',
      [TREE_FIELDS.standType]: '阔叶混交林',
      [TREE_FIELDS.avgDbh]: '待补测',
      [TREE_FIELDS.avgHeight]: '待补测',
      [TREE_FIELDS.canopy]: '待补测',
      [TREE_FIELDS.investigator]: '周敏',
      [TREE_FIELDS.batchCode]: '2026-09',
      [TREE_FIELDS.history]: JSON.stringify([
        {
          batch: '2026-09',
          dbh: '260',
          height: '16.0',
          canopy: '0.68',
          reason: '平均胸径=260 超出合理区间 1~200',
          at: '2026-09-20 10:00',
        },
      ]),
    }),
    base(4, '已归档', {
      [TREE_FIELDS.plotCode]: 'YD-2025-104',
      [TREE_FIELDS.forestArea]: '白桦坡林区',
      [TREE_FIELDS.standType]: '针阔混交林',
      [TREE_FIELDS.avgDbh]: '22.0',
      [TREE_FIELDS.avgHeight]: '17.4',
      [TREE_FIELDS.canopy]: '0.35',
      [TREE_FIELDS.investigator]: '陈海生',
      [TREE_FIELDS.batchCode]: '2026-03',
    }),
    base(5, '已审核', {
      [TREE_FIELDS.plotCode]: 'YD-2026-005',
      [TREE_FIELDS.forestArea]: '红河谷林区',
      [TREE_FIELDS.standType]: '云南松纯林',
      [TREE_FIELDS.avgDbh]: '12.8',
      [TREE_FIELDS.avgHeight]: '9.7',
      [TREE_FIELDS.canopy]: '0.58',
      [TREE_FIELDS.investigator]: '林晓东',
      [TREE_FIELDS.batchCode]: '2026-09',
    }),
    // 旧数据样例：缺调查员、缺林分类型、缺调查批次、缺林区，构建时即走补全规则。
    base(6, '已录入', {
      [TREE_FIELDS.plotCode]: 'YD-2024-006',
      [TREE_FIELDS.forestArea]: '',
      [TREE_FIELDS.standType]: '',
      [TREE_FIELDS.avgDbh]: '10.4',
      [TREE_FIELDS.avgHeight]: '8.2',
      [TREE_FIELDS.canopy]: '0.51',
      [TREE_FIELDS.investigator]: '',
      [TREE_FIELDS.batchCode]: '',
    }),
  ]
}

/** 防火林带示例：所属林区与林木生长样例对齐，林带建议清单才能关联。 */
function firebeltRows(): EntryRow[] {
  const areas = ['青松岭林区', '白桦坡林区', '红河谷林区']
  return [1, 2, 3].map((seq) => {
    const status = ['完好', '有缺株', '需补植'][seq - 1]
    return {
      id: seq,
      status,
      pending: true,
      abnormal: seq === 2,
      '林带编号': `BELT-${String(seq).padStart(4, '0')}`,
      '林带名称': `青松防火林带${seq}号`,
      '所属林区': areas[seq - 1],
      '树种组成': '木荷、杨梅混交',
      '林带长度': '3200',
      '林带宽度': '15',
      '种植年份': '2019',
      '林带状态': status,
    }
  })
}

export function buildSeed(now = new Date('2026-10-01T08:00:00+08:00').toISOString()): SeedEnvelope {
  const draft: Record<string, EntryRow[]> = {}
  for (const meta of MODULES) {
    draft[meta.key] = meta.key === 'treegrowth' ? treegrowthRows() : meta.key === 'firebelt' ? firebeltRows() : makeRows(meta.key)
  }
  // 构建即迁移：旧数据缺调查员/林分类型/批次在此补全；重复构建结果幂等。
  const migrated = migrateAll(draft, 0)
  return {
    version: CURRENT_SCHEMA_VERSION,
    generatedAt: now,
    rows: migrated.rows,
  }
}

function main() {
  const envelope = buildSeed()
  mkdirSync(dirname(OUT_FILE), { recursive: true })
  writeFileSync(OUT_FILE, `${JSON.stringify(envelope, null, 2)}\n`, 'utf-8')
  const counts = Object.entries(envelope.rows)
    .map(([key, list]) => `${key}=${list.length}`)
    .join(' ')
  console.log(`[seed:build] wrote ${OUT_FILE}`)
  console.log(`[seed:build] schema v${envelope.version}; ${counts}`)
}

// 该脚本只作为入口经 scripts/run-ts.mjs 加载，直接执行即可；
// 不使用 import.meta.url === argv[1] 判断，因为打包产物位于临时文件。
main()
