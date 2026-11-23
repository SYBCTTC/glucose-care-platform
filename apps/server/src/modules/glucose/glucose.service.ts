import { Injectable } from '@nestjs/common';
import {
  DICT_TYPE,
  ERROR_CODES,
  formatDateTime,
  formatLocalDate,
  formatLocalTime,
  GLUCOSE_ENTRY_DETECT,
  GLUCOSE_RESULT_CODE_HIGH,
  GLUCOSE_RESULT_CODE_LOW,
  GLUCOSE_RESULT_CODE_NORMAL,
  GLUCOSE_VALUE_RESULT_CODES,
  parseLocalDate,
  PATIENT_STATUS,
  pickTimeSlotByTime,
  RESOURCE,
  TIME_SLOT_CATEGORY,
  TIME_SLOT_CODE_RANDOM,
} from '@gc/shared';
import type {
  CreateGlucoseInput,
  FieldError,
  GlucoseCreateResult,
  GlucoseRecordDetail,
  GlucoseRecordListResponse,
  GlucoseRecordQuery,
  GlucoseReportCell,
  GlucoseReportColumn,
  GlucoseReportColumnType,
  GlucoseReportEntry,
  GlucoseReportQuery,
  GlucoseReportResponse,
  GlucoseReportRow,
  GlucoseReportStats,
  GlucoseUpdateResult,
  GlucoseVoidResult,
  TimeSlotCategory,
  TimeSlotOption,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { assertInScope } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-error';
import { PATIENT_PUBLIC_SELECT, toListItem } from '../patient/patient.service';
import type { GlucoseAlertThreshold } from '../system/system-config.service';
import { SystemConfigService } from '../system/system-config.service';
import { TimeSlotService } from '../time-slot/time-slot.service';

/**
 * 按阈值判定数值型结果类型（0 偏低 / 1 正常 / 2 偏高）。
 *
 * 阈值来自 `SystemConfig`（`glucose.low_threshold` / `glucose.high_threshold`），
 * 由 `SystemConfigService` 读取并校验合法性；**禁止**在此硬编码，
 * 也禁止引入默认常量兜底（原 `@gc/shared` 的 `DEFAULT_ALERT_RANGE` 已删除）。
 * 区间口径：`value < low` → '0'，`low <= value <= high` → '1'，`value > high` → '2'。
 */
function resolveResultType(valueMmolL: number, threshold: GlucoseAlertThreshold): string {
  if (valueMmolL < threshold.low) {
    return '0';
  }
  if (valueMmolL <= threshold.high) {
    return '1';
  }
  return '2';
}

/** 写入/回读共用的血糖记录摘要字段 */
const GLUCOSE_RECORD_SUMMARY_SELECT = {
  id: true,
  resultType: true,
  valueMmolL: true,
  measuredAt: true,
} as const;

/** 血糖记录摘要（写入返回 或 唯一约束命中后回读） */
type GlucoseRecordSummary = {
  id: string;
  resultType: string;
  valueMmolL: Prisma.Decimal | null;
  measuredAt: Date;
};

@Injectable()
export class GlucoseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeSlots: TimeSlotService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  /**
   * 添加血糖（手工录入）。
   *
   * 安全约定：
   *  1. 患者必须存在、未归档、且在住院中（出院患者不录入血糖）→ 40001 / 40004；
   *  2. 数据范围走 assertInScope（PATIENT），跨科室 → 30002；
   *  3. 记录者只校验"用户存在且在职"，不校验角色/科室：
   *     操作人下拉是本科室医护（DY-OPERATOR），但系统管理员等账号不在其中，
   *     默认值（当前登录账号）不能因此被拒；审计日志仍记录真实操作人与记录者；
   *  4. 结果类型 0/1/2 一律由服务端判定，前端只能提交「检测」或 3~9；
   *     判定阈值读 `SystemConfig`（`glucose.low_threshold` / `glucose.high_threshold`），
   *     配置缺失或非法时抛 10000 拒绝写入，**不退回任何默认常量**；
   *  5. 检测时段是动态数据（表 TimeSlot），写库前查库校验 code 存在且启用，
   *     不通过按字段级校验错误返回（10001 + field=mealContext），**不落库**。
   */
  async create(
    user: AuthenticatedUser,
    patientId: string,
    input: CreateGlucoseInput,
  ): Promise<GlucoseCreateResult> {
    await this.assertPatientWritable(user, patientId);

    await this.assertOperatorExists(input.operatorId);
    await this.assertTimeSlotUsable(user, input.mealContext);

    const isDetect = input.resultType === GLUCOSE_ENTRY_DETECT;
    // Zod 已保证「检测」时血糖值必填，其余类型血糖值/试纸为空
    const valueMmolL = isDetect ? (input.valueMmolL as number) : null;
    // 只有「检测」需要按阈值分类；3~9 是人工选择的结果类型，不必读系统配置
    const resultType = isDetect
      ? resolveResultType(valueMmolL as number, await this.systemConfig.getGlucoseAlertThreshold())
      : input.resultType;

    const { record, skipped } = await this.createOrSkipDuplicate({
      patientId,
      resultType,
      valueMmolL: valueMmolL === null ? null : new Prisma.Decimal(valueMmolL.toFixed(1)),
      mealContext: input.mealContext,
      measuredAt: input.measuredAt,
      operatorId: input.operatorId,
      testStrip: isDetect ? (input.testStrip ?? null) : null,
      remark: input.remark?.trim() ? input.remark.trim() : null,
    });

    const row = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: PATIENT_PUBLIC_SELECT,
    });
    if (!row) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }

    return {
      id: record.id,
      skipped,
      resultType: record.resultType,
      valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
      measuredAt: formatDateTime(record.measuredAt) ?? '',
      item: toListItem(row),
    };
  }

  /**
   * R25：单条血糖详情（GET /patients/:id/glucose/:recordId）——review/编辑弹框回填的数据源。
   *
   * 口径（docs/specs/glucose-report-edit.md）：
   *  - **不单独审计**（裁定 Q4）：报表查询已按患者逐条留痕，点击编辑再留一条属重复噪音；
   *    权限与数据范围照常校验（读操作走 assertPatientReadable，不要求住院中）；
   *  - 记录不存在 / **已作废** / 不属于该患者 → 41001（作废对业务等同于不存在）；
   *  - `operatorName` 由服务端下发（操作人可能不在本科室 staff 下拉里，同报表 nurseName 口径）；
   *    时段名称不下发，前端按 code 查动态时段（含停用项回显），避免第二份名称口径。
   */
  async detail(
    user: AuthenticatedUser,
    patientId: string,
    recordId: string,
  ): Promise<GlucoseRecordDetail> {
    await this.assertPatientReadable(user, patientId);

    const record = await this.prisma.glucoseRecord.findFirst({
      where: { id: recordId, patientId, voidedAt: null },
      select: {
        id: true,
        measuredAt: true,
        mealContext: true,
        resultType: true,
        valueMmolL: true,
        testStrip: true,
        operatorId: true,
        remark: true,
        operator: { select: { name: true } },
      },
    });
    if (!record) {
      throw new BusinessException(ERROR_CODES.GLUCOSE_RECORD_NOT_FOUND);
    }

    return {
      id: record.id,
      measuredAt: formatDateTime(record.measuredAt) ?? '',
      mealContext: record.mealContext,
      resultType: record.resultType,
      valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
      testStrip: record.testStrip,
      operatorId: record.operatorId,
      operatorName: record.operator?.name ?? null,
      remark: record.remark,
    };
  }

  /**
   * R25：编辑血糖（PATCH /patients/:id/glucose/:recordId）。
   *
   * 校验口径与 create 一致（患者住院中、记录者在职、阈值重判 0/1/2、非检测类型清空值/试纸、
   * 血糖范围由 Zod 拒绝），差异点（裁定 Q12/Q6/Q5）：
   *  - **时段可用性豁免**：`mealContext` 与原值相同则跳过校验——否则弃用时段的历史记录
   *    永远无法编辑；改为其他 code 时照常校验存在且启用（10001 字段级）；
   *  - 检测时间撞上另一条**有效**记录 → 41003（字段级挂 measuredAt）。与添加的幂等
   *    `skipped` 口径不同：编辑撞时间不是重复提交，是用户改错了时间，必须报错；
   *  - 并发兜底：`updateMany where voidedAt null`，受影响 0 行 → 10008（已被他人作废）；
   *  - 审计 GLUCOSE_UPDATE 的 detail 记 `changedFields` **字段名数组**（既有白名单字段），
   *    remark 等自由文本的值绝不入审计；无实际变更 → 空数组，照常成功返回。
   */
  async update(
    user: AuthenticatedUser,
    patientId: string,
    recordId: string,
    input: CreateGlucoseInput,
  ): Promise<GlucoseUpdateResult> {
    await this.assertPatientWritable(user, patientId);

    const existing = await this.prisma.glucoseRecord.findFirst({
      where: { id: recordId, patientId, voidedAt: null },
      select: {
        measuredAt: true,
        mealContext: true,
        resultType: true,
        valueMmolL: true,
        testStrip: true,
        operatorId: true,
        remark: true,
      },
    });
    if (!existing) {
      throw new BusinessException(ERROR_CODES.GLUCOSE_RECORD_NOT_FOUND);
    }

    await this.assertOperatorExists(input.operatorId);
    // 裁定 Q12：时段未改 → 豁免可用性校验（历史记录可能挂在已弃用时段上）；改了 → 照常校验
    if (input.mealContext !== existing.mealContext) {
      await this.assertTimeSlotUsable(user, input.mealContext);
    }

    const isDetect = input.resultType === GLUCOSE_ENTRY_DETECT;
    const valueMmolL = isDetect ? (input.valueMmolL as number) : null;
    // 与 create 同口径：0/1/2 一律服务端按 SystemConfig 阈值重判，配置缺失/非法 → 10000 拒绝写入
    const resultType = isDetect
      ? resolveResultType(valueMmolL as number, await this.systemConfig.getGlucoseAlertThreshold())
      : input.resultType;
    const testStrip = isDetect ? (input.testStrip ?? null) : null;
    const remark = input.remark?.trim() ? input.remark.trim() : null;
    const measuredAt = input.measuredAt;

    // 检测时间有变更时先查后写（并发窗口由下方 P2002 捕获兜底）
    if (measuredAt.getTime() !== existing.measuredAt.getTime()) {
      const clash = await this.prisma.glucoseRecord.findFirst({
        where: { patientId, measuredAt, voidedAt: null, id: { not: recordId } },
        select: { id: true },
      });
      if (clash) {
        throw this.measuredAtDuplicateError();
      }
    }

    let updated: Prisma.BatchPayload;
    try {
      updated = await this.prisma.glucoseRecord.updateMany({
        // voidedAt null 兼作乐观锁：读后被他人作废 → 受影响 0 行 → 10008
        where: { id: recordId, patientId, voidedAt: null },
        data: {
          resultType,
          valueMmolL: valueMmolL === null ? null : new Prisma.Decimal(valueMmolL.toFixed(1)),
          mealContext: input.mealContext,
          measuredAt,
          operatorId: input.operatorId,
          testStrip,
          remark,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // 部分唯一索引 glucose_record_active_unique 命中：先查后写的并发窗口内他人已占用该时间
        throw this.measuredAtDuplicateError();
      }
      throw error;
    }
    if (updated.count === 0) {
      throw new BusinessException(ERROR_CODES.CONCURRENT_CONFLICT);
    }

    const existingValue = existing.valueMmolL === null ? null : Number(existing.valueMmolL);
    const changedFields = [
      ...(measuredAt.getTime() !== existing.measuredAt.getTime() ? ['measuredAt'] : []),
      ...(input.mealContext !== existing.mealContext ? ['mealContext'] : []),
      ...(valueMmolL !== existingValue ? ['valueMmolL'] : []),
      ...(resultType !== existing.resultType ? ['resultType'] : []),
      ...(testStrip !== existing.testStrip ? ['testStrip'] : []),
      ...(input.operatorId !== existing.operatorId ? ['operatorId'] : []),
      ...(remark !== existing.remark ? ['remark'] : []),
    ];

    return {
      id: recordId,
      changedFields,
      resultType,
      valueMmolL,
      measuredAt: formatDateTime(measuredAt) ?? '',
    };
  }

  /**
   * R25：作废血糖（DELETE /patients/:id/glucose/:recordId，软删除，裁定 Q1a）。
   *
   * 医疗记录不得物理删除（等保三级 / AGENTS.md §5.2）：只置 `voidedAt`/`voidedById`，
   * 全部读路径（报表/统计/最新血糖/幂等回读）排除；审计 GLUCOSE_VOID 的 detail
   * 记 `glucoseRecordId`（白名单新增，先例 wardRecordId），审计对象仍是患者。
   * 记录不存在 → 41001；已被作废（含并发）→ 10008，**不返回成功**，避免误导操作者。
   */
  async voidRecord(
    user: AuthenticatedUser,
    patientId: string,
    recordId: string,
  ): Promise<GlucoseVoidResult> {
    await this.assertPatientWritable(user, patientId);

    const result = await this.prisma.glucoseRecord.updateMany({
      where: { id: recordId, patientId, voidedAt: null },
      data: { voidedAt: new Date(), voidedById: user.userId },
    });
    if (result.count === 0) {
      const exists = await this.prisma.glucoseRecord.findFirst({
        where: { id: recordId, patientId },
        select: { id: true },
      });
      if (!exists) {
        throw new BusinessException(ERROR_CODES.GLUCOSE_RECORD_NOT_FOUND);
      }
      // 记录存在但已被作废：并发或重复操作
      throw new BusinessException(ERROR_CODES.CONCURRENT_CONFLICT);
    }
    return { glucoseRecordId: recordId, voided: true };
  }

  /** 41003 字段级错误（details 挂 measuredAt，前端表单就地提示） */
  private measuredAtDuplicateError(): BusinessException {
    const details: FieldError[] = [{ field: 'measuredAt', message: '该检测时间已存在血糖记录' }];
    return new BusinessException(ERROR_CODES.GLUCOSE_MEASURED_AT_DUPLICATE, undefined, details);
  }

  /**
   * 血糖报告：日期 × 时段矩阵（只读）。
   *
   * 口径（详见 docs/specs/glucose-report.md）：
   *  1. 患者存在、未归档、在数据范围内；**不要求住院中**——出院患者的历史血糖同样要能查；
   *  2. 表头 = **启用的**普通(type=1) + 特殊(type=4) 时段（R22：弃用时段不成列）；
   *     强化(type=0) 与弃用时段的记录按检测时间落点归入启用的普通时段列并以后缀标注；
   *  3. 「日期」一律是 `measuredAt` 的**本地日历日**，不是 UTC 日（否则北京时间 00:00–08:00
   *     的记录会被归到前一天）；
   *  4. **分页单位是日期而非记录条数**：先取范围内全部 measuredAt 换算本地日期去重、降序、
   *     切出本页日期，再查该日期窗口内的记录组装矩阵。禁止用 Prisma take/skip 直接切记录；
   *  5. 不补空行：无血糖数据的日期不出现在 rows 里；
   *  6. 响应回显 rangeFrom/rangeTo/count，供 AuditLogInterceptor 按既有白名单自动落审计 detail。
   */
  async report(
    user: AuthenticatedUser,
    patientId: string,
    query: GlucoseReportQuery,
  ): Promise<GlucoseReportResponse> {
    await this.assertPatientReadable(user, patientId);

    const range = this.resolveTimeRange(query);

    // 时段一次查全（含停用）：既生成表头又作为归组依据，保证两者同源、不与前端 store 漂移
    const slots = await this.timeSlots.list(user);
    const columns = this.buildReportColumns(slots);

    // 只取 measuredAt 一列做本地日期去重；长期住院患者量级增大后再考虑 $queryRaw + date_trunc
    // R25：已作废记录不参与日期分组（voidedAt null = 有效）
    const stamps = await this.prisma.glucoseRecord.findMany({
      where: { patientId, measuredAt: range.where, voidedAt: null },
      select: { measuredAt: true },
      orderBy: { measuredAt: 'desc' },
    });

    const dates = [
      ...new Set(
        stamps
          .map((record) => formatLocalDate(record.measuredAt))
          .filter((date): date is string => date !== null),
      ),
    ];
    // formatLocalDate 产出定宽 YYYY-MM-DD，字典序即时间序 → 降序（最新在前）
    dates.sort((left, right) => right.localeCompare(left));

    const total = dates.length;
    const offset = (query.page - 1) * query.pageSize;
    const pageDates = dates.slice(offset, offset + query.pageSize);

    const { rows, count } = pageDates.length
      ? await this.buildReportRows(patientId, pageDates, slots, columns, range.where)
      : { rows: [], count: 0 };

    // 统计栏（R20）：与分页无关，按查询范围全量计算
    const stats = await this.buildReportStats(patientId, range.where);

    return {
      columns,
      rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      rangeFrom: range.from,
      rangeTo: range.to,
      count,
      stats,
    };
  }

  /**
   * R27：血糖记录列表（GET /patients/:id/glucose/records，平铺分页，docs/specs/glucose-record.md）。
   *
   * 口径：
   *  1. 患者校验同报表（存在、未归档、数据范围内；**不要求住院中**）；
   *  2. 时间过滤与报表契约一致：秒粒度闭区间，单侧不传则不限（resolveTimeRange 同一实现）；
   *  3. **只含有效记录**（voidedAt null，全仓不变量，裁定 Q2）；结果类型 0~9 全量下发不过滤（规则 3）；
   *  4. 排序 `measuredAt DESC, id ASC`（裁定 Q5：最新在前；id 第二键防同秒记录页间漂移）；
   *  5. 分页按**记录条数** take/skip（与报表「按日期分组再切」不同），total = 过滤后总条数；
   *  6. 统计栏复用 buildReportStats（裁定 Q8：同范围下与报表 Tab 数字完全一致；
   *     总计只计 counted=true 类型，5~9 列表可见但不计入）；
   *  7. `operatorName` 走关联 select（同报表 nurseName / R25 详情口径）；时段名不下发，
   *     前端按 code 查动态时段（含停用项回显），避免第二份名称口径；
   *  8. 响应回显 rangeFrom/rangeTo/count，供 AuditLogInterceptor 按既有白名单落审计 detail。
   */
  async records(
    user: AuthenticatedUser,
    patientId: string,
    query: GlucoseRecordQuery,
  ): Promise<GlucoseRecordListResponse> {
    await this.assertPatientReadable(user, patientId);

    const range = this.resolveTimeRange(query);
    const where = { patientId, measuredAt: range.where, voidedAt: null };

    const [total, rows, stats] = await Promise.all([
      this.prisma.glucoseRecord.count({ where }),
      this.prisma.glucoseRecord.findMany({
        where,
        select: {
          id: true,
          measuredAt: true,
          mealContext: true,
          resultType: true,
          valueMmolL: true,
          remark: true,
          operator: { select: { name: true } },
        },
        orderBy: [{ measuredAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.buildReportStats(patientId, range.where),
    ]);

    return {
      items: rows.map((record) => ({
        id: record.id,
        measuredAt: formatDateTime(record.measuredAt) ?? '',
        mealContext: record.mealContext,
        resultType: record.resultType,
        valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
        operatorName: record.operator?.name ?? null,
        remark: record.remark,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      rangeFrom: range.from,
      rangeTo: range.to,
      count: rows.length,
      stats,
    };
  }

  /**
   * 报表统计栏（R20，2026-11-19 需求人裁定，详见 docs/specs/glucose-report.md）：
   *  - **总计**：`resultType` ∈ 字典 `counted=true` 集合的记录数。集合查 `DictItem` 动态取
   *    （字典是数据不是代码：临床改 counted 标志，统计口径即跟随），当前种子为 0~4，
   *    拒检/外出/请假/已吃饭/未进食（5~9，counted=false）不计入；
   *  - **合格次数**：`resultType='1'`（正常）的记录数；
   *  - **最高/最低**：范围内存在 High('4')/Low('3') 记录 → 前端展示字典 label；
   *    否则取数值型(0/1/2)记录的极值及其自身 resultType（前端按该码字典色着色）；
   *  - 统计范围 = 报表查询的 where 条件（本轮仅患者；后续新增筛选自动跟随），**不受分页影响**。
   */
  private async buildReportStats(
    patientId: string,
    measuredAt: Prisma.DateTimeFilter,
  ): Promise<GlucoseReportStats> {
    const [countedDicts, grouped, maxRecord, minRecord] = await Promise.all([
      this.prisma.dictItem.findMany({
        where: { dictType: DICT_TYPE.GLUCOSE_RESULT, counted: true },
        select: { code: true },
      }),
      this.prisma.glucoseRecord.groupBy({
        by: ['resultType'],
        // R25：已作废记录不计入统计
        where: { patientId, measuredAt, voidedAt: null },
        _count: { _all: true },
      }),
      // 极值取**记录本身**（而非 aggregate）：还要带回 resultType 供前端按字典色着色
      this.prisma.glucoseRecord.findFirst({
        where: this.numericRecordWhere(patientId, measuredAt),
        select: { valueMmolL: true, resultType: true },
        orderBy: { valueMmolL: 'desc' },
      }),
      this.prisma.glucoseRecord.findFirst({
        where: this.numericRecordWhere(patientId, measuredAt),
        select: { valueMmolL: true, resultType: true },
        orderBy: { valueMmolL: 'asc' },
      }),
    ]);

    const countByType = new Map(grouped.map((item) => [item.resultType, item._count._all]));
    const total = countedDicts.reduce((sum, dict) => sum + (countByType.get(dict.code) ?? 0), 0);
    const maxValue = maxRecord?.valueMmolL ?? null;
    const minValue = minRecord?.valueMmolL ?? null;

    return {
      total,
      qualified: countByType.get(GLUCOSE_RESULT_CODE_NORMAL) ?? 0,
      hasHigh: (countByType.get(GLUCOSE_RESULT_CODE_HIGH) ?? 0) > 0,
      hasLow: (countByType.get(GLUCOSE_RESULT_CODE_LOW) ?? 0) > 0,
      maxValueMmolL: maxValue === null ? null : Number(maxValue),
      maxResultType: maxRecord?.resultType ?? null,
      minValueMmolL: minValue === null ? null : Number(minValue),
      minResultType: minRecord?.resultType ?? null,
    };
  }

  /** 数值型极值查询条件：只数 0/1/2 且有值的记录（3~9 无 valueMmolL，天然不参与极值）；R25 排除已作废 */
  private numericRecordWhere(patientId: string, measuredAt: Prisma.DateTimeFilter) {
    return {
      patientId,
      measuredAt,
      resultType: { in: [...GLUCOSE_VALUE_RESULT_CODES] },
      valueMmolL: { not: null },
      voidedAt: null,
    };
  }

  /**
   * 写入血糖记录；命中唯一约束 `(patientId, measuredAt)` 时按**幂等**处理。
   *
   * 重复提交（连点、网络重试）不抛错，回读已有记录并置 `skipped = true`，
   * 由前端提示"已有记录，未重复保存"。其他写库错误原样抛出，避免掩盖故障。
   */
  private async createOrSkipDuplicate(
    data: Prisma.GlucoseRecordUncheckedCreateInput,
  ): Promise<{ record: GlucoseRecordSummary; skipped: boolean }> {
    try {
      const record = await this.prisma.glucoseRecord.create({
        data,
        select: GLUCOSE_RECORD_SUMMARY_SELECT,
      });
      return { record, skipped: false };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
      // R25：全量唯一约束已改为部分唯一索引（仅约束 voidedAt IS NULL 的有效记录），
      // `patientId_measuredAt` 复合唯一键不复存在，回读改 findFirst 且只认有效记录——
      // 部分索引下命中 P2002 必然存在有效重复行，幂等语义不变
      const existing = await this.prisma.glucoseRecord.findFirst({
        where: {
          patientId: data.patientId,
          measuredAt: data.measuredAt,
          voidedAt: null,
        },
        select: GLUCOSE_RECORD_SUMMARY_SELECT,
      });
      if (!existing) {
        // 唯一约束命中却回读不到有效记录：并发作废等异常情况，保留原始错误便于排查
        throw error;
      }
      return { record: existing, skipped: true };
    }
  }

  /** 记录者必须是存在且在职的用户；否则按字段级校验错误返回 */
  private async assertOperatorExists(operatorId: string): Promise<void> {
    const operator = await this.prisma.user.findFirst({
      where: { id: operatorId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!operator) {
      const details: FieldError[] = [{ field: 'operatorId', message: '记录者不存在或已停用' }];
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }
  }

  /**
   * 检测时段必须在 `TimeSlot` 表里存在且 `enabled`；否则按字段级校验错误返回。
   *
   * 时段是动态数据，可用性只能查库判断：`@gc/shared` 的静态 `TIME_SLOTS` 已降级为 seed 数据源，
   * 拿它做白名单会在"库里新增了时段"时误拒合法提交。
   * 停用项仍由 `GET /time-slots` 下发（历史血糖要按 code 回显名称），但**不得用于新录入**。
   * 本校验在写库之前，失败不产生任何数据。
   */
  private async assertTimeSlotUsable(user: AuthenticatedUser, code: string): Promise<void> {
    const slot = await this.timeSlots.findByCode(user, code);
    if (slot?.enabled) {
      return;
    }
    const details: FieldError[] = [
      { field: 'mealContext', message: slot ? '检测时段已停用' : '检测时段不存在' },
    ];
    throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
  }

  /* ---------------------------- 血糖报告（只读） ---------------------------- */

  /**
   * 报表读取前的患者校验：存在、未归档、在数据范围内。
   * 与 create() 的区别是**不要求住院中**——出院患者的历史血糖同样要能查（只读不改状态）。
   */
  private async assertPatientReadable(user: AuthenticatedUser, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, archivedAt: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });
  }

  /**
   * 写操作前的患者校验（create/update/voidRecord 共用，R25 抽取）：
   * 存在且未归档（40001）→ 数据范围（30002/30006）→ **住院中**（40004）。
   * 编辑/作废与添加同口径要求住院中（2026-11-20 评审确认项 1：口径一致、边界简单；
   * 「出院后更正历史记录」不在本需求内，如需放开须单独裁定）。
   */
  private async assertPatientWritable(user: AuthenticatedUser, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, status: true, archivedAt: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });
    if (patient.status !== PATIENT_STATUS.INPATIENT) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }
  }

  /**
   * 把秒粒度入参换算成 `measuredAt`（timestamptz）的过滤区间。
   *
   * R24（2026-11-20 裁定 Q16）：原天粒度 `startDate/endDate` 升级为秒粒度
   * `startTime/endTime`——`dateTimeStringSchema` 已按**本地时区**转成 Date（与录入侧
   * `measuredAt` 同口径，无 UTC 日界偏移问题），过滤为**闭区间** `[startTime, endTime]`
   * （裁定 Q14：范围外记录不展示、不统计）。单侧不传则该侧不限。
   * rangeFrom/rangeTo 回显本地时刻字符串，供审计 detail（字段名沿用既有白名单）。
   *
   * R27：参数放宽为只取时间两键——记录列表（glucoseRecordQuerySchema）与报表契约
   * 的时间口径一字不差，共用本实现，避免第二份区间换算。
   */
  private resolveTimeRange(query: Pick<GlucoseReportQuery, 'startTime' | 'endTime'>): {
    where: Prisma.DateTimeFilter;
    from: string | null;
    to: string | null;
  } {
    const where: Prisma.DateTimeFilter = {};

    if (query.startTime !== undefined) {
      where.gte = query.startTime;
    }
    if (query.endTime !== undefined) {
      where.lte = query.endTime;
    }

    if (where.gte && where.lte && where.gte > where.lte) {
      const details: FieldError[] = [{ field: 'endTime', message: '结束时间不能早于开始时间' }];
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }

    return {
      where,
      from: formatDateTime(query.startTime),
      to: formatDateTime(query.endTime),
    };
  }

  /**
   * 表头列 = **启用的**普通(type=1) + 特殊(type=4)，按 sortOrder、code 升序；强化(type=0) **不单独成列**。
   * R22（2026-11-19 裁定，替代原「含停用项」口径）：弃用时段不成列，
   * 其历史血糖按检测时间合并进启用的宿主列并带弃用时段名后缀——历史仍可展示，只是不再占列。
   */
  private buildReportColumns(slots: TimeSlotOption[]): GlucoseReportColumn[] {
    return (
      slots
        .filter(
          (slot) =>
            // R22：只有**启用的**普通/特殊时段成列；弃用时段的历史记录合并进启用列（见 resolveColumn）
            slot.enabled &&
            (slot.type === TIME_SLOT_CATEGORY.NORMAL || slot.type === TIME_SLOT_CATEGORY.SPECIAL),
        )
        // list() 已按 sortOrder、code 排序，这里再排一次是不依赖上游顺序的防御
        .sort(
          (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
        )
        .map((slot): GlucoseReportColumn => ({
          code: slot.code,
          name: slot.name,
          type: slot.type as GlucoseReportColumnType,
          sortOrder: slot.sortOrder,
        }))
    );
  }

  /**
   * 取本页日期窗口内的全部记录，组装成矩阵。
   *
   * 窗口 = [本页最早日期的本地零点, 本页最晚日期的次日本地零点)。
   * `pageDates` 是从**完整** distinct 日期集合切出的连续片段，故窗口内任何有数据的日期
   * 必然也在 `pageDates` 中，不会混入别页数据，无需再叠加用户的范围条件。
   *
   * 记录按 `measuredAt` **升序**取，因此每个单元格的 entries 天然满足 R4 的堆叠顺序。
   */
  private async buildReportRows(
    patientId: string,
    pageDates: string[],
    slots: TimeSlotOption[],
    columns: GlucoseReportColumn[],
    rangeWhere: Prisma.DateTimeFilter,
  ): Promise<{ rows: GlucoseReportRow[]; count: number }> {
    // pageDates 降序：末尾是最早日期，首个是最晚日期
    const earliest = parseLocalDate(pageDates[pageDates.length - 1]);
    const latest = parseLocalDate(pageDates[0]);
    if (!earliest || !latest) {
      return { rows: [], count: 0 };
    }

    // R24：秒粒度过滤后，窗口（本页日期跨度）内可能存在范围外记录（如范围从当日
    // 09:00 起，则 00:00–08:59 的记录仍在窗口内），必须叠加用户范围条件，
    // 否则范围外记录会落进单元格（裁定 Q14：不展示、不统计）。
    // 天粒度时代窗口边界与日期边界重合、无需叠加的假设已随契约升级失效。
    const windowStart = rangeWhere.gte && rangeWhere.gte > earliest ? rangeWhere.gte : earliest;
    const records = await this.prisma.glucoseRecord.findMany({
      where: {
        patientId,
        measuredAt: {
          gte: windowStart,
          lt: new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + 1),
          ...(rangeWhere.lte ? { lte: rangeWhere.lte } : {}),
        },
        // R25：已作废记录不进单元格
        voidedAt: null,
      },
      select: {
        // R25：entry 携带记录 id，前端点击单元格记录时定位编辑对象
        id: true,
        resultType: true,
        valueMmolL: true,
        mealContext: true,
        measuredAt: true,
        // 记录者姓名：库表无 denormalize 的 nurseName，走关联 select（同 patient.service 先例）
        operator: { select: { name: true } },
      },
      orderBy: { measuredAt: 'asc' },
    });

    const slotByCode = new Map(slots.map((slot) => [slot.code, slot]));
    const columnIndex = new Map(columns.map((column, index) => [column.code, index]));
    const fallbackCode = this.resolveFallbackColumn(columns);

    // 预建空矩阵：保证 rows 与 pageDates 同序、每行 cells 与 columns 等长同序
    const rowByDate = new Map<string, GlucoseReportRow>();
    for (const date of pageDates) {
      rowByDate.set(date, {
        date,
        cells: columns.map((column): GlucoseReportCell => ({ slotCode: column.code, entries: [] })),
      });
    }

    let count = 0;
    for (const record of records) {
      const date = formatLocalDate(record.measuredAt);
      const row = date === null ? undefined : rowByDate.get(date);
      if (!row) {
        // 窗口即本页日期跨度，正常不会发生；真发生说明本地日期换算与窗口不一致，跳过而非错放
        continue;
      }

      const resolved = this.resolveColumn(
        record.mealContext,
        record.measuredAt,
        slots,
        slotByCode,
        fallbackCode,
      );
      let index = columnIndex.get(resolved.code);
      if (index === undefined && fallbackCode !== null) {
        // 归到的列不在表头里（如库里出现了非 0/1/4 的脏 type）→ 退回兜底列，不丢记录
        index = columnIndex.get(fallbackCode);
      }
      if (index === undefined) {
        // 库里连一个普通/特殊时段都没有：表格无列可画，属数据完整性故障。
        // 此时 count 不计入该记录，审计 detail 与 total 的差异即可暴露异常
        continue;
      }

      const entry: GlucoseReportEntry = {
        id: record.id,
        valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
        resultType: record.resultType,
        time: formatLocalTime(record.measuredAt) ?? '',
        nurseName: record.operator?.name ?? null,
        sourceType: resolved.sourceType,
        sourceSlotName: resolved.sourceSlotName,
      };
      row.cells[index].entries.push(entry);
      count += 1;
    }

    return { rows: pageDates.map((date) => rowByDate.get(date) as GlucoseReportRow), count };
  }

  /**
   * 决定一条记录落在哪一列，并给出前端过滤/渲染所需的来源信息（R22）。
   *
   *  - 启用的普通 / 特殊时段：直接落自己的列（特殊时段**不做**时间归组），无后缀；
   *  - 强化时段（无论启用/弃用）：不单独成列，按检测时间的本地 HH:mm 归入**启用的**
   *    普通时段列，带强化时段名作后缀；
   *  - **弃用的普通/特殊时段**（R22，替代原「停用时段仍成列」口径）：列已不存在，
   *    记录按检测时间合并进启用的普通列并带**弃用时段自己的名称**作后缀（裁定 Q1），
   *    展示方式与强化一致；`sourceType` 保留原时段类型，供前端按勾选过滤（裁定 Q4）；
   *  - 归组失败（区间空洞，如弃用普通时段的原区间已无启用宿主）/ `mealContext` 为空 /
   *    code 在库里不存在 → 兜底列，**不静默丢弃记录**（R13）。合并记录即使兜底也保留后缀；
   *    来源不明的兜底记录 `sourceType` 按特殊对待（恒展示，宁可多展示不可丢数据）。
   */
  private resolveColumn(
    mealContext: string | null,
    measuredAt: Date,
    slots: TimeSlotOption[],
    slotByCode: Map<string, TimeSlotOption>,
    fallbackCode: string | null,
  ): { code: string; sourceType: TimeSlotCategory; sourceSlotName: string | null } {
    const slot = mealContext ? slotByCode.get(mealContext) : undefined;
    if (!slot) {
      return {
        code: fallbackCode ?? '',
        sourceType: TIME_SLOT_CATEGORY.SPECIAL,
        sourceSlotName: null,
      };
    }
    if (slot.type !== TIME_SLOT_CATEGORY.INTENSIVE && slot.enabled) {
      return { code: slot.code, sourceType: slot.type, sourceSlotName: null };
    }
    // 强化（含弃用强化）与弃用的普通/特殊时段：合并进启用的宿主列 + 来源时段名后缀。
    // 宿主只在**启用**普通时段里找（默认行为）——弃用时段没有列，不能作宿主
    const host = pickTimeSlotByTime(slots, formatLocalTime(measuredAt) ?? '');
    return {
      code: host?.code ?? fallbackCode ?? '',
      sourceType: slot.type,
      sourceSlotName: slot.name,
    };
  }

  /**
   * 归组兜底列（R13）：优先「随机」；库里没有 RANDOM 时退到第一个特殊时段列，再退到最后一列。
   * 返回 null 表示库里连一个普通/特殊时段都没有——此时无列可画，属数据完整性故障。
   */
  private resolveFallbackColumn(columns: GlucoseReportColumn[]): string | null {
    const random = columns.find((column) => column.code === TIME_SLOT_CODE_RANDOM);
    if (random) {
      return random.code;
    }
    const special = columns.find((column) => column.type === TIME_SLOT_CATEGORY.SPECIAL);
    if (special) {
      return special.code;
    }
    return columns.length > 0 ? columns[columns.length - 1].code : null;
  }
}
