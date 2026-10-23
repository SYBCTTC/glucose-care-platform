---
description: 共享包 @gc/shared 的改动流程。修改 packages/shared 下任何导出、类型、常量后必读，漏步骤会导致前端白屏。
globs: ["packages/shared/**", "apps/server/**", "apps/web/**"]
---

# 共享包改动流程（强制）

## 为什么有这条规则

`@gc/shared` 是**源码包**，但 `apps/web/node_modules/@gc/shared` 与 `apps/server/node_modules/@gc/shared`
是 `pnpm sync:shared` 拷过去的 **dist 副本**。应用运行时读的是副本，**不会自动跟着源码变**。
改了源码却漏同步，前端会拿到旧副本。

### 真实事故（2026-10-21）

在 `packages/shared/src/dict/roles.ts` 新增 `DATA_SCOPE_LABELS` 并在 `BasicLayout.tsx` 使用，
但只跑了 `sync:shared`（拷的是旧构建）+ Vite 依赖预构建缓存未更新，结果：

```
Uncaught TypeError: Cannot read properties of undefined (reading 'DEPARTMENT')
    at BasicLayout (BasicLayout.tsx:138:54)
```

**整个 React 树崩溃 → 首页白屏**。

## 改动 packages/shared 后必须按顺序执行

```powershell
cd d:\Codes\AIProjects

# 1. 重新编译共享包（src → dist）
pnpm --filter @gc/shared build

# 2. 把 dist 副本同步到 apps/server 与 apps/web
pnpm sync:shared

# 3. 前端：改了「新增/重命名导出」必须清 Vite 预构建缓存并重启 dev server
Remove-Item apps\web\node_modules\.vite -Recurse -Force
# 然后重启前端（pnpm dev）与后端（dist/main.js 或 pnpm dev）
```

| 改动类型 | 是否必须清 Vite 缓存 |
|---|---|
| 只改函数内部实现（导出名不变） | 否，HMR 通常够 |
| **新增 / 删除 / 重命名导出、类型、常量** | **是**，否则 Symbols 解析不到 → undefined |
| 改了 `dict/roles.ts`、`error/codes.ts` 这类被多处 import 的字典 | 是（保险起见） |

## 验证（三选一，别靠感觉）

```powershell
# A. 确认副本里已有新导出
Select-String -Path 'apps\web\node_modules\@gc\shared\dist\index.js' -Pattern '<新导出名>'
# 或查对应子模块，如 dist\dict\roles.js

# B. 确认 Vite 转译后能解析到符号
curl.exe -s http://127.0.0.1:5173/src/layouts/BasicLayout.tsx
# 应看到 const XXX = __vite__cjsImportN__gc_shared["XXX"]

# C. 三包类型检查全绿
pnpm typecheck
```

**前端组件里访问共享字典时用可选链兜底**，避免再次同步失败时整页白屏：

```ts
DATA_SCOPE_LABELS?.[profile.dataScope] ?? profile.dataScope
```

## 硬规则

1. **禁止在 `apps/*/node_modules/@gc/shared` 里直接改代码** —— 那是副本，下次 `sync:shared` 会被覆盖。
2. **禁止用相对路径跨包 import**（如 `../../../packages/shared/src/...`），必须 `import { X } from '@gc/shared'`。
3. **禁止把共享包逻辑复制到 app 里**（第二份实现必然走样）；要改就改 `packages/shared`。
4. 新增导出后**同时**更新 `packages/shared/src/index.ts` 的 re-export（漏了会导致 `undefined`）。
5. 改动涉及错误码 → 同时遵守 `.codebuddy/rules/error-codes.md`；
   涉及权限/数据范围 → 同时遵守 `.codebuddy/rules/permissions.md`。
6. 后端改的是 TS 源码：跑 `dist/main.js` 需 `pnpm exec nest build` 后重启；`pnpm dev` 会自动重编译。
