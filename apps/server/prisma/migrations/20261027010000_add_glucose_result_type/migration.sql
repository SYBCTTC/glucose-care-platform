-- 血糖记录增加"结果类型"维度（0~9，取值见 @gc/shared DICT_TYPE.GLUCOSE_RESULT）
-- 既有数据按值区间回填（< 3.9 偏低 / 3.9~16.7 正常 / > 16.7 偏高），避免 NOT NULL 落不下来
ALTER TABLE "GlucoseRecord" ADD COLUMN "resultType" VARCHAR(2);

UPDATE "GlucoseRecord"
SET "resultType" = CASE
    WHEN "valueMmolL" < 3.9 THEN '0'
    WHEN "valueMmolL" <= 16.7 THEN '1'
    ELSE '2'
END
WHERE "resultType" IS NULL;

ALTER TABLE "GlucoseRecord" ALTER COLUMN "resultType" SET NOT NULL;

-- 非数值类型（3 Low / 4 High / 5~9 拒检等）没有具体读数
ALTER TABLE "GlucoseRecord" ALTER COLUMN "valueMmolL" DROP NOT NULL;
