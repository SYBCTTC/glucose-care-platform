-- AlterEnum：新增"患者信息编辑"审计动作，与 PATIENT_CREATE（建档）、PATIENT_MANAGE（归档等管理动作）区分
ALTER TYPE "AuditAction" ADD VALUE 'PATIENT_UPDATE';
