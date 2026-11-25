-- ============================================================
-- 患者控糖目标：新增 PatientGlucoseTarget / PatientAlertThreshold 两表
--                + AuditAction 追加 PATIENT_TARGET_UPDATE
--
-- 规格：docs/specs/patient-glucose-target.md §2（2026-11-25 需求人 6 轮裁定 A–Y；
--       裁定 D/F 定两表结构，裁定 H 授权 AI 起草并执行迁移，**仅本地开发库**）。
--
-- ⚠️ 枚举值**追加在 AuditAction 末尾**（PostgreSQL ALTER TYPE ADD VALUE 只能加到
--    pg_enum 末尾，Prisma 漂移检测对枚举顺序敏感，见 DB-MIGRATION-NOTES.md §2.3）。
--    本迁移不插入审计数据，不受「同一事务内不得使用新枚举值」的限制（同 20261124000000 先例）。
--
-- ⚠️ 本迁移**不含存量回填**（有意区别于 20261120000000_add_admission_records 的迁移内回填先例）：
--    按裁定 T，回填走独立两段式脚本 `pnpm db:backfill-targets`（默认试运行只统计不写库，
--    `-- --apply` 才真写），理由：① 可先看统计再决定 ② 可重跑 ③ 与建表解耦，
--    避免回填失败连带回滚表结构。脚本在任务 ② 交付。
--
-- 两表均不含患者身份明文（仅 patientId 外键 + 数值阈值），无脱敏/加密需求。
-- 外键 ON DELETE CASCADE：随患者删除（同 GlucoseRecord / Admission 口径）；
-- 审计行不连带删（append-only，留存 >= 180 天，AGENTS.md §5.3）。
--
-- 字段 NOT NULL 说明：裁定 V 定「清空上下限 = 删除该行」，不保留 null 空壳行，
-- 故 valueDown/valueUp/lowThreshold/highThreshold 均为 NOT NULL。
-- ============================================================

-- CreateTable
CREATE TABLE "PatientGlucoseTarget" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "timeSlotCode" VARCHAR(32) NOT NULL,
    "valueDown" DECIMAL(4,1) NOT NULL,
    "valueUp" DECIMAL(4,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientGlucoseTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAlertThreshold" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "lowThreshold" DECIMAL(4,1) NOT NULL,
    "highThreshold" DECIMAL(4,1) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientAlertThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientGlucoseTarget_patientId_timeSlotCode_key" ON "PatientGlucoseTarget"("patientId", "timeSlotCode");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAlertThreshold_patientId_key" ON "PatientAlertThreshold"("patientId");

-- AddForeignKey
ALTER TABLE "PatientGlucoseTarget" ADD CONSTRAINT "PatientGlucoseTarget_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientAlertThreshold" ADD CONSTRAINT "PatientAlertThreshold_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PATIENT_TARGET_UPDATE';
