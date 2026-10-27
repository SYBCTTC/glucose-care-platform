-- CreateTable：动态字典（公共数据）。
-- 字典是数据不是代码：新增/调整取值改数据即可，不再改 @gc/shared 发版；前端禁止硬编码 label/color。
CREATE TABLE "DictItem" (
    "id" UUID NOT NULL,
    "dictType" VARCHAR(32) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "color" VARCHAR(16),
    "checkable" BOOLEAN NOT NULL DEFAULT true,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DictItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DictItem_dictType_code_key" ON "DictItem"("dictType", "code");

-- CreateIndex
CREATE INDEX "DictItem_dictType_sortOrder_idx" ON "DictItem"("dictType", "sortOrder");
