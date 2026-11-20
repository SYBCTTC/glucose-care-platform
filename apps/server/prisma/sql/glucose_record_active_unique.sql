-- ============================================================
-- R25 血糖去重约束：同一患者同一检测时间只允许一条**有效**记录
-- ============================================================
-- 原全量唯一索引 "GlucoseRecord_patientId_measuredAt_key" 已由迁移
-- 20261120120000_add_glucose_void 删除；本部分唯一索引是其替代：
-- 只约束 voidedAt IS NULL 的有效记录，已作废记录不再占用时间戳，
-- 同一检测时间可以补录新记录（裁定 Q1a 软删除的连带变更，见规格 §2.1）。
--
-- Prisma 不支持部分唯一索引，因此必须用原生 SQL 补充。
-- 执行时机：prisma migrate deploy 之后手工执行一次（幂等）。
-- 与既有的 ward_one_active.sql / binding_partial_unique.sql 是同一套约定。
--
-- 为什么仍需要唯一索引兜底：
--   应用层"先查后写"在并发下不安全（两个请求同时查到"无记录"会双双写入）。
--   后到的写入撞 P2002，服务端按幂等返回 skipped=true（添加）或 41003（编辑改时间）。
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS glucose_record_active_unique
    ON "GlucoseRecord" ("patientId", "measuredAt")
    WHERE "voidedAt" IS NULL;
