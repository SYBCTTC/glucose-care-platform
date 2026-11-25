-- ============================================================
-- R28 血糖数据打印：AuditAction 新增 PATIENT_NAME_PLAIN_VIEW / GLUCOSE_PRINT
--
-- 规格：docs/specs/glucose-print.md §2（2026-11-25 需求人裁定 A1(b)/A2(a)：
-- 明文姓名接口访问即留痕 + 打印动作审计留痕）。
--
-- ⚠️ 枚举值**追加在 AuditAction 末尾**（PostgreSQL ALTER TYPE ADD VALUE 只能加到
--    pg_enum 末尾，Prisma 漂移检测对枚举顺序敏感，见 DB-MIGRATION-NOTES.md §2.3）。
--    本迁移不插入审计数据，不受「同一事务内不得使用新枚举值」的限制。
--
-- 无新表、无新列、无存量回填；PG 枚举值不可删，回滚 = 不回滚（留存无害）。
-- ============================================================

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_NAME_PLAIN_VIEW';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GLUCOSE_PRINT';
