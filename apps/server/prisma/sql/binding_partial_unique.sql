-- ============================================================
-- 绑定关系完整性约束：一台设备同时只能绑定一个有效患者
-- ============================================================
-- Prisma 不支持「部分唯一索引」，因此该约束必须用原生 SQL 补充。
-- 执行时机：prisma migrate deploy 之后手工执行一次（幂等）。
--
-- 业务规则：
--   同一 deviceId 只能存在一条 unboundAt IS NULL 的绑定记录。
--   解绑时写入 unboundAt，历史绑定保留用于追溯。
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS patient_device_binding_one_active
    ON "PatientDeviceBinding" ("deviceId")
    WHERE "unboundAt" IS NULL;

-- 校验：若存在重复的有效绑定，上面这条语句会失败，
-- 需先人工清理脏数据再执行：
-- SELECT "deviceId", COUNT(*) FROM "PatientDeviceBinding"
--   WHERE "unboundAt" IS NULL GROUP BY "deviceId" HAVING COUNT(*) > 1;
