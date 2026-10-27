import { Injectable } from '@nestjs/common';
import { RESOURCE } from '@gc/shared';
import type { DictItemOption, DictType } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

@Injectable()
export class DictService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 按字典类型取可用字典项（公共数据）。
   * - 只返回 enabled 项：下线某个取值 = 置 enabled=false，历史数据里的 code 仍可展示
   * - 按 sortOrder 升序，同值再按 code，保证前端顺序稳定
   * - 字典为院内基础数据，全院可见（buildScopeWhere 对 DICT 返回 {}）
   */
  async list(user: AuthenticatedUser, dictType: DictType): Promise<DictItemOption[]> {
    const where = {
      ...buildScopeWhere(user, RESOURCE.DICT),
      dictType,
      enabled: true,
    } as unknown as Prisma.DictItemWhereInput;

    return this.prisma.dictItem.findMany({
      where,
      select: { code: true, label: true, color: true, checkable: true, counted: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }
}
