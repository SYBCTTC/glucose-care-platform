# 数据库迁移现状与已知漂移

> 用途：给下一次动 Prisma schema 的人（或 AI）一个准信，避免重复排查、避免用 `migrate dev` 触发重置。
> 最后核对：**2026-11-17**（本地嵌入式 PostgreSQL 实测 `prisma migrate status` + `migrate diff` + `pg_attribute`/`AuditLog` 只读查询）。

## 1. 当前状态

- 迁移已全部应用：`prisma migrate status` 返回 `Database schema is up to date!`。
- 迁移历史共 **13** 个目录，最新为 `20261117000000_drop_residual_glucose_enums`。
- **漂移已清零**（2026-11-17，提交 `3813f93`）：`prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` 输出 `-- This is an empty migration.`。
- 因此 `pnpm db:migrate`（`migrate dev`）不再会提示重置；但**新增迁移仍一律手写 SQL + `pnpm db:deploy`**（见 §3）。

## 2. 漂移核对记录（2026-11-17 已全部处置，保留作教训）

用 `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` 检查得到：

| # | 漂移项 | 实库 | schema 期望 | 核对结论与处置（2026-11-17） |
|---|---|---|---|---|
| 1 | 枚举 `EntryChannel`、`GlucoseKind`、`GlucoseUnit`、`MealContext`、`RecordStatus` | 仍存在 | 已删除 | `pg_attribute` 核对**无任何列引用** → ✅ 已 `DROP TYPE`（迁移 `20261117000000`，带引用前置检查） |
| 2 | `GlucoseRecord.operatorId` 外键行为 | `ON DELETE RESTRICT` | `SET NULL`（关系字段可空时的默认值） | ✅ 已**改 schema** 显式写 `onDelete: Restrict`，未动库，见 §2.2 |
| 3 | 枚举 `AuditAction` | **16 个值** | **13 个值** | ❌ 原判断"仅顺序不同、语义无变化"**是错的**；✅ 已把 3 个历史值**补回 schema** 并按实库顺序排列，未动库，见 §2.3 |

### 2.1 核对用 SQL（只读，可重复执行）

```sql
-- 残留枚举是否仍被列引用（返回 0 行才可 DROP TYPE）
SELECT c.relname, a.attname, t.typname
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_type t ON t.oid = a.atttypid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
  AND t.typname IN ('EntryChannel','GlucoseKind','GlucoseUnit','MealContext','RecordStatus');

-- 历史审计行是否在用将被删除的枚举值
SELECT action::text, COUNT(*) FROM "AuditLog" GROUP BY action ORDER BY 2 DESC;
```

### 2.2 `operatorId` 外键：方向要反过来改

`GlucoseRecord.operatorId` 是**医疗记录留痕**（`AGENTS.md` §4.4：手工录入必须记录医护 ID）。
`SET NULL` 意味着删除用户会抹掉血糖记录的录入人，与留痕要求冲突；实库的 `RESTRICT` 才是安全的一侧。
对照：`AuditLog.operatorId` 刻意**不建外键**（只存快照），正是为了审计不随用户删除而失真。

**处置（2026-11-17，已实施，提交 `3813f93`）**：在 `schema.prisma` 的 `operator User? @relation("GlucoseOperator", ...)` 上
显式写 `onDelete: Restrict`，让 schema 向实库靠拢；**没有**把库改成 `SET NULL`，未执行任何 DDL。
实测复核：`GlucoseRecord` 外键仍为 `patientId=c(CASCADE)`、`operatorId=r(RESTRICT)`。

### 2.3 `AuditAction`：diff 生成的 SQL 会直接失败

- 实库 16 值，比 schema 多 3 个：`GLUCOSE_VIEW`、`GLUCOSE_INPUT`、`GLUCOSE_EXPORT`（P3 血糖模块 2026-10-22 移除时的残留）。
- 实库 `AuditLog` 共 247 行，其中 **`GLUCOSE_VIEW` 11 行、`GLUCOSE_INPUT` 2 行**（`GLUCOSE_EXPORT` 0 行）。
- `migrate diff` 生成的是"重建类型"写法（**已实测取到该草案**）：
  `ALTER TABLE "AuditLog" ALTER COLUMN "action" TYPE "AuditAction_new" USING ("action"::text::"AuditAction_new")`，
  其中 `AuditAction_new` 只含 schema 的 13 个值。
- **推断（未实际执行该 DDL）**：`USING` 把 `'GLUCOSE_VIEW'::text` 转成不含该值的枚举，按 PostgreSQL 规则必然报
  `invalid input value for enum AuditAction_new`，整事务回滚，迁移失败。上面两条是实测数据，这一条是由它们推出的结论。
- 审计表 **append-only、留存 ≥ 180 天**（等保三级），**不得为了让迁移通过而删改这 13 行**。

