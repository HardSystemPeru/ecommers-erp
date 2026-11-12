import { Injectable, Logger } from '@nestjs/common';

/**
 * Almacén de tokens revocados. Interfaz desacoplada para poder cambiar a Redis
 * sin tocar la lógica.
 *
 * Para pasar a Redis (recomendado en multi-instancia), implementar esta misma
 * interfaz con ioredis y sustituir la instancia en `TokenRevocationService`.
 */
export interface RevocationStore {
  isRevoked(jti: string): Promise<boolean>;
  revoke(jti: string, expiresAt: number): Promise<void>;
}

@Injectable()
class InMemoryRevocationStore implements RevocationStore {
  private readonly map = new Map<string, number>(); // jti -> expiresAt (ms)
  private readonly sweep = setInterval(
    () => {
      const now = Date.now();
      for (const [k, v] of this.map) if (v < now) this.map.delete(k);
    },
    5 * 60 * 1000,
  );

  constructor() {
    this.sweep.unref?.();
  }

  async isRevoked(jti: string): Promise<boolean> {
    const exp = this.map.get(jti);
    if (!exp) return false;
    if (exp < Date.now()) {
      this.map.delete(jti);
      return false;
    }
    return true;
  }

  async revoke(jti: string, expiresAt: number): Promise<void> {
    this.map.set(jti, expiresAt);
  }
}

@Injectable()
export class TokenRevocationService {
  private readonly logger = new Logger(TokenRevocationService.name);
  private readonly store: RevocationStore = new InMemoryRevocationStore();

  /** Revoca un token. `expiresAtMs` = expiración natural del JWT (para auto-limpieza). */
  async revoke(jti: string | undefined, expiresAtMs: number): Promise<void> {
    if (!jti) return;
    await this.store.revoke(jti, expiresAtMs);
    this.logger.log(`Token revocado jti=${jti}`);
  }

  async isRevoked(jti: string | undefined): Promise<boolean> {
    if (!jti) return false;
    return this.store.isRevoked(jti);
  }
}
