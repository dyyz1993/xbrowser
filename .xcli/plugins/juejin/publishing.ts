/**
 * 掘金发布命令挂载（走共享发布层）。
 *
 * 实战验证（2026-10-22，post/7699027015432978482 已上线）。
 *
 * 注意：掘金有验证码风控。原实现用 `ctx.waitForHuman` 在发布前插入人工确认，
 * 协议层拿不到 ctx，因此**原 draft / publish 命令保留不动**——它们仍走
 * `ctx.page` 且带人工门。本挂载点供新命令（`publish-fast`）使用，跳过人工确认。
 */
import {
  JUEJIN_EDITOR_URL,
  juejinPublisher,
  registerPublishingCommands,
} from '../shared/publishing/index.js';

export function registerJuejinPublishing(site: Parameters<typeof registerPublishingCommands>[0]): void {
  registerPublishingCommands(site, {
    editorUrl: JUEJIN_EDITOR_URL,
    publisher: juejinPublisher,
    coverAnchor: /^>\s/,
    // 掘金已有 draft / publish（含人工确认门），这里只补一条无人工门的快速通道
    commands: ['publish'],
    commandNames: { publish: 'publish-fast' },
  });
}
