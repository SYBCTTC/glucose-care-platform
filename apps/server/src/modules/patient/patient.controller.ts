import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  createPatientSchema,
  patientIdSchema,
  patientListQuerySchema,
  PERMISSION,
  RESOURCE,
  updatePatientSchema,
} from '@gc/shared';
import type { CreatePatientInput, PatientListQuery, UpdatePatientInput } from '@gc/shared';
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

  /**
   * 患者详情（编辑弹窗回填）。
   * 注意：以下两个带 :id 的路由必须声明在 inpatient / discharged 之后，
   * 否则 Nest 会先匹配到 :id，把 "inpatient" 当成患者 ID。
   */
  @Get(':id')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_VIEW')
  async detail(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.patientService.detail(request.user as AuthenticatedUser, params.id);
    return ok(result);
  }

  /** 患者信息编辑：出院校验与数据范围校验都在 service，controller 只做鉴权与转发 */
  @Patch(':id')
  @RequirePermissions(PERMISSION.PATIENT_UPDATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_UPDATE')
  async update(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updatePatientSchema)) body: UpdatePatientInput,
  ) {
    const result = await this.patientService.update(
      request.user as AuthenticatedUser,
      params.id,
      body,
    );
    return ok(result);
  }
}
