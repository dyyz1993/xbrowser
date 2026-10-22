/**
 * 博客园发布命令挂载（走共享发布层）。
 *
 * 实战验证（2026-10-23，postId 23405420）：博客园编辑器是 **Markdown 源码模式**
 * （`#md-editor` 是原生 textarea），不需要 Markdown→HTML 转换；发布按钮
 * 「发布草稿」是单层点击即最终提交。
 */
import {
  CNB_EDITOR_URL,
  cnbPublisher,
  registerPublishingCommands,
} from '../shared/publishing/index.js';

export function registerCnblogsPublishing(site: Parameters<typeof registerPublishingCommands>[0]): void {
  registerPublishingCommands(site, {
    editorUrl: CNB_EDITOR_URL,
    publisher: cnbPublisher,
    coverAnchor: /^>\s/,
  });
}
