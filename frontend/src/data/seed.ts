/**
 * 示例数据入口：内容由 `npm run seed:build` 从 scripts/seed-build.ts 生成到
 * seed.generated.json，本文件只做只读转发，禁止手写数据（部署检查会比对产物）。
 * 想改示例数据，请改构建器后重新生成。
 */
import envelope from './seed.generated.json'

import type { EntryRow } from './types'

type SeedEnvelope = {
  version: number
  generatedAt: string
  rows: Record<string, EntryRow[]>
}

export const SEED_ENVELOPE = envelope as SeedEnvelope
export const SEED_ROWS: Record<string, EntryRow[]> = SEED_ENVELOPE.rows
