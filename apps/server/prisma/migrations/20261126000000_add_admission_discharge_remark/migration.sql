-- P2-6 患者出院：Admission 增加出院备注可空列
-- 规格：docs/specs/patient-discharge.md §2（2026-11-26 裁定 3，schema 变更需人工评审）
-- 可空列，不影响存量数据，无需回填；可在事务内执行
ALTER TABLE "Admission" ADD COLUMN "dischargeRemark" VARCHAR(255);
