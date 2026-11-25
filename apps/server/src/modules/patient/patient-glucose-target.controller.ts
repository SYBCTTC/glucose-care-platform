import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  patientIdSchema,
  PERMISSION,
  RESOURCE,
  updatePatientGlucoseTargetsSchema,
} from '@gc/shared';
import type { UpdatePatientGlucoseTargetsInput } from '@gc/shared';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireDataScope } from '../../common/data-scope/data-scope.decorator';
import { RequirePermissions } from '../../common/guards/permissions.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types';
import { ok } from '../../common/utils/response';
import { PatientGlucoseTargetService } from './patient-glucose-target.service';

/**
 * 患者控糖目标（各时段血糖上下限 + 低/高血糖预警值）。
 * 规格 `docs/specs/patient-glucose-target.md` §3 §5。
 *
 * 与 `PatientController` 共用 `patients` 前缀：Nest 允许多个 controller 挂同一前缀。
 * 子路径 `:id/glucose-targets` 是**单段**，与两段的 `:id/glucose/:recordId` 不会互相吞掉，
 * 故无声明顺序要求 —— 顺序坑只存在于 `:id` 与 `inpatient`/`discharged` 这类**同段静态名**之间
 * （见 `patient.controller.ts` 的注释）。
 */
@Controller('patients')
export class PatientGlucoseTargetController {
  constructor(private readonly targetService: PatientGlucoseTargetService) {}

  /**
   * 查询控糖目标（GET）。
   *
   * 权限沿用 `patient:view`（查看不另设权限点，裁定 H）。
   *
   * 审计 `PATIENT_TARGET_VIEW`：原裁定 L 为「查看不留痕、由详情页 `PATIENT_VIEW` 兼顶」，
   * 2026-11-25 需求人复核后**改为留痕**——既有单患者 GET 一律留痕
   * （`PATIENT_VIEW` / `ADMISSION_QUERY` / `PATIENT_NAME_PLAIN_VIEW`），不留痕会让
   * 越权「查看」控糖目标在审计表筛不出（越权「编辑」却有 `PATIENT_TARGET_UPDATE`），
   * 口径不一致且等保三级下敏感数据越权尝试应可追溯。
   * `targetType` 显式声明为 `'PATIENT'`（`AGENTS.md` §5.2），`targetId` 由拦截器取 `params.id`。
   */
  @Get(':id/glucose-targets')
  @RequirePermissions(PERMISSION.PATIENT_VIEW)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_TARGET_VIEW', { targetType: 'PATIENT' })
  async get(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
  ) {
    const result = await this.targetService.get(request.user as AuthenticatedUser, params.id);
    return ok(result);
  }

  /**
   * 编辑控糖目标（PATCH）：全量提交展示集合，后端 diff 出增删改。
   *
   * 独立权限点 `patient:target:update`（裁定 H，**不复用** `patient:update`）：
   * 改控糖目标会改变该患者后续所有血糖的 `resultType` 判定基准，敏感度高于改床号/责任医生，
   * 需可单独授权与单独审计过滤。
   *
   * 审计 `PATIENT_TARGET_UPDATE`：`targetType` 显式声明为 `'PATIENT'`（`AGENTS.md` §5.2 要求
   * 非默认对象必须显式传），`targetId` 由拦截器自动取 `params.id`；
   * `detail.changedFields` 由 service 回显、拦截器按既有白名单提取（只记字段名，裁定 Q5）。
   */
  @Patch(':id/glucose-targets')
  @RequirePermissions(PERMISSION.PATIENT_TARGET_UPDATE)
  @RequireDataScope(RESOURCE.PATIENT)
  @Audit('PATIENT_TARGET_UPDATE', { targetType: 'PATIENT' })
  async update(
    @Req() request: Request,
    @Param(new ZodValidationPipe(patientIdSchema)) params: { id: string },
    @Body(new ZodValidationPipe(updatePatientGlucoseTargetsSchema))
    body: UpdatePatientGlucoseTargetsInput,
  ) {
    const result = await this.targetService.update(
      request.user as AuthenticatedUser,
      params.id,
      body,
    );
    return ok(result);
  }
}
