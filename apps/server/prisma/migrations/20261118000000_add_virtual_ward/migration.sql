-- ============================================================
-- 虚拟病区（P2-8）：新增 VirtualWardRecord 表 + 两个审计动作
-- 规格：docs/specs/virtual-ward.md（2026-11-18 需求人评审通过）
-- ============================================================
-- 一条 VirtualWardRecord = 一次进出；leftAt 为 NULL 表示当前在区，非空即历史。
-- 重复进出每次新建记录、历史全留，因此同一患者可有多条历史 + 至多一条在区。
--
-- ⚠️ "至多一条在区"由**部分唯一索引**保证，Prisma 不支持，不在本迁移里：
--    须在 `prisma migrate deploy` 之后手工执行一次 prisma/sql/ward_one_active.sql（幂等）。
--    与既有的 prisma/sql/binding_partial_unique.sql 同一套约定。
--
-- ⚠️ 两个枚举值**必须追加在 AuditAction 末尾**：PostgreSQL 的 ALTER TYPE ADD VALUE
--    只能加到 pg_enum 末尾，而 Prisma 的漂移检测对枚举顺序敏感（本项目已因此踩过坑，
--    见 20261117000000_drop_residual_glucose_enums 的注释与 docs/DB-MIGRATION-NOTES.md §2.3）。
--    本迁移不插入数据，故不受"同一事务内不得使用新值"的限制。
--
-- 删除语义：patient 用 Cascade（进出记录无独立留存价值，审计行已单独留痕，
-- 且 AuditLog.targetId 不建外键，删患者不会连带删审计）；
-- 两个操作人用 Restrict（医疗留痕，删用户不得抹掉操作人，与 GlucoseRecord.operator 同理）。

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_WARD_JOIN';
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_WARD_REMOVE';

-- CreateTable
CREATE TABLE "VirtualWardRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),
    "joinedById" UUID NOT NULL,
    "leftById" UUID,
    "leaveReason" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualWardRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VirtualWardRecord_patientId_leftAt_idx" ON "VirtualWardRecord"("patientId", "leftAt");

-- CreateIndex
CREATE INDEX "VirtualWardRecord_leftAt_joinedAt_idx" ON "VirtualWardRecord"("leftAt", "joinedAt");

-- CreateIndex
CREATE INDEX "VirtualWardRecord_joinedById_idx" ON "VirtualWardRecord"("joinedById");

-- CreateIndex
CREATE INDEX "VirtualWardRecord_leftById_idx" ON "VirtualWardRecord"("leftById");

-- AddForeignKey
ALTER TABLE "VirtualWardRecord" ADD CONSTRAINT "VirtualWardRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualWardRecord" ADD CONSTRAINT "VirtualWardRecord_joinedById_fkey" FOREIGN KEY ("joinedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VirtualWardRecord" ADD CONSTRAINT "VirtualWardRecord_leftById_fkey" FOREIGN KEY ("leftById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

