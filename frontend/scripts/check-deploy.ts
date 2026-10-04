/**
 * 部署检查：npm run check:deploy。
 * 1. 重新构建示例数据并与提交的 seed.generated.json 比对（防止手改产物）；
 * 2. 跑全部上线前规则检查；
 * 3. vue-tsc 类型检查 + vite 生产构建由 npm 脚本串联执行。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildSeed } from './seed-build'
import { runAllChecks } from '@/domain/preflight'

// 经 esbuild 打包后入口位于临时目录，路径一律相对前端工程根目录（运行时 cwd）解析。
const seedFile = resolve(process.cwd(), 'src', 'data', 'seed.generated.json')

function main() {
  let committed: { version: number; rows: Parameters<typeof runAllChecks>[0]['rows'] }
  try {
    committed = JSON.parse(readFileSync(seedFile, 'utf-8'))
  } catch {
    console.error('[check:deploy] 缺少示例数据产物，请先执行 npm run seed:build')
    process.exit(1)
  }

  const rebuilt = buildSeed()
  if (JSON.stringify(rebuilt.rows) !== JSON.stringify(committed.rows) || rebuilt.version !== committed.version) {
    console.error('[check:deploy] seed.generated.json 与构建器输出不一致，请执行 npm run seed:build 后重新提交')
    process.exit(1)
  }
  console.log('[check:deploy] 示例数据产物与构建器一致')

  const issues = runAllChecks(committed)
  for (const issue of issues) {
    const line = `[check:deploy][${issue.level}] ${issue.message}`
    if (issue.level === 'error') {
      console.error(line)
    } else {
      console.warn(line)
    }
  }
  const errors = issues.filter((issue) => issue.level === 'error').length
  if (errors > 0) {
    console.error(`[check:deploy] 发现 ${errors} 个阻断问题，禁止部署`)
    process.exit(1)
  }
  console.log('[check:deploy] 全部规则检查通过')
}

main()
