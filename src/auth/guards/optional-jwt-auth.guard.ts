// src/auth/guards/optional-jwt-auth.guard.ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // No lanza error si no hay token o es inválido; solo no popula req.user
  handleRequest(err: any, user: any) {
    return user || null;
  }

  canActivate(context: ExecutionContext) {
    return (super.canActivate(context) as Promise<boolean>) ?? true;
  }
}
