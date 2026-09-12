import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';

export interface WatermarkOptions {
  /** Fracción del ancho de la imagen base que ocupará el logo (0-1). Default 0.55 */
  scale?: number;
  /** Opacidad del logo 0-1. Default 0.35 */
  opacity?: number;
  /** Umbral para volver transparente el fondo claro del logo (0-255). Default 200 */
  backgroundThreshold?: number;
}

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

@Injectable()
export class WatermarkService {
  private readonly logger = new Logger(WatermarkService.name);
  private readonly logoPath: string;

  constructor() {
    const candidates = [
      join(process.cwd(), 'docs', 'logo_empresa.jpeg'),
      join(process.cwd(), 'storage', 'logociberhouse.jpeg'),
      join(process.cwd(), 'assets', 'logo_empresa.jpeg'),
    ];
    this.logoPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
  }

  /**
   * Aplica la marca de agua al archivo indicado (lo sobrescribe).
   * - Logo en blanco y negro (grayscale), semitransparente, centrado y grande.
   * - Best-effort: si algo falla (gif, logo ausente, etc.) registra un warn y no lanza.
   */
  async applyToFile(imagePath: string, options: WatermarkOptions = {}): Promise<void> {
    const { scale = 0.55, opacity = 0.35, backgroundThreshold = 200 } = options;

    try {
      if (!existsSync(imagePath)) {
        this.logger.warn(`Watermark: no existe el archivo ${imagePath}`);
        return;
      }
      const ext = imagePath.slice(imagePath.lastIndexOf('.')).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) return; // skip gif/avif para no romper animaciones u otros formatos

      if (!existsSync(this.logoPath)) {
        this.logger.warn(`Watermark: no se encontró el logo en ${this.logoPath}`);
        return;
      }

      const base = sharp(imagePath);
      const meta = await base.metadata();
      if (!meta.width || !meta.height) return;

      // No marcar imágenes muy pequeñas (thumbnails / iconos)
      if (meta.width < 300) return;

      const watermarkWidth = Math.max(
        120,
        Math.round(meta.width * Math.min(Math.max(scale, 0.1), 0.9)),
      );

      // 1. Logo -> B/N + redimensionado + RGB crudo (normalizamos a RGBA a mano)
      const { data, info } = await sharp(this.logoPath)
        .grayscale()
        .resize({ width: watermarkWidth })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels;
      const pixels = info.width * info.height;
      const rgba = Buffer.alloc(pixels * 4);
      for (let p = 0; p < pixels; p++) {
        rgba[p * 4] = data[p * channels];
        rgba[p * 4 + 1] = data[p * channels + 1];
        rgba[p * 4 + 2] = data[p * channels + 2];
        rgba[p * 4 + 3] = channels === 4 ? data[p * channels + 3] : 255;
      }

      // 2. Fondo claro -> transparente, resto -> semitransparente
      const alphaValue = Math.round(255 * Math.min(Math.max(opacity, 0), 1));
      for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        if (r >= backgroundThreshold && g >= backgroundThreshold && b >= backgroundThreshold) {
          rgba[i + 3] = 0; // fondo del logo -> totalmente transparente
        } else {
          // conserva la forma del logo pero con la opacidad pedida
          rgba[i + 3] = Math.round((rgba[i + 3] / 255) * alphaValue);
        }
      }

      const overlay = await sharp(rgba, {
        raw: { width: info.width, height: info.height, channels: 4 },
      })
        .png()
        .toBuffer();

      // 3. Componer centrado sobre la imagen original (sobrescribe el archivo)
      const out = await sharp(imagePath)
        .composite([{ input: overlay, gravity: 'centre' }])
        .toBuffer();

      const { writeFile } = await import('fs/promises');
      await writeFile(imagePath, out);
    } catch (error) {
      this.logger.warn(`Watermark: no se pudo aplicar a ${imagePath}: ${error}`);
    }
  }
}
