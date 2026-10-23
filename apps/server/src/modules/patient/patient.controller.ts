import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { patientListQuerySchema, PERMISSION, RESOURCE } from '@gc/shared';
import type { PatientListQuery } from '@gc/shared';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { page } from '../../common/utils/response';
import { PatientService } from './patient.service';

@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

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
