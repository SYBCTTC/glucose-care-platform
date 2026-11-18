-- ============================================================
-- 虚拟病区完整性约束：一个患者同时只能有一条"在区"记录
-- ============================================================
-- Prisma 不支持「部分唯一索引」，因此该约束必须用原生 SQL 补充。
-- 执行时机：prisma migrate deploy 之后手工执行一次（幂等）。
-- 与既有的 binding_partial_unique.sql 是同一套约定。
--
-- 业务规则：
--   同一 patientId 只能存在一条 leftAt IS NULL 的进出记录。
--   移出时写入 leftAt，历史记录保留用于追溯（决策 7a：重复进出每次新建记录）。
--
-- 为什么需要它：
--   应用层已在 WardService.join 里先查后写并抛 44001，但"先查后写"在并发下不安全
--   （两个护士同时点「加入虚拟病区」会双双查到"未在区"）。这条索引是最终兜底，
--   后到的写入撞 P2002，服务端捕获后同样映射为 44001 WARD_ALREADY_JOINED。
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS virtual_ward_record_one_active
    ON "VirtualWardRecord" ("patientId")
    WHERE "leftAt" IS NULL;

-- 校验：若存在重复的在区记录，上面这条语句会失败，
-- 需先人工清理脏数据再执行：
-- SELECT "patientId", COUNT(*) FROM "VirtualWardRecord"
--   WHERE "leftAt" IS NULL GROUP BY "patientId" HAVING COUNT(*) > 1;
