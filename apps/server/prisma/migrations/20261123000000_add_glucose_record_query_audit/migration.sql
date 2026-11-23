-- ============================================================
-- R27 血糖记录列表：AuditAction 新增 GLUCOSE_RECORD_QUERY
--
-- 规格：docs/specs/glucose-record.md §2（2026-11-23 需求人评审通过，
-- 裁定 Q1 = 新增独立审计动作；裁定 Q6 = AI 起草、需求人评审）。
--
-- ⚠️ 枚举值**追加在 AuditAction 末尾**（PostgreSQL ALTER TYPE ADD VALUE 只能加到
--    pg_enum 末尾，Prisma 漂移检测对枚举顺序敏感，见 DB-MIGRATION-NOTES.md §2.3）。
--    本迁移不插入审计数据，不受「同一事务内不得使用新枚举值」的限制。
--
-- 无新表、无新列、无存量回填；PG 枚举值不可删，回滚 = 不回滚（留存无害）。
-- ============================================================

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_RECORD_QUERY';
