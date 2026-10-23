-- 移除血糖业务相关表（录入/查询/汇总/导出整体延后）
-- 说明：AuditAction 枚举中的 GLUCOSE_* 取值保留在库中（当前嵌入式 PG 版本不支持
-- ALTER TYPE DROP VALUE），因已无任何代码引用，属无害的轻微 schema drift。
-- 1) 删除血糖日汇总表（依赖患者）
DROP TABLE IF EXISTS "GlucoseDailySummary" CASCADE;
-- 2) 删除血糖记录核心表（含对患者/设备/操作人的外键，CASCADE 一并清理）
DROP TABLE IF EXISTS "GlucoseRecord" CASCADE;
