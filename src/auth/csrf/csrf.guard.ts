import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Defensa CSRF (defense-in-depth sobre la cookie httpOnly SameSite=lax).
 *
 * Para métodos que cambian estado (POST/PUT/PATCH/DELETE) exige que el
 * encabezado `Origin` (o `Referer`) sea:
 *   - same-origin (mismo host que el servidor), o
 *   - un origen explícitamente permitido (CSRF_ALLOWED_ORIGINS / FRONTEND_URL / APP_URL).
 *
 * No requiere que el frontend envíe un token CSRF: basta con que el navegador
 * adjunte el `Origin` correcto, que un sitio malicioso no puede falsificar en
 * una petición cross-site. Así no se rompe el frontend actual.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  private readonly allowedOrigins: string[];

  constructor(private readonly config: ConfigService) {
    const configured = (this.config.get<string>('CSRF_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const fallback = [
      this.config.get<string>('FRONTEND_URL'),
      this.config.get<string>('APP_URL'),
    ].filter((v): v is string => !!v);

    this.allowedOrigins = Array.from(new Set([...configured, ...fallback]));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (this.safeMethods.has(req.method)) return true;

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    // Cliente no navegador (server-to-server) sin Origin/Referer: se permite.
    if (!origin && !referer) return true;

    const host = req.headers.host;

    if (origin) {
      const url = this.safeUrl(origin);
      if (!url) throw new ForbiddenException('Origen no válido');
      if (this.isAllowed(url, host)) return true;
      throw new ForbiddenException(
        'Solicitud bloqueada por política CSRF (Origin no permitido)',
      );
    }

    if (referer) {
      const url = this.safeUrl(referer);
      if (url && this.isAllowed(url, host)) return true;
    }

    throw new ForbiddenException('Solicitud bloqueada por política CSRF');
  }

  private safeUrl(value: string): URL | null {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  private isAllowed(url: URL, host?: string): boolean {
    if (host && url.host === host) return true; // same-origin
    return this.allowedOrigins.some((a) => {
      try {
        return new URL(a).host === url.host;
      } catch {
        return false;
      }
    });
  }
}
