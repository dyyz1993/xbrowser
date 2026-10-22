/**
 * CSDN 发布命令挂载（走共享发布层）。
 *
 * 实战验证（2026-10-22，articleId 168773369 已发布）：
 * - MD 编辑器正文必须走 ClipboardEvent paste（CodeMirror 只接受 paste，
 *   写 innerText 会被 reconciliation 回流清空）
 * - 图片直传 OBS 协议在 `upload-image.ts`（含表单字段契约与 URL 提取）
 */
import {
  CSDN_EDITOR_URL,
  csdnPublisher,
  registerPublishingCommands,
} from '../shared/publishing/index.js';

export function registerCsdnPublishing(site: Parameters<typeof registerPublishingCommands>[0]): void {
  registerPublishingCommands(site, {
    editorUrl: CSDN_EDITOR_URL,
    publisher: csdnPublisher,
    coverAnchor: /^>\s/,
    // draft / publish 已有专门实现（含 OBS 图片直传与 waitForHuman 人工门），
    // 这里只补一条走共享层、无人工门的快速通道
    commands: ['publish'],
    commandNames: { publish: 'publish-fast' },
  });
}
