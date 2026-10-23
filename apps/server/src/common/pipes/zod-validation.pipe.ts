import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { ERROR_CODES } from '@gc/shared';
import type { FieldError } from '@gc/shared';
import { BusinessException } from '../exceptions/business.exception';

/**
 * 全局 Zod 校验管道。用法：
 *   constructor(@Body(new ZodValidationPipe(schema)) body: z.infer<typeof schema>) {}
 * 校验 schema 与前端共享（packages/shared），避免前后端口径不一致。
 *
 * 校验失败统一返回业务码 10001，details 为字段级错误，供前端映射到表单项。
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details: FieldError[] = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '_',
        message: issue.message,
      }));
      throw new BusinessException(ERROR_CODES.VALIDATION_FAILED, undefined, details);
    }
    return result.data;
  }
}
