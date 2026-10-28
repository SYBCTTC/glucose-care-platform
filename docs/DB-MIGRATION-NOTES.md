# 数据库迁移现状与已知漂移

> 用途：给下一次动 Prisma schema 的人（或 AI）一个准信，避免重复排查、避免用 `migrate dev` 触发重置。
> 最后核对：2026-10-28（血糖唯一约束落地当天）。

## 1. 当前状态

- 迁移已全部应用：`pnpm db:deploy` 可正常执行，本地开发库无未应用迁移。
- 迁移历史共 4 个目录，最新为 `20261028000000_add_glucose_unique_patient_measured`。

## 2. 已知漂移（schema.prisma 与实库不一致，尚未处理）

用 `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` 检查得到：

| # | 漂移项 | 实库 | schema 期望 |
|---|---|---|---|
| 1 | 枚举 `EntryChannel`、`GlucoseKind`、`GlucoseUnit`、`MealContext`、`RecordStatus` | 仍存在 | 已删除 |
| 2 | `GlucoseRecord.operatorId` 外键行为 | `ON DELETE RESTRICT` | `SET NULL`（关系字段可空时的默认值） |
| 3 | 枚举 `AuditAction` | 值与 schema 相同，仅**顺序**不同 | 顺序不一致，diff 会报一次 AlterEnum（重建类型，语义无变化） |

## 3. 处置决定（2026-10-28）

- **暂不清理**。清理会动到既有表与数据，且与业务无关，单独排期评审，不和功能改动混在一起。
- 因此**禁止用 `pnpm db:migrate`（`prisma migrate dev`）**：它会因漂移提示重置数据库。新增迁移一律手写 SQL + `pnpm db:deploy`。
- 清理时的做法：先出 `migrate diff` 生成的 SQL 草案，人工确认后再建迁移目录；**不得在迁移里静默 `DROP` 数据列**。

## 4. 待决策

| # | 事项 | 现状 | 影响 |
|---|---|---|---|
| 1 | 审计 `detail` 是否记录 `skipped` | 去重跳过时仍写一条 `GLUCOSE_CREATE` 且 `result = SUCCESS`，`skipped` 不在 `AUDIT_DETAIL_ALLOW_LIST` 中 | 审计有记录、库里没有数据，事后只能靠字段推断；改动属审计逻辑，需人工评审 |
| 2 | 库漂移清理（见 §2） | 未处理 | 每次 `migrate dev` 都会提示重置，容易误操作 |
| 3 | `TIME_SLOTS` 静态白名单 | 库里新增时段而 shared 未同步时，提交会被 10001 拒 | 属契约变更，需排期改为查 `TimeSlot` 表运行时校验 |

## 5. 改动 schema 前的检查清单

1. `prisma migrate diff` 确认当前是否仍有漂移。
2. 手写迁移 SQL，必要时加前置数据检查（参考 `20261028000000_add_glucose_unique_patient_measured` 的 `DO $$ ... $$` 写法）。
3. `pnpm db:deploy` + `pnpm db:generate`。
4. `pnpm typecheck` / `pnpm test`，并回填 `AGENTS.md` §4 的口径。
