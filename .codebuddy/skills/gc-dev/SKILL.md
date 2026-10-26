---
name: gc-dev
description: 启动、重启或停止本仓库的本地开发环境（嵌入式 PostgreSQL + NestJS 后端 3000 + Vite 前端 5173）。当用户说"启动项目""起一下前后端""服务是不是还活着""重启后端""停掉服务""环境没起来"或准备开始改代码前需要确认服务可用时使用。该 skill 会用增量判断跳过无变更步骤，比 pnpm dev 快约 5-8 秒，并输出可用的地址与演示账号。
---

# gc-dev：本地开发环境起停

## 用途

用一条命令把 PostgreSQL、后端、前端拉起来，并在服务已运行时秒退（幂等）。

相比 `pnpm dev`（每次固定跑 `sync:shared` + 全量 build）：

| 步骤 | `pnpm dev` | 本 skill | 依据 |
|---|---|---|---|
| `pnpm install` | 不跑 | 仅 `node_modules` 缺失时跑 | 依赖很少变 |
| 嵌入式 PostgreSQL | 手动 | 仅 5432 未监听时启动 | PG 可跨会话常驻 |
| `prisma generate` | 手动，约 7s | 仅 `schema.prisma` 比生成的 client 新时跑 | 6.9s 实测 |
| 共享包 `build` + `sync` | 每次都跑，约 5s | 仅 `packages/shared/src` 或 dist 副本过期时跑 | 2.95s + 2.06s 实测 |
| 清 Vite 预构建缓存 | 手动 | 仅在共享包同步后清 | 避免白屏事故（见 `shared-package` 规则） |
| 后端 `nest start --watch` | 必跑，约 12s | 3000 已监听则跳过 | tsc 全量编译，见下方"已知瓶颈" |
| 前端 `vite` | 必跑 | 5173 已监听则跳过 | 缓存命中后数秒内就绪 |

实测：冷启动约 12-13s（瓶颈是 Nest 的 tsc 全量编译）；全部已在运行时 < 1s。

## 使用方式

优先执行脚本，不要手工拼 `pnpm dev`：

```powershell
cd d:\Codes\AIProjects

node .codebuddy/skills/gc-dev/scripts/dev-up.mjs             # 启动（幂等）
node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --restart   # 先停后起
node .codebuddy/skills/gc-dev/scripts/dev-up.mjs --sync-shared  # 强制重建并同步共享包
node .codebuddy/skills/gc-dev/scripts/dev-down.mjs           # 停前后端，保留数据库
node .codebuddy/skills/gc-dev/scripts/dev-down.mjs --db      # 连数据库一起停
```

等价快捷命令（`package.json` 已注册）：

```powershell
pnpm dev:up
pnpm dev:down
```

## 判断规则

- 用户只是要"开始开发"：先跑 `dev-up.mjs`，把输出里的前端地址与演示账号回报给用户，不要自动打开浏览器。
- 启动失败：读 `.devtools/logs/{server,web,pg}.log` 的最后 20 行定位，再决定是重试还是报告。
- 改了 `packages/shared`：用 `--sync-shared` 起，或先按 `shared-package` 规则手工 build + sync + 清 `.vite`。
- 改了 `prisma/schema.prisma`：先 `pnpm db:migrate`，再用 `--generate` 起服务。
- 需要重置演示数据：`--seed`（会覆盖现有数据，覆盖前必须向用户确认）。

## 已知瓶颈（不要再重复排查）

- 后端冷启动约 12s 是 `nest start` 用 tsc 全量编译，`tsconfig.build.json` 显式关闭了 `incremental`（删除 dist 后靠 tsbuildinfo 跳产出会导致运行时缺文件）。要显著再降低只能换 SWC/tsx，但 `emitDecoratorMetadata` 依赖 tsc，且新增依赖需人工批准，不要擅自改动。
- 前端第二次启动快，是因为 `apps/web/node_modules/.vite` 缓存保留；`sync-shared` 每次重写 `@gc/shared/package.json` 会让缓存失效，所以必须避免无谓同步。
