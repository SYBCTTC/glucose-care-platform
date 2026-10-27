-- 时段：从静态字典（@gc/shared TIME_SLOTS）改为动态数据。
-- 普通时段区间左闭右开 [startTime, endTime)，要求 00:00~24:00 全覆盖、不重叠、不跨零点；
-- 特殊时段（随机/复测）与强化时段无区间、无控糖目标。
-- 初始数据由 prisma/seed.ts 幂等 upsert 灌入（以 @gc/shared TIME_SLOTS 为源）。
CREATE TABLE "TimeSlot" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "type" INTEGER NOT NULL,
    "startTime" VARCHAR(5),
    "endTime" VARCHAR(5),
    "valueDown" DECIMAL(4,1),
    "valueUp" DECIMAL(4,1),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimeSlot_code_key" ON "TimeSlot"("code");
CREATE INDEX "TimeSlot_type_sortOrder_idx" ON "TimeSlot"("type", "sortOrder");
