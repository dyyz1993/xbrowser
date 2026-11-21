import { defineConfig } from 'tsup';

/**
 * 构建指纹：每次构建注入新的 buildId（36 进制时间戳）。
 * daemon /health 上报，CLI 连接时比对——同 package version 但 dist 已重建的
 * "旧 daemon 跑旧代码" 场景（调试黑洞，2026-11-21 实录）据此触发重启。
 * src 直跑（vitest / 未走 tsup）时回落 'dev'，比较自动失效。
 */
const buildDefine = {
  __XB_BUILD_ID__: JSON.stringify(Date.now().toString(36)),
};

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    external: ['undici'],
    define: buildDefine,
  },
  {
    entry: ['bin/cli.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['undici'],
    define: buildDefine,
  },
  {
    entry: ['src/daemon/daemon-main.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    external: ['undici'],
    define: buildDefine,
  },
  {
    entry: ['src/data-collector/index.ts'],
    format: ['esm'],
    dts: true,
    clean: false,
    external: ['undici'],
    define: buildDefine,
  },
]);
