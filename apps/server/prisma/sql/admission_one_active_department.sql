-- ============================================================
-- 科室停留完整性约束：一次住院同时只能有一条"在科"记录（R24）
-- ============================================================
-- Prisma 不支持「部分唯一索引」，因此该约束必须用原生 SQL 补充。
-- 执行时机：prisma migrate deploy 之后手工执行一次（幂等）。
-- 与既有的 ward_one_active.sql / binding_partial_unique.sql 是同一套约定。
--
-- 业务规则：
--   同一 admissionId 只能存在一条 endedAt IS NULL 的科室停留记录。
--   转科时关闭旧行（写 endedAt）再开新行（同事务），历史全留用于追溯。
--
-- 为什么需要它：
--   转科功能（后续实现）的"先查后写"在并发下不安全；这条索引是最终兜底，
--   后到的写入撞 P2002，服务端捕获后按业务冲突返回。
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS admission_department_one_active
    ON "AdmissionDepartment" ("admissionId")
    WHERE "endedAt" IS NULL;

-- 校验：若同一住院存在多条在科记录，上面这条语句会失败，
-- 需先人工清理脏数据再执行：
-- SELECT "admissionId", COUNT(*) FROM "AdmissionDepartment"
--   WHERE "endedAt" IS NULL GROUP BY "admissionId" HAVING COUNT(*) > 1;
