import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { WatermarkService } from 'src/common/watermark/watermark.service';

const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIDE = 1000;
const THUMB_SIDE = 300;
const MAX_BYTES = 300 * 1024;

export interface ProcessedImageResult {
  url: string;
  thumbnail_url: string;
  filename: string;
  thumbFilename: string;
}

function randomName(): string {
  return randomBytes(16).toString('hex');
}

function articleImage422(messages: string[]): never {
  throw new UnprocessableEntityException({
    message: 'La imagen no es válida.',
    errors: { image_url: messages },
  });
}

export async function validateArticleImageBuffer(
  buffer: Buffer,
  maxBytes = 5 * 1024 * 1024,
): Promise<import('sharp').Metadata> {
  if (!buffer || buffer.length === 0) {
    articleImage422(['La imagen es obligatoria.']);
  }
  if (buffer.length > maxBytes) {
    articleImage422(['La imagen no debe pesar más de 5 MB.']);
  }

  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(buffer, { failOn: 'none' }).metadata();
  } catch {
    articleImage422(['La imagen no es válida o está corrupta.']);
  }

  const format = meta.format ? String(meta.format) : '';
  const normFormat = format === 'jpg' ? 'jpeg' : format;
  const mime = normFormat ? `image/${normFormat}` : '';
  if (!normFormat || !ALLOWED_MIMES.has(mime)) {
    articleImage422([
      'La imagen debe ser de tipo: jpeg, png, jpg o webp.',
    ]);
  }
  if (!meta.width || !meta.height) {
    articleImage422(['La imagen no es válida o está corrupta.']);
  }
  return meta;
}

/**
 * Procesamiento para image_url de Artículos (FASE 1):
 * - redimensiona solo si lado mayor > 1000 (sin recortar, sin ampliar)
 * - watermark DESPUÉS del redimensionado
 * - WebP ~80 apuntando a <300KB
 * - sin miniatura
 */
export async function processArticleMainImage(params: {
  buffer: Buffer;
  watermarkService: WatermarkService;
  outputDir?: string;
  baseName?: string;
  maxInputBytes?: number;
}): Promise<{ url: string; filename: string }> {
  const {
    buffer,
    watermarkService,
    outputDir = join(process.cwd(), 'storage', 'articles'),
    baseName,
    maxInputBytes = 5 * 1024 * 1024,
  } = params;

  await validateArticleImageBuffer(buffer, maxInputBytes);
  await mkdir(outputDir, { recursive: true });

  const name = baseName || randomName();
  const filename = `${name}.webp`;
  const filePath = join(outputDir, filename);

  const base = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });

  const watermarked = await watermarkService.applyToBuffer(base, {
    scale: 0.55,
    opacity: 0.35,
  });

  let quality = 80;
  let out = await watermarked.clone().webp({ quality, effort: 4 }).toBuffer();
  while (out.length > MAX_BYTES && quality > 35) {
    quality -= 5;
    out = await watermarked.clone().webp({ quality, effort: 4 }).toBuffer();
  }

  await writeFile(filePath, out);
  return { url: `/storage/articles/${filename}`, filename };
}

/** Flujo existente de article_images (imagen + thumbnail). */
export async function processArticleImage(params: {
  buffer: Buffer;
  watermarkService: WatermarkService;
  outputDir?: string;
  baseName?: string;
}): Promise<ProcessedImageResult> {
  const {
    buffer,
    watermarkService,
    outputDir = join(process.cwd(), 'storage', 'articles'),
    baseName,
  } = params;

  let meta: import('sharp').Metadata;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new BadRequestException('Archivo de imagen inválido o corrupto');
  }

  const format = meta.format ? String(meta.format) : '';
  const normFormat = format === 'jpg' ? 'jpeg' : format;
  const mime = normFormat ? `image/${normFormat}` : '';
  if (!normFormat || !ALLOWED_MIMES.has(mime)) {
    throw new BadRequestException(
      'Formato no permitido. Solo se aceptan imágenes JPEG, PNG o WebP',
    );
  }
  if (!meta.width || !meta.height) {
    throw new BadRequestException('No se pudo leer el tamaño de la imagen');
  }

  await mkdir(outputDir, { recursive: true });

  const name = baseName || randomName();
  const filename = `${name}.webp`;
  const thumbFilename = `${name}_thumb.webp`;
  const filePath = join(outputDir, filename);
  const thumbPath = join(outputDir, thumbFilename);

  const base = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: MAX_SIDE,
      height: MAX_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });

  const watermarked = await watermarkService.applyToBuffer(base, {
    scale: 0.55,
    opacity: 0.35,
  });

  let quality = 80;
  let out = await watermarked.clone().webp({ quality, effort: 4 }).toBuffer();
  while (out.length > MAX_BYTES && quality > 40) {
    quality -= 10;
    out = await watermarked.clone().webp({ quality, effort: 4 }).toBuffer();
  }

  let thumbBase = sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMB_SIDE,
      height: THUMB_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  thumbBase = await watermarkService.applyToBuffer(thumbBase, {
    scale: 0.55,
    opacity: 0.3,
  });
  let thumbQuality = 75;
  let thumbOut = await thumbBase
    .clone()
    .webp({ quality: thumbQuality, effort: 4 })
    .toBuffer();
  while (thumbOut.length > 80 * 1024 && thumbQuality > 35) {
    thumbQuality -= 10;
    thumbOut = await thumbBase
      .clone()
      .webp({ quality: thumbQuality, effort: 4 })
      .toBuffer();
  }

  await writeFile(filePath, out);
  await writeFile(thumbPath, thumbOut);

  return {
    url: `/storage/articles/${filename}`,
    thumbnail_url: `/storage/articles/${thumbFilename}`,
    filename,
    thumbFilename,
  };
}

export function isAllowedUploadMime(mime?: string): boolean {
  if (!mime) return false;
  const m = mime.toLowerCase();
  if (m === 'image/svg+xml' || m === 'image/gif' || m === 'image/tiff') {
    return false;
  }
  return ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(m);
}
