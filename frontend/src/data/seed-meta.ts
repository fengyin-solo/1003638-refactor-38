import { CURRENT_SCHEMA_VERSION } from '../domain/legacy'

/** 示例数据构建产物的元信息：构建脚本写入，应用与部署检查共同读取。 */
// 版本只有 domain/legacy 一个来源，避免示例数据与迁移规则版本漂移。
export const SEED_VERSION = CURRENT_SCHEMA_VERSION
export const SEED_BUILD_FILE = 'seed.generated.json'
export const SEED_STORAGE_VERSION_KEY = 'forest-fire-patrol:schema-version'
