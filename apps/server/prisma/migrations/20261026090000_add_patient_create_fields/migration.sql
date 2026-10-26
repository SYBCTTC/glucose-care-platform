-- AlterEnum：新增"患者建档"审计动作，与 PATIENT_MANAGE（编辑等管理动作）区分
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_CREATE';

-- AlterTable：性别放宽到 16 位（容纳 UNSPECIFIED），新增糖尿病类型/糖化血红蛋白/责任护士
ALTER TABLE "Patient"
    ADD COLUMN "diabetesType" VARCHAR(32),
    ADD COLUMN "hba1c" DECIMAL(4,1),
    ADD COLUMN "nurseId" UUID,
    ALTER COLUMN "gender" TYPE VARCHAR(16);

-- CreateIndex
CREATE INDEX "Patient_nurseId_idx" ON "Patient"("nurseId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
