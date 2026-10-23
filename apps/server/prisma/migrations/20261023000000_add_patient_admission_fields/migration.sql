-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('INPATIENT', 'DISCHARGED');

-- AlterTable
ALTER TABLE "Patient"
    ADD COLUMN "status" "PatientStatus" NOT NULL DEFAULT 'INPATIENT',
    ADD COLUMN "admissionAt" TIMESTAMP(3),
    ADD COLUMN "dischargeAt" TIMESTAMP(3),
    ADD COLUMN "doctorId" UUID;

-- CreateIndex
CREATE INDEX "Patient_departmentId_status_admissionAt_idx" ON "Patient"("departmentId", "status", "admissionAt");

-- CreateIndex
CREATE INDEX "Patient_doctorId_idx" ON "Patient"("doctorId");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
