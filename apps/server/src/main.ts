import 'reflect-metadata';
import compression from 'compression';
import helmet from 'helmet';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(compression());

  // 入参校验由各路由通过 new ZodValidationPipe(schema) 显式声明（与前端共享同一份 schema）
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = app.get(ConfigService);
  const allowedOrigins = config.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: allowedOrigins ? allowedOrigins.split(',') : true,
    credentials: true,
  });

  // 接口文档仅在非生产环境开启（内网生产不暴露 Swagger）
  if (config.get<string>('NODE_ENV') !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('血糖数据与设备管理平台')
        .setDescription('医护端接口文档。注意：生产环境不启用本文档。')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get<number>('SERVER_PORT', 3000);
  await app.listen(port, '0.0.0.0');
  console.warn(`[gc-server] listening on http://0.0.0.0:${port}/api`);
}

void bootstrap();