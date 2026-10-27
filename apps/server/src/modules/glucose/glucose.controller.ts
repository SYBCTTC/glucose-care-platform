import { Body, Controller, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createGlucoseSchema,
  patientIdSchema,
  PERMISSION,
  RESOURCE,
} from '@gc/shared';
import type { CreateGlucoseInput } from '@gc/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { GlucoseService } from './glucose.service';

/**
 * 血糖记录（手工录入）。
 * 路由挂在 /patients/:id 之下：血糖永远属于某个患者，
 * 与 patient 模块共用同一套鉴权、数据范围与审计口径。
 */
@Controller('patients')
export class GlucoseController {
  constructor(private readonly glucoseService: GlucoseService) {}

  @Post(':id/glucose')
  @RequirePermissions(PERMISSION.GLUCOSE_CREATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('GLUCOSE_CREATE')
  async create(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Body(new ZodValidationPipe(createGlucoseSchema)) body: CreateGlucoseInput,
  ) {
    const result = await this.glucoseService.create(
      request.user as AuthenticatedUser,
      params.id,
      body,
    );
    return ok(result);
  }
}
