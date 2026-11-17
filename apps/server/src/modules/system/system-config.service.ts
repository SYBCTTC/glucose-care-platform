import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, GLUCOSE_VALUE_MAX, GLUCOSE_VALUE_MIN } from '@gc/shared';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * `SystemConfig` 表的键名。
 *
 * 键是契约：改键名等于改配置口径，必须同步 seed 与运维文档。
 * 表里已有的三行由 `prisma/seed.ts` 写入，本服务只读不写
 * （维护接口属 ROADMAP P5-3，尚未实现）。
 */
export const SYSTEM_CONFIG_KEY = {
  /** 低血糖告警阈值（mmol/L），低于此值判定结果类型 '0' */
  GLUCOSE_LOW_THRESHOLD: 'glucose.low_threshold',
  /** 高血糖告警阈值（mmol/L），高于此值判定结果类型 '2' */
  GLUCOSE_HIGH_THRESHOLD: 'glucose.high_threshold',
  /** 设备离线判定时长（小时） */
  DEVICE_OFFLINE_HOURS: 'device.offline_hours',
} as const;

/** 血糖告警阈值（mmol/L） */
export interface GlucoseAlertThreshold {
  low: number;
  high: number;
}

/**
 * 系统参数读取。
 *
 * 为什么要有这个服务：`AGENTS.md` §4.3 要求告警阈值可配置、禁止硬编码在业务代码。
 * 此前 `GlucoseService` 用 `@gc/shared` 的 `DEFAULT_ALERT_RANGE` 常量占位，
 * 该常量已删除，阈值一律从 `SystemConfig` 读取。
 *
 * 为什么不做内存缓存：手工录入量级下每次多一次两行索引查询可忽略，
 * 而缓存会引入"改了配置不生效"的排查成本。等 P5-3 维护接口落地、
 * 出现高频读取场景时再加带失效通知的缓存。
 *
 * 失败策略：**读不到就抛错，不退回任何默认值**。
 * 阈值缺失或自相矛盾属于部署配置错误，静默用兜底常量会让血糖判定结果悄悄失真——
 * 医疗数据宁可拒绝写入，也不能按错误阈值分类。
 */
@Injectable()
export class SystemConfigService {
  private readonly logger = new Logger(SystemConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 读取血糖告警阈值。
   *
   * @throws BusinessException 10000（HTTP 500）配置缺失、非法或 low >= high。
   *   5xx 的 message 会被 `HttpExceptionFilter` 屏蔽，真实原因只进服务端日志。
   */
  async getGlucoseAlertThreshold(): Promise<GlucoseAlertThreshold> {
    const rows = await this.prisma.systemConfig.findMany({
      where: {
        key: {
          in: [
            SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD,
            SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD,
          ],
        },
      },
      select: { key: true, value: true },
    });
    const values = new Map(rows.map((row) => [row.key, row.value]));

    const low = this.parseThreshold(
      values.get(SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD),
      SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD,
    );
    const high = this.parseThreshold(
      values.get(SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD),
      SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD,
    );

    if (low >= high) {
      // 低阈值不低于高阈值时，'0'/'1'/'2' 的判定区间会塌缩，结果类型全部失真
      return this.fail(
        `血糖阈值配置自相矛盾：${SYSTEM_CONFIG_KEY.GLUCOSE_LOW_THRESHOLD}=${low} ` +
          `>= ${SYSTEM_CONFIG_KEY.GLUCOSE_HIGH_THRESHOLD}=${high}`,
      );
    }

    return { low, high };
  }

  /**
   * 解析单个阈值。`SystemConfig.value` 是 VarChar，必须显式转数字并校验。
   * 合法区间取血糖可读范围（`GLUCOSE_VALUE_MIN` ~ `GLUCOSE_VALUE_MAX`）：
   * 阈值超出仪器可测范围说明配置写错了，不是"宽松"而是无效。
   */
  private parseThreshold(raw: string | undefined, key: string): number {
    if (raw === undefined || raw.trim() === '') {
      return this.fail(`系统配置缺失：${key}（请检查 SystemConfig 表与 seed 是否执行）`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      return this.fail(`系统配置 ${key} 不是合法数字：${raw}`);
    }
    if (value < GLUCOSE_VALUE_MIN || value > GLUCOSE_VALUE_MAX) {
      return this.fail(
        `系统配置 ${key}=${value} 超出血糖合法范围 ` +
          `${GLUCOSE_VALUE_MIN}~${GLUCOSE_VALUE_MAX} mmol/L`,
      );
    }
    return value;
  }

  /** 统一出口：真实原因进日志（含键名与原始值，不含患者信息），对外只给 10000 */
  private fail(reason: string): never {
    this.logger.error(`[system-config] ${reason}`);
    throw new BusinessException(ERROR_CODES.INTERNAL_ERROR);
  }
}
