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
  // POST 路径无 :id，新患者 ID 只在响应信封里，故显式声明从 data.id 取，
  // 否则建档审计的 targetType/targetId 恒为空，事后无法按患者追溯建档操作。
  @Audit('PATIENT_CREATE', { targetType: 'PATIENT', targetIdFrom: 'data.id' })
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

  /**
   * 住院记录树（R24）：报表查询表单「住院记录/科室记录」下拉的数据源。
   * 一次性树形下发（裁定 Q4），前端联动纯本地。属敏感查询：逐条审计 ADMISSION_QUERY。
   */
  @Get(':id/admissions')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('ADMISSION_QUERY', { targetType: 'PATIENT' })
  async admissions(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.patientService.admissions(
      request.user as AuthenticatedUser,
      params.id,
    );
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

  /**
   * 办理住院：出院患者 → 住院患者。
   * 状态流转校验与数据范围都在 service；审计沿用 PATIENT_MANAGE
   * （AuditAction 是 Prisma 枚举，新增专用值需改 schema + migration，走人工评审）。
   */
  @Post(':id/admit')
  @RequirePermissions(PERMISSION.PATIENT_ADMIT)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_MANAGE')
  async admit(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.patientService.admit(request.user as AuthenticatedUser, params.id);
    return ok(result);
  }
}
