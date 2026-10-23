-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED', 'LOCKED');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('IDLE', 'BOUND', 'OFFLINE', 'DISABLED');

-- CreateEnum
CREATE TYPE "GlucoseKind" AS ENUM ('BGM', 'CGM');

-- CreateEnum
CREATE TYPE "GlucoseUnit" AS ENUM ('MMOL_L', 'MG_DL');

-- CreateEnum
CREATE TYPE "EntryChannel" AS ENUM ('MANUAL', 'DEVICE', 'VENDOR_API');

-- CreateEnum
CREATE TYPE "MealContext" AS ENUM ('FASTING', 'PRE_MEAL', 'POST_MEAL', 'BEDTIME', 'RANDOM');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('NORMAL', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PATIENT_VIEW', 'PATIENT_MANAGE', 'GLUCOSE_VIEW', 'GLUCOSE_INPUT', 'GLUCOSE_EXPORT', 'DEVICE_VIEW', 'DEVICE_MANAGE', 'USER_MANAGE', 'DATA_EXPORT');

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "phoneCipher" VARCHAR(512),
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "departmentId" UUID NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" UUID NOT NULL,
    "patientNo" VARCHAR(32),
    "nameCipher" VARCHAR(512) NOT NULL,
    "nameMasked" VARCHAR(64) NOT NULL,
    "idCardCipher" VARCHAR(512),
    "idCardMasked" VARCHAR(64),
    "phoneCipher" VARCHAR(512),
    "phoneMasked" VARCHAR(32),
    "gender" VARCHAR(8),
    "birthDate" DATE,
    "bedNo" VARCHAR(32),
    "remark" VARCHAR(255),
    "departmentId" UUID NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "sn" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "manufacturer" VARCHAR(64),
    "firmwareVersion" VARCHAR(32),
    "status" "DeviceStatus" NOT NULL DEFAULT 'IDLE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastReportAt" TIMESTAMP(3),
    "calibratedAt" TIMESTAMP(3),
    "departmentId" UUID,
    "purchasedAt" TIMESTAMP(3),
    "warrantyUntil" TIMESTAMP(3),
    "remark" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientDeviceBinding" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unboundAt" TIMESTAMP(3),
    "operatorId" UUID,

    CONSTRAINT "PatientDeviceBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlucoseRecord" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "deviceId" UUID,
    "kind" "GlucoseKind" NOT NULL DEFAULT 'BGM',
    "channel" "EntryChannel" NOT NULL DEFAULT 'MANUAL',
    "valueMmolL" DECIMAL(4,1) NOT NULL,
    "rawValue" DECIMAL(7,2) NOT NULL,
    "rawUnit" "GlucoseUnit" NOT NULL DEFAULT 'MMOL_L',
    "mealContext" "MealContext",
    "measuredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operatorId" UUID,
    "dedupeKey" VARCHAR(160) NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'NORMAL',
    "remark" VARCHAR(200),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlucoseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlucoseDailySummary" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "statDate" DATE NOT NULL,
    "kind" "GlucoseKind" NOT NULL DEFAULT 'BGM',
    "recordCount" INTEGER NOT NULL,
    "avgValue" DECIMAL(5,2),
    "minValue" DECIMAL(4,1),
    "maxValue" DECIMAL(4,1),
    "lowCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "tirPercent" DECIMAL(5,2),
    "cvPercent" DECIMAL(5,2),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlucoseDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "operatorId" UUID,
    "operatorName" VARCHAR(64),
    "departmentId" UUID,
    "action" "AuditAction" NOT NULL,
    "targetType" VARCHAR(32),
    "targetId" UUID,
    "targetKey" VARCHAR(64),
    "ip" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "result" VARCHAR(16) NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_patientNo_key" ON "Patient"("patientNo");

-- CreateIndex
CREATE INDEX "Patient_departmentId_archivedAt_idx" ON "Patient"("departmentId", "archivedAt");

-- CreateIndex
CREATE INDEX "Patient_nameMasked_idx" ON "Patient"("nameMasked");

-- CreateIndex
CREATE UNIQUE INDEX "Device_sn_key" ON "Device"("sn");

-- CreateIndex
CREATE INDEX "Device_status_enabled_idx" ON "Device"("status", "enabled");

-- CreateIndex
CREATE INDEX "Device_departmentId_idx" ON "Device"("departmentId");

-- CreateIndex
CREATE INDEX "PatientDeviceBinding_patientId_unboundAt_idx" ON "PatientDeviceBinding"("patientId", "unboundAt");

-- CreateIndex
CREATE INDEX "PatientDeviceBinding_deviceId_unboundAt_idx" ON "PatientDeviceBinding"("deviceId", "unboundAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientDeviceBinding_deviceId_boundAt_key" ON "PatientDeviceBinding"("deviceId", "boundAt");

-- CreateIndex
CREATE UNIQUE INDEX "GlucoseRecord_dedupeKey_key" ON "GlucoseRecord"("dedupeKey");

-- CreateIndex
CREATE INDEX "GlucoseRecord_patientId_measuredAt_idx" ON "GlucoseRecord"("patientId", "measuredAt" DESC);

-- CreateIndex
CREATE INDEX "GlucoseRecord_patientId_mealContext_measuredAt_idx" ON "GlucoseRecord"("patientId", "mealContext", "measuredAt" DESC);

-- CreateIndex
CREATE INDEX "GlucoseRecord_patientId_status_measuredAt_idx" ON "GlucoseRecord"("patientId", "status", "measuredAt" DESC);

-- CreateIndex
CREATE INDEX "GlucoseRecord_deviceId_measuredAt_idx" ON "GlucoseRecord"("deviceId", "measuredAt" DESC);

-- CreateIndex
CREATE INDEX "GlucoseRecord_measuredAt_idx" ON "GlucoseRecord"("measuredAt");

-- CreateIndex
CREATE INDEX "GlucoseDailySummary_statDate_idx" ON "GlucoseDailySummary"("statDate");

-- CreateIndex
CREATE UNIQUE INDEX "GlucoseDailySummary_patientId_statDate_kind_key" ON "GlucoseDailySummary"("patientId", "statDate", "kind");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_operatorId_createdAt_idx" ON "AuditLog"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_targetKey_createdAt_idx" ON "AuditLog"("action", "targetKey", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDeviceBinding" ADD CONSTRAINT "PatientDeviceBinding_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDeviceBinding" ADD CONSTRAINT "PatientDeviceBinding_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientDeviceBinding" ADD CONSTRAINT "PatientDeviceBinding_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlucoseRecord" ADD CONSTRAINT "GlucoseRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlucoseRecord" ADD CONSTRAINT "GlucoseRecord_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlucoseRecord" ADD CONSTRAINT "GlucoseRecord_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlucoseDailySummary" ADD CONSTRAINT "GlucoseDailySummary_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