**处置（2026-11-17，已实施，提交 `3813f93`）**：把 `GLUCOSE_VIEW` / `GLUCOSE_INPUT` / `GLUCOSE_EXPORT`
补回 `schema.prisma` 的 `AuditAction`，注明"历史值，仅用于读取旧审计行，**新代码禁止使用**"，
并**按实库 `pg_enum` 顺序重排**（16 值）。顺序与取值都对齐后差异消失，**无需重建类型、未执行任何 DDL**。

实测复核：`AuditAction` 仍为 16 值且顺序未变；`AuditLog` 行数完整（核对时 247 行，其后因功能验证新增至 250 行），
`GLUCOSE_VIEW` 11 行、`GLUCOSE_INPUT` 2 行仍可正常读出，未删改任何审计行。

## 3. 处置决定（2026-10-28 决定暂不清理 → 2026-11-17 经人工批准已清理完毕）

- ~~**暂不清理**~~ → **2026-11-17 已清理**，漂移清零（§1）。
- **新增迁移仍一律手写 SQL + `pnpm db:deploy`**，不用 `pnpm db:migrate`（`migrate dev`）：
  漂移虽已清零，但 `migrate dev` 在检测到任何不一致时会提示重置数据库，对含真实审计数据的库风险过高。
- 清理时的做法：先出 `migrate diff` 生成的 SQL 草案，人工确认后再建迁移目录；**不得在迁移里静默 `DROP` 数据列**。
- **2026-11-17 的关键教训：`migrate diff` 的产物不可直接采用。**

| 漂移项 | diff 草案 | 复核结论 | 实际处置 |
|---|---|---|---|
| 5 个残留枚举 | `DROP TYPE` × 5 | ✅ 可采纳（已核对无列引用） | 手写迁移 `20261117000000_drop_residual_glucose_enums`，带 `DO $$` 引用前置检查 |
| `AuditAction` | 重建类型 + `ALTER COLUMN ... USING` | ❌ 不可采纳，会因 13 行历史审计失败（§2.3） | **改 schema**：补回 3 个历史值 + 按实库顺序重排，未动库 |
| `operatorId` 外键 | `DROP CONSTRAINT` + 重建为 `SET NULL` | ❌ 方向错（§2.2） | **改 schema**：显式 `onDelete: Restrict`，未动库 |

即 3 项漂移里有 **2 项的正确修法是改 `schema.prisma` 向实库靠拢**，只有枚举残留需要真正动库。
两项 schema 改动经 2026-11-17 人工批准后实施（提交 `3813f93`）。

> 这 5 个残留枚举正是旧血糖模块为**规划中功能**预建、模块移除后没人清理的化石。
> 教训已写进 `docs/ERROR-CODES.md` §D5：不要为未实现的功能提前建表/枚举/错误码。

## 4. 决策记录（原「待决策」三项，2026-11-17 全部闭环）

| # | 事项 | 结论 | 影响 |
|---|---|---|---|
| 1 | 审计 `detail` 是否记录 `skipped` | ✅ **方案 A**（提交 `629b16c`）：`skipped` 加入 `AUDIT_DETAIL_ALLOW_LIST`，`result` 仍为 `SUCCESS`，三值语义不变 | 审计 `detail.skipped` 可区分"写入了"与"未重复保存"；已补拦截器单测 4 项 + 真实链路验证 |
| 2 | 库漂移清理（见 §2） | ✅ **已完成**（提交 `3813f93`）：2 项改 schema 向实库靠拢、1 项手写迁移 `DROP TYPE` × 5；`migrate diff` 已输出空迁移 | 漂移清零；仍按 §3 用手写 SQL + `db:deploy`，不用 `migrate dev` |
| 3 | `TIME_SLOTS` 静态白名单 | ✅ **已完成**（提交 `67804a4`）：改为服务端查 `TimeSlot` 表运行时校验；静态常量降级为仅 seed 源，删除 `getFallbackTimeSlots` / `getTimeSlotLabel` | 库里新增/停用时段无需改代码、无需发版；规格见 `docs/specs/glucose-timeslot-validation.md` |

## 5. 改动 schema 前的检查清单

1. `prisma migrate diff` 确认当前是否仍有漂移。
2. **不要直接把 diff 产物当迁移**，逐项判断"该改库还是该改 schema"：
   - 枚举：先跑 §2.1 第二条 SQL 查历史行是否在用将被删除的值；`AuditLog` 这类 append-only 表的历史值
     只能**补回 schema**，不得删行（留存 ≥ 180 天）。
   - 外键行为：先判断哪一侧符合合规要求（医疗记录留痕 → `Restrict`），再决定改库还是改 schema。
   - 残留类型：先用 §2.1 第一条 SQL 确认无列引用，再 `DROP TYPE`。
3. 手写迁移 SQL，必要时加前置数据检查（参考 `20261028000000_add_glucose_unique_patient_measured` 的 `DO $$ ... $$` 写法）。
4. `pnpm db:deploy` + `pnpm db:generate`。
5. `pnpm typecheck` / `pnpm test`，并回填 `AGENTS.md` §4 **与 `.codebuddy/rules/*`** 的口径（两处都要改，漏一处 AI 仍会按旧口径生成代码）。
