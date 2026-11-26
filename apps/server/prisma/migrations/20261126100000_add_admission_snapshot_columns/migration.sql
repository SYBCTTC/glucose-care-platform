-- ============================================================
-- 出入院记录 Tab：Admission 增加当次住院快照四列
-- 规格：docs/specs/patient-admission-records.md §2（2026-11-26 需求人批准，schema 变更已人工评审）
-- ============================================================
-- 背景：住院号/责任医护只存 Patient 且每次办理住院覆盖写（P2-6），历史值丢失；操作人从未记录。
-- 四列均可空：存量旧行不回填（不拿现值造假历史），前端显示「-」（裁定 1/2）。
-- 写入方：建档（seq=1）与办理住院（seq+1）两条创建路径，operatorId = 当次登录账号（裁定 3）。

-- AlterTable
ALTER TABLE "Admission" ADD COLUMN "patientNo" VARCHAR(32);
ALTER TABLE "Admission" ADD COLUMN "doctorId" UUID;
ALTER TABLE "Admission" ADD COLUMN "nurseId" UUID;
ALTER TABLE "Admission" ADD COLUMN "operatorId" UUID;

-- AddForeignKey（默认 Restrict：用户被住院记录引用时不得删除，同 Patient.doctorId 口径）
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_nurseId_fkey" FOREIGN KEY ("nurseId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
