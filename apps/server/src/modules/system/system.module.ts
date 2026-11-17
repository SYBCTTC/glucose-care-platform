import { Module } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';

/**
 * 系统参数模块（`SystemConfig` 表）。
 *
 * 目前只读、无 controller：维护接口属 ROADMAP P5-3，尚未实现。
 * 导出 service 供业务模块注入（跨模块调用走 module 导出，见 AGENTS.md §3），
 * 与 `TimeSlotModule` 导出 `TimeSlotService` 的做法一致。
 */
@Module({
  providers: [SystemConfigService],
  exports: [SystemConfigService],
})
export class SystemModule {}
