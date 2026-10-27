import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { dictTypeParamSchema, PERMISSION, RESOURCE } from '@gc/shared';
import type { DictType } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { DictService } from './dict.service';

@Controller('dicts')
export class DictController {
  constructor(private readonly dictService: DictService) {}

  /** 动态字典（公共数据）：登录后一次性加载，按 dictType 取启用项 */
  @Get(':dictType')
  @RequirePermissions(PERMISSION.DICT_VIEW)
  @RequireDataScope(RESOURCE.DICT)
  async list(
    @Req() request: Request,
    @Param(new ZodValidationPipe(dictTypeParamSchema)) params: { dictType: DictType },
  ) {
    return ok(await this.dictService.list(request.user as AuthenticatedUser, params.dictType));
  }
}
