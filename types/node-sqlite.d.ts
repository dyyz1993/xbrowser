/**
 * node:sqlite 的最小环境声明。
 *
 * 运行时 Node >= 22.5 才有该模块（login-state 插件动态 import + try/catch 兜底）；
 * 本仓 @types/node 固定在 20.x，没有该模块的类型。等 @types/node 升到 >= 22.5
 * 后本文件应删除，避免与官方声明重复。
 */
declare module 'node:sqlite' {
  interface StatementSync {
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  }
  export class DatabaseSync {
    constructor(path: string, options?: Record<string, unknown>);
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
