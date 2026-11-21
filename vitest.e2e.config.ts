import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 60000,
    // e2e 文件共享 9224 daemon 与 default 会话——并行文件互相 killAll/抢会话
    // （2026-11-21 实录：chain-plugin-session 的 beforeAll 清场连坐 m5-human-gate
    // 的 Chrome），必须文件级串行。
    fileParallelism: false,
  },
});
