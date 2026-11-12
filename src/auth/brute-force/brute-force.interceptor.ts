import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { BruteForceService } from './brute-force.service';

/** Obtiene la IP real del cliente aunque esté detrás de un proxy reverso. */
function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Normaliza la cuenta objetivo (email/username) para el seguimiento por cuenta. */
function getAccount(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw =
    (body as Record<string, unknown>).email ??
    (body as Record<string, unknown>).username ??
    (body as Record<string, unknown>).document_number;
  if (typeof raw !== 'string' || !raw) return undefined;
  return raw.trim().toLowerCase();
}

/**
 * Aplica la protección anti-fuerza-bruta en los endpoints de autenticación:
 *  - Antes del handler: si IP o cuenta están bloqueadas -> 429 + Retry-After.
 *  - En éxito: limpia los contadores.
 *  - En fallo 401 (credenciales inválidas): incrementa los contadores.
 */
@Injectable()
export class BruteForceInterceptor implements NestInterceptor {
  constructor(private readonly bf: BruteForceService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const ip = getClientIp(req);
    const account = getAccount(req.body);

    const block = this.bf.isBlocked(ip, account);
    if (block.blocked) {
      res.setHeader('Retry-After', String(block.retryAfter));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Demasiados intentos fallidos. Reintente en ${block.retryAfter} segundos.`,
          error: 'Too Many Requests',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return next.handle().pipe(
      tap(() => this.bf.recordSuccess(ip, account)),
      catchError((err) => {
        if (
          err instanceof HttpException &&
          err.getStatus() === HttpStatus.UNAUTHORIZED
        ) {
          this.bf.recordFailure(ip, account);
        }
        return throwError(() => err);
      }),
    );
  }
}
