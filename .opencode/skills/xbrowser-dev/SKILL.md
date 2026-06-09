---
name: xbrowser-dev
description: >
  xbrowser project development guide — plugin conventions, lint rules,
  marketplace publishing, config architecture, session lifecycle, and testing patterns.
  Use when: developing xbrowser itself, writing/modifying plugins, running lint scripts,
  publishing to marketplace, working on the xbrowser codebase, adding new commands,
  fixing plugin issues, or understanding project architecture.
  Triggers: "xbrowser plugin", "plugin convention", "lint script",
  "marketplace publish", "xbrowser dev", "xbrowser development",
  "xbrowser build", "xbrowser test", "ok fail pattern", "result schema",
  "requiresLogin", "loginConfig".
---

# xbrowser Plugin Development Guide

> 本 skill 的全局版本位于 `~/.config/opencode/skills/xbrowser-dev/`
> 包含完整插件规范 + 参考文档。以下为项目级特有内容。

## Build & Test

```bash
npm run build          # Build with tsup
npm run dev            # Watch mode
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run test           # Vitest (~1959 tests)
npm run test:e2e       # E2E tests
npm run validate       # typecheck + lint + build + test
```

### Pre-commit 钩子顺序

```
typecheck → ESLint → any-count → command-params → help-auto-gen →
result-schema → output-convention → plugin-metadata → plugin-code → requiresLogin
```

## 本地验证命令速查

```bash
# 单独跑 lint
node lint-scripts/check-plugin-code.mjs
node lint-scripts/check-plugin-metadata.mjs
node lint-scripts/check-result-schema.mjs

# 模拟 pre-commit
bash .husky/pre-commit

# 完整流水线
npm run validate
```

## Marketplace 发布

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890
npx xbrowser marketplace publish --dir .xcli/plugins/<name>

# 批量发布（dry-run）
bash scripts/batch-marketplace-publish.sh --dry-run
```

> 全局 skill 中包含完整的插件规范、package.json 字段要求、编码 10 条铁律、login 规则、翻页调试技巧等。
