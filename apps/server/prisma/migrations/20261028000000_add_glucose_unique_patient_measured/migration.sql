-- 血糖记录唯一约束兜底：同一患者同一检测时间只允许一条记录。
-- 重复提交（同一 measuredAt 连点、网络重试）由此约束拦下，服务端按幂等返回 skipped=true，不抛错。
--
-- 历史数据若已存在重复组，本迁移**直接失败并报出组数**，不静默删除医疗记录；
-- 需人工确认保留哪一条后再执行。本地开发库已核对：0 组重复。

DO $$
DECLARE
  dup_groups integer;
BEGIN
  SELECT COUNT(*) INTO dup_groups
  FROM (
    SELECT 1
    FROM "GlucoseRecord"
    GROUP BY "patientId", "measuredAt"
    HAVING COUNT(*) > 1
  ) t;

  IF dup_groups > 0 THEN
    RAISE EXCEPTION
      'GlucoseRecord 存在 % 组重复 (patientId, measuredAt)，请人工确认后清理，再执行本迁移', dup_groups;
  END IF;
END $$;

CREATE UNIQUE INDEX "GlucoseRecord_patientId_measuredAt_key"
  ON "GlucoseRecord"("patientId", "measuredAt");
