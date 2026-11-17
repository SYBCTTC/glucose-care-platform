import { Injectable } from '@nestjs/common';
import { RESOURCE } from '@gc/shared';
import type { TimeSlotCategory, TimeSlotOption } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

@Injectable()
export class TimeSlotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 时段（公共数据）。
   * - 按 sortOrder、code 升序：普通在前、特殊居中、强化在后（顺序由数据保证，服务端不再按 type 分组）
   * - **停用项一并下发**：历史血糖的 mealContext 仍需展示名称；下拉由前端过滤 enabled
   * - 时段为院内基础数据，全院可见（buildScopeWhere 对 DICT 返回 {}）
   */
  async list(user: AuthenticatedUser): Promise<TimeSlotOption[]> {
    const where = { ...buildScopeWhere(user, RESOURCE.DICT) } as Prisma.TimeSlotWhereInput;

    const rows = await this.prisma.timeSlot.findMany({
      where,
      select: {
        code: true,
        name: true,
        type: true,
        startTime: true,
        endTime: true,
        valueDown: true,
        valueUp: true,
        sortOrder: true,
        enabled: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    return rows.map(
      (row): TimeSlotOption => ({
        code: row.code,
        name: row.name,
        type: row.type as TimeSlotCategory,
        startTime: row.startTime,
        endTime: row.endTime,
        // 派生字段：不落库，避免与两列不一致
        timeScope:
          row.startTime && row.endTime ? `${row.startTime}-${row.endTime}` : null,
        valueDown: row.valueDown === null ? null : Number(row.valueDown),
        valueUp: row.valueUp === null ? null : Number(row.valueUp),
        sortOrder: row.sortOrder,
        enabled: row.enabled,
      }),
    );
  }

  /**
   * 按 code 取时段（**含停用项**），供录入类接口做运行时校验；返回 null 表示库里没有这个 code。
   *
   * 时段可用性只能查库判断：`@gc/shared` 的静态 `TIME_SLOTS` 已降级为 seed 数据源，
   * 拿它做白名单会在"库里新增/停用了时段"时误判。
   * 与 list() 同样走 DICT 数据范围（buildScopeWhere 对 DICT 返回 {}，即全院可见），保持口径一致。
   */
  async findByCode(
    user: AuthenticatedUser,
    code: string,
  ): Promise<{ code: string; enabled: boolean } | null> {
    const where = { ...buildScopeWhere(user, RESOURCE.DICT), code } as Prisma.TimeSlotWhereInput;
    return this.prisma.timeSlot.findFirst({ where, select: { code: true, enabled: true } });
  }
}
