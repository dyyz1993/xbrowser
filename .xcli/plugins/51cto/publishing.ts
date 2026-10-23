/**
 * 51CTO 发布命令挂载（走共享发布层）。
 *
 * 与 index.ts 里旧版 draft/publish 的关系：51CTO 编辑器 UI 已换代——
 * 旧实现基于 `.editor-dialog__wrapper` + `#submitForm` + 两级分类面板，
 * 新版是右侧「基础信息」面板（`button.edit-submit` → 分类 + 摘要 →
 * `button.release`）。旧选择器在新版页面已不存在，故统一走共享层。
 */
import {
  CTO_EDITOR_URL,
  ctoPublisher,
  deriveSummary,
  registerPublishingCommands,
} from '../shared/publishing/index.js';

export function register51ctoPublishing(site: Parameters<typeof registerPublishingCommands>[0]): void {
  registerPublishingCommands(site, {
    editorUrl: CTO_EDITOR_URL,
    publisher: ctoPublisher,
    deriveSummary,
    coverAnchor: /^>\s/,
  });
}
