# csdn draft 命令：一键发草稿（含图、掩码规则、草稿先行）

## 目标
csdn 插件新增 `draft` 命令：一篇文章 → 用户浏览器（chrome-bridge 通道）→ CSDN MD 编辑器草稿（含横版配图）。发布点击由用户在确认后完成（草稿先行铁律，LRN-006）。

## 已实战验证的能力（来源：2026-10-22 掘金发文战役，脚本在旧 worktree output/.scripts/）
1. **图片直传 CSDN CDN**（ERR-007 结案方案，csdn-exact-replica.mjs）：
   - helper 任务 tab 打开 mp.csdn.net/mp_blog/creation/editor
   - cfw-file-input 塞 File + change 事件 → 上传器发签名 XHR（bizapi resource-api/v1/image/direct/upload/signature）
   - XHR 响应截获（policy/signature/filePath/callbackUrl/callbackBody/callbackBodyType/customParam）
   - 按源码驼峰字段 1:1 组 OBS 表单（key=policy 解出的 filePath、AccessKeyId、signature、callbackUrl、callbackBody、callbackBodyType、x:customParam 平铺、file 最后）POST host
   - 回调返回最终 URL：i-blog.csdnimg.cn/direct/<md5>.png
2. **MD 编辑器写入**（csdn-fresh-final.mjs）：editor.csdn.net/md?not_checkout=1 → PRE.editor__inner 粘贴管线（ClipboardEvent text/plain，换行零丢失；旧富文本编辑器 textarea 会吃换行——勿用）
3. **标题**：.article-bar__title 原生 setter（隐藏态也可写）
4. **豆包生成配图**（doubao-gen.mjs）：task-open doubao → 新对话 → 图像生成模式 → ClipboardEvent paste prompt → rc_gen_image 轮询 → canvas 压缩回传；生成后 **sips 中心裁剪 1600×900 横版**（用户规范：配图一律横版）

## 用户规范（必须遵守）
- 配图横版 16:9
- 地址/用户名**明文**（引流可搜索，纯文本不会被判链接）——零外链铁律只禁超链接
- 草稿先行：填充→保存草稿→返回编辑器 URL 交用户确认；**命令默认不发布**

## 实现清单
- [ ] `.xcli/plugins/csdn/draft.ts`：draft 命令（--title --file --images 横版裁剪 --no-images）
- [ ] `.xcli/plugins/csdn/upload-image.ts`：直传函数（helper tab 复用、签名截获、OBS 表单）
- [ ] 结果 schema：{ draftUrl, imageUrls[], savedAt }；loginRequired: required
- [ ] 测试：mock bridge HTTP（tests/plugins/csdn-draft.test.ts）——签名表单字段断言（驼峰+x:平铺+file 最后）、MD 写入换行保零、掩码规则不适用断言
- [ ] 文档：docs/ 补 draft 命令条目

## 验证
npm run typecheck && npm run lint && npx vitest run tests/plugins/csdn-draft.test.ts，全绿后真机冒烟（bridge 连用户浏览器发一篇测试草稿）
