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
  GlucoseReportCell,
  GlucoseReportColumn,
  GlucoseReportColumnType,
  GlucoseReportEntry,
  GlucoseReportQuery,
  GlucoseReportResponse,
  GlucoseReportRow,
  GlucoseReportStats,
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
   * 血糖报告：日期 × 时段矩阵（只读）。
   *
   * 口径（详见 docs/specs/glucose-report.md）：
   *  1. 患者存在、未归档、在数据范围内；**不要求住院中**——出院患者的历史血糖同样要能查；
   *  2. 表头 = 普通(type=1) + 特殊(type=4) 时段，**含停用项**；强化(type=0) 不单独成列，
   *     按检测时间落点归入普通时段列并以后缀标注；
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

    const range = this.resolveLocalRange(query);

    // 时段一次查全（含停用）：既生成表头又作为归组依据，保证两者同源、不与前端 store 漂移
    const slots = await this.timeSlots.list(user);
    const columns = this.buildReportColumns(slots);

    // 只取 measuredAt 一列做本地日期去重；长期住院患者量级增大后再考虑 $queryRaw + date_trunc
    const stamps = await this.prisma.glucoseRecord.findMany({
      where: { patientId, measuredAt: range.where },
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
      ? await this.buildReportRows(patientId, pageDates, slots, columns)
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
        where: { patientId, measuredAt },
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

  /** 数值型极值查询条件：只数 0/1/2 且有值的记录（3~9 无 valueMmolL，天然不参与极值） */
  private numericRecordWhere(patientId: string, measuredAt: Prisma.DateTimeFilter) {
    return {
      patientId,
      measuredAt,
      resultType: { in: [...GLUCOSE_VALUE_RESULT_CODES] },
      valueMmolL: { not: null },
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
      const existing = await this.prisma.glucoseRecord.findUnique({
        where: {
          patientId_measuredAt: { patientId: data.patientId, measuredAt: data.measuredAt },
        },
        select: GLUCOSE_RECORD_SUMMARY_SELECT,
      });
      if (!existing) {
        // 唯一约束命中却回读不到：并发删除等异常情况，保留原始错误便于排查
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
   * 把 `YYYY-MM-DD` 的**本地日期**入参换算成 `measuredAt`（timestamptz）的过滤区间。
   *
   * ⚠️ 必须用 `parseLocalDate`（本地零点）而不是 `dateOnlyStringSchema`（UTC 零点）：
   * 后者会让日界整体偏 8 小时，本地 00:00–08:00 的记录被划到范围之外。
   * 终点取「次日本地零点」并配 `lt`（左闭右开），避免漏掉 23:59:59.999。
   */
  private resolveLocalRange(query: GlucoseReportQuery): {
    where: Prisma.DateTimeFilter;
    from: string | null;
    to: string | null;
  } {
    const where: Prisma.DateTimeFilter = {};
    let from: string | null = null;
    let to: string | null = null;

    if (query.startDate !== undefined) {
      const start = parseLocalDate(query.startDate);
      if (!start) {
        throw this.invalidDateError('startDate');
      }
      where.gte = start;
      from = formatLocalDate(start);
    }

    if (query.endDate !== undefined) {
      const end = parseLocalDate(query.endDate);
      if (!end) {
        throw this.invalidDateError('endDate');
      }
      where.lt = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
      to = formatLocalDate(end);
    }

    if (where.gte && where.lt && where.gte >= where.lt) {
      const details: FieldError[] = [{ field: 'endDate', message: '结束日期不能早于开始日期' }];
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }

    return { where, from, to };
  }

  /** Zod 已校验格式，走到这里说明是 `2026-02-30` 这类不存在的日期 */
  private invalidDateError(field: 'startDate' | 'endDate'): BusinessException {
    const details: FieldError[] = [{ field, message: '日期不合法' }];
    return new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
  }

  /**
   * 表头列 = 普通(type=1) + 特殊(type=4)，按 sortOrder、code 升序；强化(type=0) **不单独成列**。
   * **含停用项**：停用时段的历史血糖必须有列可落（COMMON-DATA.md「停用时段历史可展示」）。
   */
  private buildReportColumns(slots: TimeSlotOption[]): GlucoseReportColumn[] {
    return slots
      .filter(
        (slot) =>
          slot.type === TIME_SLOT_CATEGORY.NORMAL || slot.type === TIME_SLOT_CATEGORY.SPECIAL,
      )
      // list() 已按 sortOrder、code 排序，这里再排一次是不依赖上游顺序的防御
      .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))
      .map(
        (slot): GlucoseReportColumn => ({
          code: slot.code,
          name: slot.name,
          type: slot.type as GlucoseReportColumnType,
          sortOrder: slot.sortOrder,
          enabled: slot.enabled,
        }),
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
  ): Promise<{ rows: GlucoseReportRow[]; count: number }> {
    // pageDates 降序：末尾是最早日期，首个是最晚日期
    const earliest = parseLocalDate(pageDates[pageDates.length - 1]);
    const latest = parseLocalDate(pageDates[0]);
    if (!earliest || !latest) {
      return { rows: [], count: 0 };
    }

    const records = await this.prisma.glucoseRecord.findMany({
      where: {
        patientId,
        measuredAt: {
          gte: earliest,
          lt: new Date(latest.getFullYear(), latest.getMonth(), latest.getDate() + 1),
        },
      },
      select: {
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
        cells: columns.map(
          (column): GlucoseReportCell => ({ slotCode: column.code, entries: [] }),
        ),
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

      const resolved = this.resolveColumn(record.mealContext, record.measuredAt, slots, slotByCode, fallbackCode);
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
        valueMmolL: record.valueMmolL === null ? null : Number(record.valueMmolL),
        resultType: record.resultType,
        time: formatLocalTime(record.measuredAt) ?? '',
        nurseName: record.operator?.name ?? null,
        intensiveName: resolved.intensiveName,
      };
      row.cells[index].entries.push(entry);
      count += 1;
    }

    return { rows: pageDates.map((date) => rowByDate.get(date) as GlucoseReportRow), count };
  }

  /**
   * 决定一条记录落在哪一列。
   *
   *  - 普通 / 特殊时段：直接落自己的列（特殊时段**不做**时间归组）；
   *  - 强化时段：按检测时间的本地 HH:mm 归入普通时段列，并带上强化时段名作后缀；
   *    归组时**忽略 `enabled`**（R5）——停用时段的历史血糖仍应落回原本所属的列；
   *  - 归组失败（区间空洞）/ `mealContext` 为空 / code 在库里不存在 → 兜底列，
   *    **不静默丢弃记录**（R13）。强化记录即使兜底也保留后缀。
   */
  private resolveColumn(
    mealContext: string | null,
    measuredAt: Date,
    slots: TimeSlotOption[],
    slotByCode: Map<string, TimeSlotOption>,
    fallbackCode: string | null,
  ): { code: string; intensiveName: string | null } {
    const slot = mealContext ? slotByCode.get(mealContext) : undefined;
    if (!slot) {
      return { code: fallbackCode ?? '', intensiveName: null };
    }
    if (slot.type !== TIME_SLOT_CATEGORY.INTENSIVE) {
      return { code: slot.code, intensiveName: null };
    }
    const host = pickTimeSlotByTime(slots, formatLocalTime(measuredAt) ?? '', {
      ignoreEnabled: true,
    });
    return { code: host?.code ?? fallbackCode ?? '', intensiveName: slot.name };
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
