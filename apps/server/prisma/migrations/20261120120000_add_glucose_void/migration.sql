-- ============================================================
-- R25 血糖作废（软删除）：GlucoseRecord 加 voidedAt/voidedById + 两个审计动作
-- 规格：docs/specs/glucose-report-edit.md（2026-11-20 需求人评审通过，Q1a 软删除）
-- ============================================================
-- 医疗记录不得物理删除（等保三级 / AGENTS.md §5.2）：删除按**作废**实现，
-- voidedAt NULL = 有效、非空 = 已作废；全部读路径（报表/统计/最新血糖/幂等回读）排除已作废行。
--
-- ⚠️ 原全量唯一索引 "GlucoseRecord_patientId_measuredAt_key" 在本迁移中**删除**，
--    由部分唯一索引 glucose_record_active_unique（仅约束有效记录）替代——
--    否则作废记录仍占用 (patientId, measuredAt)，同一检测时间无法补录。
--    部分索引 Prisma 不支持，不在本迁移里：须在 migrate 之后手工执行一次
--    prisma/sql/glucose_record_active_unique.sql（幂等），与 ward_one_active.sql 同一套约定。
--    ⚠️ 两步之间唯一性暂时无兜底，应连续执行。
--
-- ⚠️ 两个枚举值**必须追加在 AuditAction 末尾**（PG 的 ALTER TYPE ADD VALUE 只能加末尾，
--    Prisma 漂移检测对枚举顺序敏感，见 20261118000000_add_virtual_ward 注释）。
--    本迁移不插入数据，不受"同一事务内不得使用新值"限制。
--
-- voidedById 外键 Restrict：作废人是医疗留痕，删用户不得抹掉（与 operator 同理）。

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_VOID';

-- AlterTable
ALTER TABLE "GlucoseRecord"
  ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
  ADD COLUMN "voidedById" UUID;

-- DropIndex（被部分唯一索引替代，见文件头注释）
DROP INDEX "GlucoseRecord_patientId_measuredAt_key";

-- AddForeignKey
ALTER TABLE "GlucoseRecord" ADD CONSTRAINT "GlucoseRecord_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
