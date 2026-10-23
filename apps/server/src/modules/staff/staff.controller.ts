import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PERMISSION, RESOURCE } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { StaffService } from './staff.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  /** 本部门医护列表（公共数据，供操作人/责任医生下拉） */
  @Get()
  @RequirePermissions(PERMISSION.OPERATOR_VIEW)
  @RequireDataScope(RESOURCE.STAFF)
  async list(@Req() request: Request) {
    return ok(await this.staffService.list(request.user as AuthenticatedUser));
  }
}
