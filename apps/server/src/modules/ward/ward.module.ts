import { Module } from '@nestjs/common';
import { WardController } from './ward.controller';
import { WardService } from './ward.service';

/**
 * 虚拟病区模块。
 *
 * 不 import PatientModule：复用的 `PATIENT_PUBLIC_SELECT` / `toListItem` 是
 * patient.service.ts 导出的**普通函数与常量**（非注入式 provider），
 * 与 GlucoseModule 复用它们的方式一致，不构成模块依赖也就不会循环依赖。
 * PrismaModule 是全局模块，无需显式导入。
 */
@Module({
  controllers: [WardController],
  providers: [WardService],
})
export class WardModule {}
