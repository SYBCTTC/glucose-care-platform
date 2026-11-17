-- 清理 P3 血糖模块 2026-10-22 移除后残留在库里的 5 个枚举类型。
-- schema.prisma 早已不再引用它们，但 PostgreSQL 的类型对象不会随代码删除而消失，
-- 于是 prisma migrate diff 每次都报漂移、migrate dev 提示重置数据库（本项目已禁用 migrate dev）。
--
-- 前置检查：任一类型仍被某列引用则**直接失败并报出引用位置**，不静默 DROP。
-- 本地开发库已核对（2026-11-17，pg_attribute 只读查询）：5 个类型均无任何列引用。
--
-- 本次**不处理** AuditAction：它实库有 16 个值（多出 GLUCOSE_VIEW / GLUCOSE_INPUT / GLUCOSE_EXPORT），
-- 其中 13 行历史审计仍在引用前两者。AuditLog 只增不改不删、留存 >= 180 天，重建枚举类型会让这些旧行
-- 转换失败并整事务回滚，因此改为把 3 个历史值补回 schema.prisma 并按实库顺序排列，不动数据库。
-- 同理 GlucoseRecord.operatorId 外键：实库是 RESTRICT（符合医疗留痕要求），改为在 schema 里显式声明，
-- 不动数据库。详见 docs/DB-MIGRATION-NOTES.md §2.2 / §2.3。

DO $$
DECLARE
  referenced record;
BEGIN
  SELECT c.relname AS table_name, a.attname AS column_name, t.typname AS type_name
    INTO referenced
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_type t ON t.oid = a.atttypid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND t.typname IN ('EntryChannel', 'GlucoseKind', 'GlucoseUnit', 'MealContext', 'RecordStatus')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      '枚举 % 仍被 %.% 引用，禁止 DROP TYPE，请先处理该列后重跑本迁移',
      referenced.type_name, referenced.table_name, referenced.column_name;
  END IF;
END $$;

DROP TYPE IF EXISTS "EntryChannel";
DROP TYPE IF EXISTS "GlucoseKind";
DROP TYPE IF EXISTS "GlucoseUnit";
DROP TYPE IF EXISTS "MealContext";
DROP TYPE IF EXISTS "RecordStatus";
