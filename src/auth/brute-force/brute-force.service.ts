import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AttemptRecord {
  count: number;
  firstAt: number;
  blockCount: number; // número de bloqueos acumulados (para lockout progresivo)
  blockedUntil: number; // epoch ms; 0 = no bloqueado
}

/**
 * Protección profesional contra fuerza bruta.
 *
 * Registra intentos fallidos por IP y por cuenta (email/username) por separado.
 * Superado el umbral dentro de la ventana, aplica un BLOQUEO TEMPORAL que se
 * duplica en cada reincidencia (lockout progresivo), con tope máximo.
 *
 * Nota: el almacenamiento es en memoria (rápido, sin dependencias). Para
 * despliegues multi-instancia o que sobrevivan reinicios, sustituir los Maps
 * por Redis/DB (la interfaz de este servicio no cambia).
 */
@Injectable()
export class BruteForceService {
  private readonly logger = new Logger(BruteForceService.name);

  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly maxBlockMs: number;

  private readonly ipStore = new Map<string, AttemptRecord>();
  private readonly accountStore = new Map<string, AttemptRecord>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor(private readonly config: ConfigService) {
    this.maxAttempts = Number(this.config.get('BRUTEFORCE_MAX_ATTEMPTS') ?? 5);
    this.windowMs = Number(
      this.config.get('BRUTEFORCE_WINDOW_MS') ?? 15 * 60 * 1000,
    );
    this.blockMs = Number(
      this.config.get('BRUTEFORCE_BLOCK_MS') ?? 15 * 60 * 1000,
    );
    this.maxBlockMs = Number(
      this.config.get('BRUTEFORCE_MAX_BLOCK_MS') ?? 24 * 60 * 60 * 1000,
    );

    // Elimina registros expirados para evitar fuga de memoria
    this.sweepInterval = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweepInterval.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.sweepInterval);
  }

  /** Devuelve si IP o cuenta están bloqueadas y cuánto falta (segundos). */
  isBlocked(
    ip: string,
    account?: string,
  ): { blocked: boolean; retryAfter: number } {
    const ipRec = this.ipStore.get(ip);
    if (ipRec && ipRec.blockedUntil > Date.now()) {
      return {
        blocked: true,
        retryAfter: Math.ceil((ipRec.blockedUntil - Date.now()) / 1000),
      };
    }
    if (account) {
      const accRec = this.accountStore.get(account);
      if (accRec && accRec.blockedUntil > Date.now()) {
        return {
          blocked: true,
          retryAfter: Math.ceil((accRec.blockedUntil - Date.now()) / 1000),
        };
      }
    }
    return { blocked: false, retryAfter: 0 };
  }

  recordFailure(ip: string, account?: string) {
    const now = Date.now();
    this.bump(this.ipStore, ip, now);
    if (account) this.bump(this.accountStore, account, now);
  }

  recordSuccess(ip: string, account?: string) {
    this.ipStore.delete(ip);
    if (account) this.accountStore.delete(account);
  }

  private bump(store: Map<string, AttemptRecord>, key: string, now: number) {
    let rec = store.get(key);

    if (!rec || now - rec.firstAt > this.windowMs) {
      rec = {
        count: 0,
        firstAt: now,
        // mantiene la progresión si aún está bloqueado
        blockCount: rec && rec.blockedUntil > now ? rec.blockCount : 0,
        blockedUntil: 0,
      };
    }

    rec.count += 1;

    if (rec.count >= this.maxAttempts) {
      rec.blockCount += 1;
      const duration = Math.min(
        this.blockMs * Math.pow(2, rec.blockCount - 1),
        this.maxBlockMs,
      );
      rec.blockedUntil = now + duration;
      this.logger.warn(
        `Brute-force lockout -> key="${key}" attempts=${rec.count} blockMs=${duration}`,
      );
    }

    store.set(key, rec);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.ipStore) {
      if (v.blockedUntil < now && now - v.firstAt > this.windowMs)
        this.ipStore.delete(k);
    }
    for (const [k, v] of this.accountStore) {
      if (v.blockedUntil < now && now - v.firstAt > this.windowMs)
        this.accountStore.delete(k);
    }
  }
}
