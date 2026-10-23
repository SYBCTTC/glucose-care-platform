import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/** 标注为公开接口，跳过 JWT 校验（如登录、健康检查） */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);