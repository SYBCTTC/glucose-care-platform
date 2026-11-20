-- ============================================================
-- R24 血糖报告表单查询：新增 Admission / AdmissionDepartment 表
-- + 两个审计动作 + 存量数据回填
-- 规格：docs/specs/glucose-report-query.md（2026-11-20 需求人评审通过）
-- ============================================================
-- Admission：一行 = 一次住院（seq = 第几次，患者内唯一）；dischargedAt NULL = 在院。
-- AdmissionDepartment：一行 = 一次住院中在某科室的一段连续停留；endedAt NULL = 当前在科。
--
-- ⚠️ "每次住院至多一条进行中停留"由**部分唯一索引**保证，Prisma 不支持，不在本迁移里：
--    须在 `prisma migrate deploy` 之后手工执行一次 prisma/sql/admission_one_active_department.sql（幂等）。
--    与既有的 ward_one_active.sql / binding_partial_unique.sql 同一套约定。
--
-- ⚠️ 两个枚举值**必须追加在 AuditAction 末尾**（PostgreSQL ALTER TYPE ADD VALUE 只能加到
--    pg_enum 末尾，Prisma 漂移检测对枚举顺序敏感，见 DB-MIGRATION-NOTES.md §2.3）。
--    其中 GLUCOSE_REPORT_VIEW 是**缺陷补登记**：2026-11-19 报表上线时 @Audit 已使用该动作，
--    但枚举漏登记，PG 拒绝非法值 → 报表审计行从未落表（拦截器吞错）。本迁移补上后恢复留痕。
--    本迁移不插入审计数据，不受"同一事务内不得使用新枚举值"的限制。
--
-- 删除语义：patient 用 Cascade（住院/停留记录随患者删除；AuditLog.targetId 不建外键，
-- 删患者不会连带删审计）；department 用默认 Restrict（科室被住院记录引用时不得删除，
-- 与 Patient.departmentId 同口径）。

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_REPORT_VIEW';
ALTER TYPE "AuditAction" ADD VALUE 'ADMISSION_QUERY';

-- CreateTable
CREATE TABLE "Admission" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "admittedAt" TIMESTAMPTZ(3),
    "dischargedAt" TIMESTAMPTZ(3),
    "departmentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDepartment" (
    "id" UUID NOT NULL,
    "admissionId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admission_patientId_seq_key" ON "Admission"("patientId", "seq");

-- CreateIndex
CREATE INDEX "Admission_patientId_admittedAt_idx" ON "Admission"("patientId", "admittedAt" DESC);

-- CreateIndex
CREATE INDEX "AdmissionDepartment_admissionId_startedAt_idx" ON "AdmissionDepartment"("admissionId", "startedAt");

-- CreateIndex
CREATE INDEX "AdmissionDepartment_patientId_idx" ON "AdmissionDepartment"("patientId");

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDepartment" ADD CONSTRAINT "AdmissionDepartment_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDepartment" ADD CONSTRAINT "AdmissionDepartment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDepartment" ADD CONSTRAINT "AdmissionDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 存量回填（规格 §2.3）：每个患者生成 seq=1 的住院记录 + 首条科室停留。
-- 幂等（WHERE NOT EXISTS）：迁移重跑或先经双写入口产生记录的患者自动跳过。
-- 时间取 Patient 旧字段（admissionAt 可空 → 停留 startedAt 同空，裁定 Q7 口径）；
-- 在院患者 dischargedAt 为 NULL → 停留 endedAt 同 NULL（当前在科）。
-- ============================================================

INSERT INTO "Admission" ("id", "patientId", "seq", "admittedAt", "dischargedAt", "departmentId", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p."id", 1, p."admissionAt", p."dischargeAt", p."departmentId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Patient" p
WHERE NOT EXISTS (
    SELECT 1 FROM "Admission" a WHERE a."patientId" = p."id"
);

INSERT INTO "AdmissionDepartment" ("id", "admissionId", "patientId", "departmentId", "startedAt", "endedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", a."patientId", a."departmentId", a."admittedAt", a."dischargedAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Admission" a
WHERE NOT EXISTS (
    SELECT 1 FROM "AdmissionDepartment" ad WHERE ad."admissionId" = a."id"
);
