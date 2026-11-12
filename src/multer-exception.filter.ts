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

    // 👇 Manejar errores de Multer
    if (exception instanceof MulterError) {
      let message = 'Error al subir el archivo';
      if (exception.code === 'LIMIT_FILE_SIZE') {
        message = 'El archivo supera el tamaño máximo permitido de 2MB';
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

    // 👇 Capturar el 413 que viene como objeto plano (no HttpException)
    if (exception instanceof Error && (exception as any).status === 413) {
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'El archivo supera el tamaño máximo permitido de 2MB',
      });
    }

    // 👇 Capturar HttpException con status 413
    if (exception instanceof HttpException && exception.getStatus() === 413) {
      return response.status(400).json({
        statusCode: 400,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: 'El archivo supera el tamaño máximo permitido de 2MB',
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
      message,
    });
  }
}
