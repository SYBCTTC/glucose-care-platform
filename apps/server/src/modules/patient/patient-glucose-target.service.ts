import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, PATIENT_STATUS, RESOURCE, TIME_SLOT_CATEGORY } from '@gc/shared';
import type {
  FieldError,
  PatientGlucoseTargetItem,
  PatientGlucoseTargetsResponse,
  PatientGlucoseTargetsUpdateResult,
  UpdatePatientGlucoseTargetsInput,
} from '@gc/shared';
import { Prisma } from '@prisma/client';
import { assertInScope } from '../../common/data-scope/scope.util';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';
import { isUniqueConstraintViolation } from '../../common/utils/prisma-error';
import { SystemConfigService } from '../system/system-config.service';
import { TimeSlotService } from '../time-slot/time-slot.service';

/** 展示集合内的一行时段：code 是契约，name 与默认阈值随库数据动态变化 */
interface DisplaySlot {
  code: string;
  name: string;
  valueDown: number;
  valueUp: number;
}

/**
 * 患者控糖目标（各时段血糖上下限 + 低/高血糖预警值）。
 * 规格 `docs/specs/patient-glucose-target.md` §3 §4 §5。
 *
 * 为什么独立成 service 而不并进 `PatientService`：后者已 678 行（超 `AGENTS.md` §7 上限），
 * 且控糖目标有自己的展示集合口径、diff 算法与快照初始化职责。
 *
 * 阈值一律 `Decimal(4,1)`：读时 `Number()` 出参，写时 `new Prisma.Decimal(v.toFixed(1))`，
 * 与 `TimeSlotService.list()` / `PatientService` 的 `hba1c` 同口径，避免浮点尾差落库。
 */
@Injectable()
export class PatientGlucoseTargetService {
  private readonly logger = new Logger(PatientGlucoseTargetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeSlots: TimeSlotService,
    private readonly systemConfig: SystemConfigService,
  ) {}

  /**
   * 查询患者控糖目标（GET）。
   *
   * 权限 `patient:view`；**不单独留审计**（裁定 L：由打开详情页的 `PATIENT_VIEW` 兼顶，
   * 避免每次切 Tab 都写一行审计把表撑爆）。
   * 全局阈值读取失败时 `default*` 返回 null 而非抛错（裁定 Q）：「恢复默认」按钮置灰即可，
   * 不该让医护连已配置的目标都看不到。
   */
  async get(user: AuthenticatedUser, patientId: string): Promise<PatientGlucoseTargetsResponse> {
    await this.assertPatientReadable(user, patientId);
    return this.buildResponse(user, patientId);
  }

  /**
   * 编辑患者控糖目标（PATCH）。
   *
   * 权限 `patient:target:update`（裁定 H，不复用 `patient:update`）；审计 `PATIENT_TARGET_UPDATE`。
   * 入参是展示集合的**全量提交**（裁定 N），后端 diff 出 create / update / delete。
   * 无实际变更时不写库、`changedFields` 返回空数组，审计拦截器据此不写审计行（裁定 L）。
   */
  async update(
    user: AuthenticatedUser,
    patientId: string,
    input: UpdatePatientGlucoseTargetsInput,
  ): Promise<PatientGlucoseTargetsUpdateResult> {
    await this.assertPatientEditable(user, patientId);

    const displaySet = await this.loadDisplaySet(user);
    this.assertCodesInDisplaySet(input, displaySet);

    const existing = await this.prisma.patientGlucoseTarget.findMany({
      where: { patientId },
      select: { timeSlotCode: true, valueDown: true, valueUp: true },
    });
    const existingByCode = new Map(existing.map((row) => [row.timeSlotCode, row]));
    const alert = await this.prisma.patientAlertThreshold.findUnique({
      where: { patientId },
      select: { lowThreshold: true, highThreshold: true },
    });

    const plan = this.diff(patientId, input, existingByCode, alert);
    if (plan.changedFields.length === 0) {
      // 提交值与库中完全一致：不写库、不写审计，但仍回完整视图供前端刷新
      return { ...(await this.buildResponse(user, patientId)), changedFields: [] };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        if (plan.deleteCodes.length > 0) {
          await tx.patientGlucoseTarget.deleteMany({
            where: { patientId, timeSlotCode: { in: plan.deleteCodes } },
          });
        }
        if (plan.creates.length > 0) {
          await tx.patientGlucoseTarget.createMany({ data: plan.creates });
        }
        for (const item of plan.updates) {
          await tx.patientGlucoseTarget.update({
            where: {
              patientId_timeSlotCode: { patientId, timeSlotCode: item.timeSlotCode },
            },
            data: { valueDown: item.valueDown, valueUp: item.valueUp },
          });
        }
        // 预警值一患者一行：upsert 兼容「建档初始化失败 / 存量未回填」导致的缺行
        await tx.patientAlertThreshold.upsert({
          where: { patientId },
          update: {
            lowThreshold: this.toDecimal(input.alert.lowThreshold),
            highThreshold: this.toDecimal(input.alert.highThreshold),
          },
          create: {
            patientId,
            lowThreshold: this.toDecimal(input.alert.lowThreshold),
            highThreshold: this.toDecimal(input.alert.highThreshold),
          },
        });
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // 并发编辑撞 (patientId, timeSlotCode) 唯一索引：让前端刷新后重试，不静默覆盖
        throw new BusinessException(ERROR_CODES.CONCURRENT_CONFLICT);
      }
      throw error;
    }

