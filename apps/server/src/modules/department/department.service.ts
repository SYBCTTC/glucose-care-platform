import { Injectable } from '@nestjs/common';
import { RESOURCE } from '@gc/shared';
import type { Prisma } from '@prisma/client';
import { buildScopeWhere } from '../../common/data-scope/scope.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types';

/** 科室下拉项（公共数据，登录后一次性加载） */
export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
}

@Injectable()
export class DepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  /** 科室为院内基础组织数据，全院可见（buildScopeWhere 对 DEPARTMENT 返回 {}） */
  async list(user: AuthenticatedUser): Promise<DepartmentOption[]> {
    const where = buildScopeWhere(user, RESOURCE.DEPARTMENT) as unknown as Prisma.DepartmentWhereInput;
    return this.prisma.department.findMany({
      where,
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  }
}
