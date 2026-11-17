import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import sharp, { type Sharp } from 'sharp';

export interface WatermarkOptions {
  scale?: number;
  opacity?: number;
  backgroundThreshold?: number;
}

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

  private async buildOverlay(width: number, options: WatermarkOptions = {}) {
    const { scale = 0.55, opacity = 0.35, backgroundThreshold = 200 } = options;
    if (!existsSync(this.logoPath)) {
      this.logger.warn(`Watermark: no se encontró el logo en ${this.logoPath}`);
      return null;
    }

    const watermarkWidth = Math.max(
      120,
      Math.round(width * Math.min(Math.max(scale, 0.1), 0.9)),
    );

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

    const alphaValue = Math.round(255 * Math.min(Math.max(opacity, 0), 1));
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (
        r >= backgroundThreshold &&
        g >= backgroundThreshold &&
        b >= backgroundThreshold
      ) {
        rgba[i + 3] = 0;
      } else {
        rgba[i + 3] = Math.round((rgba[i + 3] / 255) * alphaValue);
      }
    }

    return sharp(rgba, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }

  async applyToBuffer(
    image: Sharp,
    options: WatermarkOptions = {},
  ): Promise<Sharp> {
    try {
      const meta = await image.metadata();
      if (!meta.width) return image;
      const overlay = await this.buildOverlay(meta.width, options);
      if (!overlay) return image;
      return image.composite([{ input: overlay, gravity: 'centre' }]);
    } catch (error) {
      this.logger.warn(`Watermark: no se pudo aplicar: ${error}`);
      return image;
    }
  }
}
