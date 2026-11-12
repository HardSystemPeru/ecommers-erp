// src/complaints/services/storage.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

const ALLOWED_MIME = {
  evidence: ['image/jpeg', 'image/png'],
  signature: ['image/jpeg', 'image/png', 'image/webp'],
};

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class StorageService {
  private readonly uploadDir = path.join(
    process.cwd(),
    'storage',
    'complaints',
  );

  async saveFile(
    file: Express.Multer.File,
    kind: 'evidence' | 'signature',
  ): Promise<string> {
    if (file.size > MAX_SIZE) {
      throw new BadRequestException(`${kind} exceeds 5MB limit`);
    }

    // Validación real del contenido (magic bytes), no solo la extensión
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIME[kind].includes(detected.mime)) {
      throw new BadRequestException(`Invalid file type for ${kind}`);
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const filename = `${kind}-${randomUUID()}.${detected.ext}`;
    const fullPath = path.join(this.uploadDir, filename);

    await fs.writeFile(fullPath, file.buffer);

    // Devuelve la ruta relativa/URL que se guarda en la BD
    return `/storage/complaints/${filename}`;
  }
}
