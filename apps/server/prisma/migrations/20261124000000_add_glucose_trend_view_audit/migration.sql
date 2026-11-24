-- ============================================================
-- P3-7 血糖趋势图：AuditAction 新增 GLUCOSE_TREND_VIEW
--
-- 规格：docs/specs/glucose-trend.md §11（2026-11-24 需求人授权 AI 起草并执行）。
--
-- ⚠️ 枚举值**追加在 AuditAction 末尾**（PostgreSQL ALTER TYPE ADD VALUE 只能加到
--    pg_enum 末尾，Prisma 漂移检测对枚举顺序敏感，见 DB-MIGRATION-NOTES.md §2.3）。
--    GLUCOSE_TREND_VIEW 属**缺陷补登记**：趋势图 2026-11-24 上线时 @Audit 已在用该动作，
--    但枚举漏登记，PG 拒绝非法值 → 趋势审计行从未落表（拦截器吞错只打 console.error）。
--    本迁移应用后恢复留痕（detail 含 rangeFrom/rangeTo/count/mealContexts，白名单已同批加入）。
--    本迁移不插入审计数据，不受「同一事务内不得使用新枚举值」的限制（同 20261123000000 先例）。
--
-- 用 IF NOT EXISTS：幂等，若该值已被手工加入也不报错（PG12+ 支持，可在事务块内）。
--
-- 无新表、无新列、无存量回填；PG 枚举值不可删，回滚 = 不回滚（留存无害）。
-- ============================================================

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GLUCOSE_TREND_VIEW';
