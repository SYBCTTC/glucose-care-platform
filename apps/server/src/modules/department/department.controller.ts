import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSION, RESOURCE } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { DepartmentService } from './department.service';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /** 科室列表（公共数据） */
  @Get()
  @RequirePermissions(PERMISSION.DEPARTMENT_VIEW)
  @RequireDataScope(RESOURCE.DEPARTMENT)
  async list(@Req() request: Request) {
    return ok(await this.departmentService.list(request.user as AuthenticatedUser));
  }
}