    return {
      ...(await this.buildResponse(user, patientId)),
      changedFields: plan.changedFields,
    };
  }

  /**
   * 建档快照初始化（R9 / 裁定 G、Q）：把当时的 `TimeSlot` 默认阈值与全局 `SystemConfig`
   * 预警值复制成患者自己的行。写入后即快照，管理员后续改默认值**不影响存量**。
   *
   * **失败不阻断建档**：本方法内部吞掉所有异常并记 `warn`，调用方无需 try/catch。
   * ⚠️ 因此它必须在建档事务**提交之后**调用 —— 若在事务内，异常虽被吞掉但 Prisma 已标记
   * 事务失效，且「失败不阻断」与「同一事务原子」本身互斥（规格 R9 措辞矛盾，以裁定 Q 为准）。
   * 失败后果可接受：目标行缺失 → 前端显示「未设置」、判定回退全局阈值，可由回填脚本补齐。
   *
   * 此处**有意偏离** `AGENTS.md` §4.3「配置缺失抛 10000 拒绝写入」：控糖目标是辅助配置，
   * 不该阻断「患者住不进系统」这类核心业务（规格 R9 已登记该偏离）。
   */
  async initSnapshot(user: AuthenticatedUser, patientId: string): Promise<void> {
    try {
      const displaySet = await this.loadDisplaySet(user);
      const threshold = await this.systemConfig.getGlucoseAlertThreshold();

      await this.prisma.$transaction(async (tx) => {
        if (displaySet.length > 0) {
          // skipDuplicates：与回填脚本/重试并发时撞唯一索引不报错，保持幂等
          await tx.patientGlucoseTarget.createMany({
            data: displaySet.map((slot) => ({
              patientId,
              timeSlotCode: slot.code,
              valueDown: this.toDecimal(slot.valueDown),
              valueUp: this.toDecimal(slot.valueUp),
            })),
            skipDuplicates: true,
          });
        }
        await tx.patientAlertThreshold.upsert({
          where: { patientId },
          // 已有行不覆盖：快照只在首次建档时写，避免重跑把医护改过的值冲掉
          update: {},
          create: {
            patientId,
            lowThreshold: this.toDecimal(threshold.low),
            highThreshold: this.toDecimal(threshold.high),
          },
        });
      });
    } catch (error) {
      // 只记患者 ID 与错误，不记阈值明细：日志用于运维排查，不承载业务数据
      this.logger.warn(
        `[glucose-target] 建档快照初始化失败，患者 ${patientId} 的控糖目标留空（不阻断建档）`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * 展示集合（R1 / 裁定 U）：`enabled && type === 普通 && valueDown/valueUp 均非空`，按 sortOrder 升序。
   *
   * 复用 `TimeSlotService.list()` 再内存过滤，而不是另写一条时段查询：
   * 时段是公共字典（DICT 数据范围恒为全院），走既有方法可保持 scope 口径与排序一致，
   * 也避免两处查询在「停用项是否下发」上漂移。全表仅十余行，内存过滤无性能顾虑。
   * **禁止**硬编码 code 白名单或按 name 匹配（`AGENTS.md` §4.4：code 才是契约）。
   */
  private async loadDisplaySet(user: AuthenticatedUser): Promise<DisplaySlot[]> {
    const slots = await this.timeSlots.list(user);
    return slots
      .filter(
        (slot) =>
          slot.enabled &&
          slot.type === TIME_SLOT_CATEGORY.NORMAL &&
          slot.valueDown !== null &&
          slot.valueUp !== null,
      )
      .map((slot) => ({
        code: slot.code,
        // 上一行 filter 已排除 null，此处断言非空；用 ?? 兜底避免非空断言绕过类型检查
        name: slot.name,
        valueDown: slot.valueDown ?? 0,
        valueUp: slot.valueUp ?? 0,
      }));
  }

  /** 组装响应：展示集合为骨架，左连患者已配置的行，缺行即「未设置」（裁定 K） */
  private async buildResponse(
    user: AuthenticatedUser,
    patientId: string,
  ): Promise<PatientGlucoseTargetsResponse> {
    const [displaySet, rows, alert, defaults] = await Promise.all([
      this.loadDisplaySet(user),
      this.prisma.patientGlucoseTarget.findMany({
        where: { patientId },
        select: { timeSlotCode: true, valueDown: true, valueUp: true },
      }),
      this.prisma.patientAlertThreshold.findUnique({
        where: { patientId },
        select: { lowThreshold: true, highThreshold: true },
      }),
      this.loadDefaultAlert(),
    ]);
    const byCode = new Map(rows.map((row) => [row.timeSlotCode, row]));

    const targets: PatientGlucoseTargetItem[] = displaySet.map((slot) => {
      const row = byCode.get(slot.code);
      return {
        timeSlotCode: slot.code,
        timeSlotName: slot.name,
        valueDown: row ? Number(row.valueDown) : null,
        valueUp: row ? Number(row.valueUp) : null,
        defaultValueDown: slot.valueDown,
        defaultValueUp: slot.valueUp,
      };
    });

    return {
      targets,
      alert: {
        lowThreshold: alert ? Number(alert.lowThreshold) : null,
        highThreshold: alert ? Number(alert.highThreshold) : null,
        defaultLowThreshold: defaults.low,
        defaultHighThreshold: defaults.high,
      },
    };
  }

  /**
   * 全局预警阈值（供编辑弹框「恢复默认」）。读取失败返回 null 而**不抛错**（裁定 Q）：
   * `SystemConfigService` 对配置缺失/非法一律抛 10000，但它在这里只是辅助默认值，
   * 不该让医护连已配置的患者目标都查不到 —— 前端据 null 把按钮置灰 + tooltip 说明。
   */
  private async loadDefaultAlert(): Promise<{ low: number | null; high: number | null }> {
    try {
      const { low, high } = await this.systemConfig.getGlucoseAlertThreshold();
      return { low, high };
    } catch (error) {
      this.logger.warn(
        '[glucose-target] 全局预警阈值读取失败，default* 返回 null（不阻断查询）',
        error instanceof Error ? error.message : String(error),
      );
      return { low: null, high: null };
    }
  }

  /**
   * 与库中现有行 diff，得出三类操作与 `changedFields`。
   *
   * `changedFields` 只记**字段名不记值**（`audit.decorator.ts` 白名单口径、裁定 Q5）：
   * 整行增删记时段码（`BEDTIME`），单值变更记复合名（`FASTING.valueDown`），
   * 预警值记 `alert.lowThreshold` / `alert.highThreshold`。
   */
  private diff(
    patientId: string,
    input: UpdatePatientGlucoseTargetsInput,
    existingByCode: Map<string, { valueDown: Prisma.Decimal; valueUp: Prisma.Decimal }>,
    alert: { lowThreshold: Prisma.Decimal; highThreshold: Prisma.Decimal } | null,
  ) {
    const changedFields: string[] = [];
    const deleteCodes: string[] = [];
    const creates: Array<{
      patientId: string;
      timeSlotCode: string;
      valueDown: Prisma.Decimal;
      valueUp: Prisma.Decimal;
    }> = [];
    const updates: Array<{
      timeSlotCode: string;
      valueDown: Prisma.Decimal;
      valueUp: Prisma.Decimal;
    }> = [];

    for (const item of input.targets) {
      // 解构而非逐处 item.xxx：让 TS 在 null 检查后自行收窄类型，免掉 `as number` 断言
      const { timeSlotCode, valueDown, valueUp } = item;
      const row = existingByCode.get(timeSlotCode);

      // 两值同时为 null = 删行（裁定 V）；Zod 已保证不会只空一个，故此处无需再区分半空
      if (valueDown === null || valueUp === null) {
        if (row) {
          deleteCodes.push(timeSlotCode);
          changedFields.push(timeSlotCode);
        }
        continue;
      }

      if (!row) {
        creates.push({
          patientId,
          timeSlotCode,
          valueDown: this.toDecimal(valueDown),
          valueUp: this.toDecimal(valueUp),
        });
        changedFields.push(timeSlotCode);
        continue;
      }

      const prevDown = Number(row.valueDown);
      const prevUp = Number(row.valueUp);
      if (prevDown !== valueDown) {
        changedFields.push(`${timeSlotCode}.valueDown`);
      }
      if (prevUp !== valueUp) {
        changedFields.push(`${timeSlotCode}.valueUp`);
      }
      if (prevDown !== valueDown || prevUp !== valueUp) {
        updates.push({
          timeSlotCode,
          valueDown: this.toDecimal(valueDown),
          valueUp: this.toDecimal(valueUp),
        });
      }
    }

    const prevLow = alert ? Number(alert.lowThreshold) : null;
    const prevHigh = alert ? Number(alert.highThreshold) : null;
    if (prevLow !== input.alert.lowThreshold) {
      changedFields.push('alert.lowThreshold');
    }
    if (prevHigh !== input.alert.highThreshold) {
      changedFields.push('alert.highThreshold');
    }

    return { changedFields, deleteCodes, creates, updates };
  }

  /** 提交的时段码必须都在展示集合内，否则 10001（防止给强化/随机/停用时段写目标，R3） */
  private assertCodesInDisplaySet(
    input: UpdatePatientGlucoseTargetsInput,
    displaySet: DisplaySlot[],
  ): void {
    const allowed = new Set(displaySet.map((slot) => slot.code));
    const details: FieldError[] = input.targets
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !allowed.has(item.timeSlotCode))
      // 只取 index：field 用下标定位到具体输入框，item 在此已无用（解构它会触发 TS6133）
      .map(({ index }) => ({
        field: `targets[${index}].timeSlotCode`,
        message: '该时段不支持设置控糖目标',
      }));
    if (details.length > 0) {
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }
  }

  /** 读校验：患者存在且未归档 + 落在当前账号数据范围内（跨科室抛 30002 并记 DENIED 审计） */
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
   * 写校验：在读校验之上追加「仅在院可改」（R11 / 裁定 W），与现有「添加血糖」按钮同口径。
   * 出院 / 归档患者只能看不能改 —— 院外患者的控糖目标已无临床意义，改动只会污染历史判定基准。
   */
  private async assertPatientEditable(user: AuthenticatedUser, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      select: { departmentId: true, archivedAt: true, status: true },
    });
    if (!patient || patient.archivedAt) {
      throw new BusinessException(ERROR_CODES.PATIENT_NOT_FOUND);
    }
    assertInScope(user, RESOURCE.PATIENT, { departmentId: patient.departmentId });
    if (patient.status !== PATIENT_STATUS.INPATIENT) {
      throw new BusinessException(ERROR_CODES.PATIENT_INVALID_STATE);
    }
  }

  private toDecimal(value: number): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(1));
  }
}
