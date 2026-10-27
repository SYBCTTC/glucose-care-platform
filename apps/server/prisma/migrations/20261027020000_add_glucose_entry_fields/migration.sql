-- 添加血糖（手工录入）所需字段：记录者 / 试纸数量 / 备注
-- 记录者可为空：历史数据与设备自动上报没有操作人，不编造归属；手工录入由应用层强制必填。
ALTER TABLE "GlucoseRecord" ADD COLUMN "operatorId" UUID;
ALTER TABLE "GlucoseRecord" ADD COLUMN "testStrip" INTEGER;
ALTER TABLE "GlucoseRecord" ADD COLUMN "remark" VARCHAR(500);

CREATE INDEX "GlucoseRecord_operatorId_idx" ON "GlucoseRecord"("operatorId");

ALTER TABLE "GlucoseRecord"
  ADD CONSTRAINT "GlucoseRecord_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 血糖录入审计动作（等保：增删改记录必须留痕）
ALTER TYPE "AuditAction" ADD VALUE 'GLUCOSE_CREATE';
