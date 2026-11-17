// src/filters/all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // Respuestas 422 específicas para image_url de artículos (compat ERP)
    if (exception instanceof MulterError) {
      const path = request?.url || '';
      if (
        path.includes('/articles-save') ||
        path.includes('/articlesupdate')
      ) {
        const msg =
          exception.code === 'LIMIT_FILE_SIZE'
            ? 'La imagen no debe pesar más de 5 MB.'
            : 'La imagen no es válida.';
        return response.status(422).json({
          message: 'La imagen no es válida.',
          errors: { image_url: [msg] },
        });
      }
      const message =
        exception.code === 'LIMIT_FILE_SIZE'
          ? 'El archivo supera el tamaño máximo permitido (20MB)'
          : 'Error al subir el archivo';
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message,
      });
    }

    if (exception instanceof Error && (exception as any).status === 413) {
      const path = request?.url || '';
      if (path.includes('/articles-save') || path.includes('/articlesupdate')) {
        return response.status(422).json({
          message: 'La imagen no es válida.',
          errors: {
            image_url: ['La imagen no debe pesar más de 5 MB.'],
          },
        });
      }
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    const payload =
      exceptionResponse && typeof exceptionResponse === 'object'
        ? exceptionResponse
        : { message: exceptionResponse ?? String(exception) };

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...payload,
    });
  }
}
