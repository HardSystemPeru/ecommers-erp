// src/filters/all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Esto te mostrará el error real en consola
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
