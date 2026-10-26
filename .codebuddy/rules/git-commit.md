---
description: Git 提交规范。AI 每次完成任务后必须自动提交，提交备注须符合本规范以便人工审查。
globs:
  - '**/*'
---

# Git 提交规则（AI 自动提交）

## 1. 提交时机

- **每次代码改动完成后，自动执行 `git commit` 并 `git push` 到远程**，无需用户确认。
- 一次原子任务 = 一次提交 = 一次推送。
- 任务未完成（编译不过、测试红）时**不得提交**。
- 提交前必须自查：
  - `git status --short`：确认无无关文件被带入
  - `git diff --stat`：单个提交建议 ≤ 400 行，超出则拆分

## 1.1 推送规则

- 推送目标：`origin` + 当前分支（默认 `main`），命令 `git push origin <branch>`。
- 推送前先 `git fetch`；若本地落后远程，先 `git pull --rebase` 再推。
- 推送失败（网络抖动、SSL reset、超时）：**重试 1 次**；仍失败则保留本地提交，明确告知用户"已提交未推送"及错误原文，不静默丢弃。
- 推送被拒（non-fast-forward / 权限）：**停止并向用户报告**，禁止 `--force`、禁止 `--force-with-lease` 到 `main`。
- 推送成功后，在回复中告知提交号与推送结果。

## 2. 提交粒度

| 改动内容 | 粒度 |
|---|---|
| 新增一个接口 | 1 次提交（service + controller + schema 一起） |
| 新增一个页面 | 1 次提交（页面 + api 封装 + 路由） |
| 修改单个函数/组件 | 1 次提交（含其测试） |
| `prisma/schema.prisma` 或 migration | **单独 1 次提交**，禁止与业务代码混合 |
| 鉴权 / 权限过滤 / 审计逻辑 | **单独 1 次提交** |
| 纯格式化、重命名、移动文件 | 单独 1 次提交，禁止与逻辑改动混合 |
| 依赖、CI、Docker、配置 | 单独 1 次提交 |

## 3. 备注格式

标题行：`<type>(<scope>): <中文简短描述>`，≤ 50 字符，动词开头，不加句号。

**type（只允许）**：`feat` `fix` `refactor` `perf` `test` `docs` `chore` `style` `revert`

**scope（只允许）**：`web` `server` `shared` `prisma` `auth` `patient` `device` `glucose` `audit` `system` `ci` `deps` `docs` `rules` `dev`（本地开发环境与工具脚本）

**正文模板**（4 个小标题必须齐全，无变化也写"无变化"）：

```
为什么：
- 触发改动的问题/需求

改了什么：
- 文件: 具体改动点

影响面：
- 接口：
- 权限/数据过滤：
- 审计日志：
- 数据库：

验证：
- pnpm typecheck ✅ / pnpm test <scope> ✅
- 手工验证：

关联：#<issue>
AI-Assisted: yes
```

`影响面` 四项是重点审查内容，涉及患者数据、权限、审计时必须写清"是否变化 + 变化点"。

## 4. 命令写法（PowerShell）

```powershell
git status --short
git diff --stat
git add <明确路径>          # 禁止 git add -A / git add .
git commit -m "<type>(<scope>): <描述>" -m "<正文>"
git fetch origin
git push origin main        # 提交后立即推送
```

## 5. 敏感目录

- `apps/server/prisma/`、鉴权/权限过滤/审计相关代码：**允许 AI 自动提交，无需事前确认**。
- 但这类提交必须：
  - 独立成一次提交（不与无关改动混合）
  - 正文 `影响面` 中明确标注"敏感变更，需人工评审"
  - 提交后向用户提示本次提交涉及敏感路径
- 提交被授权 ≠ 可以擅自扩大改动范围；schema/migration 的**改动内容**仍按 `AGENTS.md §6.5` 走人工审查。

## 6. 禁止清单

- ❌ 无信息量标题：`update` / `修改` / `fix bug` / `优化`
- ❌ 提交 `.env*`、密钥、证书、真实患者数据（只允许 `prisma/seed.ts` 脱敏数据）
- ❌ 提交 `node_modules`、`dist`、构建产物、大二进制
- ❌ 一个提交混装格式化 + 逻辑改动
- ❌ 提交编译不过 / 测试失败的中间态
- ❌ 用 `--amend` 改写已 push 的提交，或用 `--force` 推送 `main`
- ❌ 未经用户同意删除/回滚已推送的远程提交
