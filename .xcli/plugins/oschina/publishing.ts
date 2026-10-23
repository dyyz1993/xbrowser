/**
 * 开源中国发布命令挂载（走共享发布层）。
 *
 * 实战验证（2026-10-23，blog/19781123）：
 * - 编辑器是 Tiptap/ProseMirror，**必须用 `editor.commands.setContent(html)`**——
 *   `insertText` 与 `paste` 事件都被 ProseMirror 忽略（实测 paste 后内容为空）
 * - 清空必须用 `editor.commands.clearContent(true)`，否则不可编辑包裹节点残留
 *   导致内容重复堆叠
 * - 发布是**两层**：顶栏 `button.publish-btn` 只弹 Popconfirm，
 *   真正提交是弹窗内「确定并发布」
 */
import {
  OSC_EDITOR_URL,
  oscPublisher,
  registerPublishingCommands,
} from '../shared/publishing/index.js';

export function registerOschinaPublishing(site: Parameters<typeof registerPublishingCommands>[0]): void {
  registerPublishingCommands(site, {
    editorUrl: OSC_EDITOR_URL,
    publisher: oscPublisher,
    coverAnchor: /^>\s/,
  });
}
