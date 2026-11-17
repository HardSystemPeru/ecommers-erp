import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MulterError } from 'multer';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (exception instanceof MulterError) {
      let message = 'Error al subir el archivo';
      if (exception.code === 'LIMIT_FILE_SIZE') {
        message = 'El archivo supera el tamaño máximo permitido (20MB)';
      } else if (exception.code === 'LIMIT_UNEXPECTED_FILE') {
        message = 'Campo de archivo inesperado';
      }
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message,
      });
    }

    if (exception instanceof Error && (exception as any).status === 413) {
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'El archivo supera el tamaño máximo permitido (20MB)',
      });
    }

    if (exception instanceof HttpException && exception.getStatus() === 413) {
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'El archivo supera el tamaño máximo permitido (20MB)',
      });
    }

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(typeof message === 'object' && message !== null
        ? message
        : { message }),
    });
  }
}
