// src/libro-reclamos/services/complaint-counter.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class ComplaintCounterService {
  // Debe llamarse DENTRO de una transacción existente (tx), nunca suelto
  async getNextNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();

    // SELECT ... FOR UPDATE vía $queryRaw, ya que Prisma no expone FOR UPDATE nativamente
    const [counter] = await tx.$queryRaw<{ seq: number }[]>`
      SELECT seq FROM complaint_counters WHERE year = ${year} FOR UPDATE
    `;

    let nextSeq: number;

    if (!counter) {
      nextSeq = 1;
      await tx.$executeRaw`
        INSERT INTO complaint_counters (year, seq) VALUES (${year}, ${nextSeq})
      `;
    } else {
      nextSeq = counter.seq + 1;
      await tx.$executeRaw`
        UPDATE complaint_counters SET seq = ${nextSeq} WHERE year = ${year}
      `;
    }

    return `${String(nextSeq).padStart(4, '0')}-${year}`;
  }
}
