import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
export const version = pkg.version;

declare const __XB_BUILD_ID__: string | undefined;

/**
 * 构建指纹（tsup define 注入；每次构建必变）。
 * src 直跑（vitest/未走 tsup define）时为 'dev'，daemon-client 的 buildId
 * 比较对 'dev' 自动失效，避免测试环境误重启。
 */
export const buildId: string = typeof __XB_BUILD_ID__ !== 'undefined' ? __XB_BUILD_ID__ : 'dev';
