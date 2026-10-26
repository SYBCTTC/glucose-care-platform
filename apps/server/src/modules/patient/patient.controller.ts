import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { createPatientSchema, patientListQuerySchema, PERMISSION, RESOURCE } from '@gc/shared';
import type { CreatePatientInput, PatientListQuery } from '@gc/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok, page } from '../../common/utils/response';
import { PatientService } from './patient.service';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  /** 患者建档（添加患者）：独立权限点，与编辑等管理动作分离 */
  @Post()
  @RequirePermissions(PERMISSION.PATIENT_CREATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_CREATE')
  async create(
    @Req() request: Request,
    @Body(new ZodValidationPipe(createPatientSchema)) body: CreatePatientInput,
  ) {
    const result = await this.patientService.create(request.user as AuthenticatedUser, body);
    return ok(result);
  }

  /** 住院患者列表：权限点独立，便于后续按角色只开放出院患者 */
  @Get('inpatient')
  @RequirePermissions(PERMISSION.PATIENT_INPATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  async inpatient(
    @Req() request: Request,
    @Query(new ZodValidationPipe(patientListQuerySchema)) query: PatientListQuery,
  ) {
    const result = await this.patientService.list(
      request.user as AuthenticatedUser,
      'INPATIENT',
      query,
    );
    return page(result.items, result.total, query.page, query.pageSize);
  }

  /** 出院患者列表 */
  @Get('discharged')
  @RequirePermissions(PERMISSION.PATIENT_DISCHARGED_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  async discharged(
    @Req() request: Request,
    @Query(new ZodValidationPipe(patientListQuerySchema)) query: PatientListQuery,
  ) {
    const result = await this.patientService.list(
      request.user as AuthenticatedUser,
      'DISCHARGED',
      query,
    );
    return page(result.items, result.total, query.page, query.pageSize);
  }
}
