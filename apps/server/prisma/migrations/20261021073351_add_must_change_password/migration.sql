-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_CHANGE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
