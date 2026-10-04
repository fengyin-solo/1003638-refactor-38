import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

import { runAllChecks } from '../domain/preflight'
import type { EntryRow } from '../data/types'

type SeedEnvelope = {
  version: number
  rows: Record<string, EntryRow[]>
}

const seedPath = fileURLToPath(new URL('../data/seed.generated.json', import.meta.url))

/**
 * 本地开发环境守卫：vite dev 启动时读取示例数据并跑上线前规则检查，
 * 有阻断问题直接让 dev server 启动失败，问题在上线前的本地阶段就暴露。
 */
export function devPreflight(): Plugin {
  return {
    name: 'forest-dev-preflight',
    apply: 'serve',
    buildStart() {
      let seed: SeedEnvelope
      try {
        seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as SeedEnvelope
      } catch (error) {
        throw new Error(
          `[dev-preflight] 示例数据缺失或不可读，请先执行 npm run seed:build：${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      const issues = runAllChecks(seed)
      for (const issue of issues) {
        const line = `[dev-preflight][${issue.level}] ${issue.message}`
        if (issue.level === 'error') {
          this.error(line)
        } else {
          this.warn(line)
        }
      }
      const errors = issues.filter((issue) => issue.level === 'error').length
      if (errors > 0) {
        throw new Error(`[dev-preflight] ${errors} 个阻断问题，请修复后再启动本地开发环境`)
      }
      // eslint-disable-next-line no-console
      console.info(`[dev-preflight] 规则检查通过（示例数据 schema v${seed.version}）`)
    },
  }
}
