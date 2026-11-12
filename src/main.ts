import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AllExceptionsFilter } from './filter/all-exceptions.filter';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // whitelist: true,
      // forbidNonWhitelisted: true,
    }),
  );

  //  Prefijo global
  app.setGlobalPrefix('/api');

  app.useStaticAssets(join(__dirname, '..', 'storage'), {
    prefix: '/storage/',
  });

  app.use(cookieParser());

  const config = app.get(ConfigService);
  const allowedOrigins = [
    config.get<string>('FRONTEND_URL'),
    config.get<string>('APP_URL'),
    ...(config.get<string>('CSRF_ALLOWED_ORIGINS') ?? '').split(','),
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s);

  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  });

  await app.listen(process.env.PORT || 3000, '0.0.0.0');
}

bootstrap();
