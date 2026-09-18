import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatusFilter } from './dto/find-orders-query.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private async getDollarRate(): Promise<number> {
    const exchangeRate = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
      select: { parallel_rate: true },
    });

    return exchangeRate ? (Number(exchangeRate.parallel_rate) || Number(exchangeRate.parallel_rate) || 0) : 0;
  }

  private toSoles(
    value: unknown,
    currencyTypeId: unknown,
    dollarRate: number,
  ): number {
    const amount = Number(value) || 0;
    return String(currencyTypeId) === '1' ? amount : amount * dollarRate;
  }

  async create(
    createOrderDto: CreateOrderDto,
    userId?: number | string,
    isAdmin = false,
  ) {
    if (!createOrderDto.document_type_id) {
      throw new UnauthorizedException('Debes indicar si es boleta o factura');
    }

    const clientId =
      isAdmin && createOrderDto.client_id
        ? createOrderDto.client_id
        : Number(userId);

    if (!clientId || Number.isNaN(clientId)) {
      throw new UnauthorizedException('No se pudo determinar el cliente');
    }

    const totales = await this.calculateTotales(createOrderDto);

    // Validar disponibilidad antes de crear la orden: habilitado_web, status, venta, saldo
    // Agrupar cantidades por article_id por si el dto trae duplicados
    const qtyByArticle = new Map<string, number>();
    for (const it of createOrderDto.items as any[]) {
      const key = String(it.article_id);
      const qty = Number(it.quantity) || 0;
      if (qty <= 0) throw new BadRequestException(`Cantidad inválida para artículo ${key}`);
      qtyByArticle.set(key, (qtyByArticle.get(key) || 0) + qty);
    }
    for (const [articleIdStr, totalQty] of qtyByArticle.entries()) {
      const articleId = BigInt(articleIdStr);
      const article = await this.prisma.articles.findUnique({
        where: { id: articleId },
        select: { id: true, status: true, venta: true, habilitado_web: true, description: true },
      });
      if (!article) throw new BadRequestException(`Artículo ${articleIdStr} no existe`);
      if (Number(article.status) !== 1) throw new BadRequestException(`Artículo "${article.description ?? articleIdStr}" no disponible (status inactivo)`);
      if ((article as any).venta !== true) throw new BadRequestException(`Artículo "${article.description ?? articleIdStr}" no disponible para venta`);
      if ((article as any).habilitado_web !== true) throw new BadRequestException(`Artículo "${article.description ?? articleIdStr}" no habilitado para web`);
      const stockRows: any[] = await this.prisma.$queryRaw`SELECT saldo FROM v_article_stock_global WHERE article_id = ${articleId}`;
      const saldo = stockRows[0] ? Number(stockRows[0].saldo) : 0;
      if (saldo <= 0) throw new BadRequestException(`Artículo "${article.description ?? articleIdStr}" sin stock`);
      if (totalQty > saldo) throw new BadRequestException(`Stock insuficiente para "${article.description ?? articleIdStr}". Solicitado: ${totalQty}, disponible: ${saldo}`);
    }

    return this.prisma
      .$transaction(async (tx) => {
        const orders = await tx.orders.create({
          data: {
            client_id: clientId,
            document_type_id: createOrderDto.document_type_id,
            document_number: null, // se actualiza después de validar
            document_type: null,   // se actualiza después de validar
            status: 'NUEVO',
            total: totales,
            terms: createOrderDto.terms,
          },
          include: {
            clients: true,
            document_types: true,
          },
        });

        if (orders?.clients?.document_number == '') {
          throw new UnauthorizedException('Debes tener registro de dni');
        }

        // cod_sunat 1 = factura (requiere RUC de 11 dígitos)
        // cod_sunat 3 = boleta (requiere DNI de 8 dígitos)
        if (
          Number(orders.document_type_id) === 1 &&
          orders?.clients?.document_number?.length !== 11
        ) {
          throw new UnauthorizedException(
            'Para facturar necesitas registrar tu RUC (11 dígitos)',
          );
        }

        if (
          Number(orders.document_type_id) === 3 &&
          orders?.clients?.document_number?.length !== 8
        ) {
          throw new UnauthorizedException(
            'Para boleta necesitas registrar tu DNI (8 dígitos)',
          );
        }

        // Guardar el documento del cliente en la orden para que no se pierda si el cliente cambia su documento
        await tx.orders.update({
          where: { id: orders.id },
          data: {
            document_number: orders.clients?.document_number ?? null,
            document_type: orders.clients?.document_type ?? null,
          },
        });

        const item_irderns = await Promise.all(
          createOrderDto.items.map(async (item: any) => {
            const article = await tx.articles.findUnique({
              where: {
                id: item.article_id,
              },
            });
            // Doble chequeo dentro de transacción por carrera: status/venta/habilitado_web
            if (!article || Number((article as any).status) !== 1 || (article as any).venta !== true || (article as any).habilitado_web !== true) {
              throw new BadRequestException(`Artículo ${item.article_id} no disponible para venta web`);
            }
            const unit_price = article?.public_price;
            const subtotal = (Number(unit_price) || 0) * Number(item.quantity);

            return tx.order_items.create({
              data: {
                quantity: item.quantity,
                unit_price: unit_price || 0,
                subtotal: subtotal,

                orders: {
                  connect: { id: orders.id },
                },
                articles: {
                  connect: { id: item.article_id },
                },
              },
            });
          }),
        );

        await this.notificationsService.createNew(orders.id, undefined, tx);

        const dollarRate = await this.getDollarRate();

        const itemsEnSoles = await Promise.all(
          item_irderns.map(async (item: any) => {
            const article = await tx.articles.findUnique({
              where: { id: item.article_id },
              select: { currency_type_id: true },
            });
            const isSoles = String(article?.currency_type_id) === '1';
            return {
              ...item,
              unit_price: isSoles
                ? Number(item.unit_price)
                : Number(item.unit_price) * dollarRate,
              subtotal: isSoles
                ? Number(item.subtotal)
                : Number(item.subtotal) * dollarRate,
            };
          }),
        );

        const totalSoles = itemsEnSoles.reduce(
          (sum, item) => sum + item.subtotal,
          0,
        );

        return {
          orders: { ...orders, total: totalSoles, item_irderns: itemsEnSoles },
        };
      })
      .then(async (result) => {
        const notification = await this.prisma.notifications.findFirst({
          where: { order_id: result.orders.id, type: 'nuevo' },
          orderBy: { id: 'desc' },
          select: { id: true },
        });

        if (notification) {
          await this.notificationsService.publishNew(
            result.orders.id,
            notification.id,
          );
        }

        return result;
      });
  }
  private async calculateTotales(
    createOrderDto: CreateOrderDto,
  ): Promise<number> {
    const dollarRate = await this.getDollarRate();
    let totales = 0;

    for (const item of createOrderDto.items) {
      const consulta = await this.prisma.articles.findUnique({
        where: {
          id: item.article_id,
        },
        select: {
          public_price: true,
          currency_type_id: true,
        },
      });
      const unit_price = this.toSoles(
        consulta?.public_price,
        consulta?.currency_type_id,
        dollarRate,
      );
      const subtotal = unit_price * Number(item.quantity);

      totales += subtotal;
    }

    return totales;
  }

  async findAll(
    id?: string,
    userId?: number | string,
    isAdmin = false,
    pagination?: { page?: string; limit?: string },
    statusFilter: OrderStatusFilter = 'activo',
  ) {
    const conditions: Prisma.Sql[] = [];

    if (id) {
      if (!/^\d+$/.test(String(id).trim())) {
        throw new BadRequestException('El parámetro id debe ser numérico');
      }
      if (!isAdmin && userId !== undefined && String(id) !== String(userId)) {
        throw new ForbiddenException(
          'No tienes permiso para acceder a estas órdenes',
        );
      }
      conditions.push(Prisma.sql`c.id = ${BigInt(id)}`);
    } else if (!isAdmin && userId !== undefined) {
      conditions.push(Prisma.sql`c.id = ${BigInt(String(userId))}`);
    }

    if (statusFilter === 'activo') {
      conditions.push(Prisma.sql`o.status != 'anulado'`);
    } else if (statusFilter === 'anulado') {
      conditions.push(Prisma.sql`o.status = 'anulado'`);
    }

    const whereSql = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;

    const page = Math.max(1, Math.trunc(Number(pagination?.page)) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Math.trunc(Number(pagination?.limit)) || 10),
    );
    const offset = (page - 1) * limit;

    const [order, countResult] = await Promise.all([
      this.prisma.$queryRaw<any[]>`
      SELECT
        o.id,
        o.client_id,
        o.total,
        o.status,
        c.id AS client_id,
        c.names AS client_name,
        o.created_at,

        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', oi.id,
            'article_id', oi.article_id,
            'quantity', oi.quantity,
            'unit_price', oi.unit_price,
            'subtotal', oi.subtotal,
            'currency_type_id', a.currency_type_id,
            'article_description', a.description
          )
        ) AS items

      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN articles a ON a.id = oi.article_id
      LEFT JOIN clients c ON c.id = o.client_id

      ${whereSql}

      GROUP BY o.id
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
      this.prisma.$queryRaw<any[]>`
      SELECT COUNT(DISTINCT o.id) AS total
      FROM orders o
      LEFT JOIN clients c ON c.id = o.client_id
      ${whereSql}
    `,
    ]);

    const dollarRate = await this.getDollarRate();

    const data = order.map((currentOrder) => {
      const items =
        typeof currentOrder.items === 'string'
          ? JSON.parse(currentOrder.items)
          : currentOrder.items;
      const normalizedItems = Array.isArray(items)
        ? items.map((item) => ({
            ...item,
            unit_price: Number(
              this.toSoles(
                item.unit_price,
                item.currency_type_id,
                dollarRate,
              ).toFixed(2),
            ),
            subtotal: Number(
              this.toSoles(
                item.subtotal,
                item.currency_type_id,
                dollarRate,
              ).toFixed(2),
            ),
          }))
        : items;

      const totalSoles = Array.isArray(normalizedItems)
        ? normalizedItems.reduce(
            (total, item) => total + Number(item.subtotal || 0),
            0,
          )
        : this.toSoles(currentOrder.total, '1', dollarRate);

      return {
        ...currentOrder,
        items: normalizedItems,
        total: Number(totalSoles.toFixed(2)),
      };
    });

    const total = Number(countResult[0]?.total ?? 0);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  private assertOrderAccess(
    order: any,
    userId?: number | string,
    isAdmin = false,
  ) {
    if (isAdmin) return;
    if (userId === undefined) {
      throw new ForbiddenException('No autorizado');
    }
    if (String(order.client_id) !== String(userId)) {
      throw new ForbiddenException(
        'No tienes permiso para acceder a esta orden',
      );
    }
  }

  async findOne(id: number, userId?: number | string, isAdmin = false) {
    const respuesta = await this.prisma.$queryRaw<any[]>`
 SELECT
   o.id,
   o.client_id,
   c.names AS client_names,
   c.lastnames AS client_lastnames,
   o.total,
   o.status,
   o.created_at

 FROM orders o
 LEFT JOIN clients c ON c.id = o.client_id
 LEFT JOIN order_items oi ON oi.order_id = o.id
 LEFT JOIN articles a ON a.id = oi.article_id
 WHERE o.id = ${id}
 GROUP BY o.id;
   `;
    if (!respuesta || respuesta.length === 0) {
      throw new BadRequestException('Orden no encontrada');
    }
    this.assertOrderAccess(respuesta[0], userId, isAdmin);
    return respuesta[0];
  }

  async detalleOrdenes(id: number, userId?: number | string, isAdmin = false) {
    const order = await this.prisma.$queryRaw<any[]>`
    SELECT
      o.id,
      o.client_id,
      o.total,
      o.status,
      c.id AS client_id,
      c.names AS client_name,
      o.created_at,

      JSON_ARRAYAGG(
        JSON_OBJECT(
          'id', oi.id,
          'article_id', oi.article_id,
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'subtotal', oi.subtotal,
          'currency_type_id', a.currency_type_id,
          'article_description', a.description
        )
      ) AS items

    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN articles a ON a.id = oi.article_id
    LEFT JOIN clients c ON c.id = o.client_id

    WHERE o.id = ${id}

    GROUP BY o.id
  `;

    if (!order || order.length === 0) {
      throw new BadRequestException('Orden no encontrada');
    }
    this.assertOrderAccess(order[0], userId, isAdmin);

    const dollarRate = await this.getDollarRate();

    const items =
      typeof order[0].items === 'string'
        ? JSON.parse(order[0].items)
        : order[0].items;
    const normalizedItems = Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          unit_price: Number(
            this.toSoles(
              item.unit_price,
              item.currency_type_id,
              dollarRate,
            ).toFixed(2),
          ),
          subtotal: Number(
            this.toSoles(
              item.subtotal,
              item.currency_type_id,
              dollarRate,
            ).toFixed(2),
          ),
        }))
      : items;

    const totalSoles = Array.isArray(normalizedItems)
      ? normalizedItems.reduce(
          (total, item) => total + Number(item.subtotal || 0),
          0,
        )
      : this.toSoles(order[0].total, '1', dollarRate);

    return {
      ...order[0],
      items: normalizedItems,
      total: Number(totalSoles.toFixed(2)),
    };
  }

  async generatePdf(
    id: number,
    res: Response,
    userId?: number | string,
    isAdmin = false,
  ): Promise<void> {
    // Verificar acceso ANTES de enviar cualquier byte de la respuesta
    const orders: any[] = await this.prisma.$queryRaw`
    SELECT
      o.id,
      o.client_id,
      c.names AS client_names,
      c.lastnames AS client_lastnames,
      o.total,
      o.status,
      o.created_at,

      JSON_ARRAYAGG(
        JSON_OBJECT(
          'quantity', oi.quantity,
          'unit_price', oi.unit_price,
          'subtotal', oi.subtotal,
          'currency_type_id', a.currency_type_id,
          'article_description', a.description
        )
      ) AS items

    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN articles a ON a.id = oi.article_id
    WHERE o.id = ${id}
    GROUP BY o.id;
  `;

    if (!orders || orders.length === 0) {
      res.status(404).send('Orden no encontrada');
      return;
    }

    this.assertOrderAccess(orders[0], userId, isAdmin);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="orden-${id}.pdf"`,
    );

    doc.on('error', (err) => {
      console.error('PDF error:', err);
      res.status(500).end();
    });

    res.on('error', (err) => {
      console.error('Response error:', err);
    });

    doc.pipe(res);

    const order = orders[0];
    const items =
      typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    const exchangeRate = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
      select: { parallel_rate: true },
    });
    const dollarRate = exchangeRate ? (Number(exchangeRate.parallel_rate) || Number(exchangeRate.parallel_rate) || 0) : 0;
    const toSoles = (value: unknown, currencyTypeId: unknown) => {
      const amount = Number(value) || 0;
      return String(currencyTypeId) === '2' && dollarRate > 0
        ? amount * dollarRate
        : amount;
    };
    const totalSoles = Array.isArray(items)
      ? items.reduce(
          (total, item) =>
            total + toSoles(item.subtotal, item.currency_type_id),
          0,
        )
      : toSoles(order.total, '1');

    // --- ENCABEZADO ---
    // Colores y fuentes
    const colorPrimario = '#D32F2F'; // Rojo Cyberhouse
    const colorTexto = '#333333';
    const colorGris = '#777777';

    // Logo / Nombre de Empresa
    const logoPath = path.join(process.cwd(), 'storage', 'logociberhouse.jpeg');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 50, 30, { width: 180 });
    } else {
      doc
        .font('Helvetica-Bold')
        .fontSize(24)
        .fillColor(colorPrimario)
        .text('CYBERHOUSE', 50, 50, { continued: true })
        .fillColor('#000000')
        .text('TEC');
    }

    // Datos de la empresa
    doc.fontSize(10).fillColor(colorGris);
    let yCompany = 85;
    doc.text('RUC: 20614604825', 50, yCompany);
    yCompany += 15;
    doc.text(
      'Dirección: AV. INCA GARCILASO DE LA VEGA NRO. 1348',
      50,
      yCompany,
    );
    yCompany += 12;
    doc.text('(INT 1049-1053 PISO 1 REF. TDA 1A 164-141) LIMA', 50, yCompany);
    yCompany += 15;
    doc.text('Teléfono: 981206097', 50, yCompany);
    yCompany += 20;

    doc.font('Helvetica-Bold').text('Cuentas Bancarias:', 50, yCompany);
    doc.font('Helvetica');
    yCompany += 12;
    doc.text('BCO. CREDITO SOLES: 191-7319236-0-75', 50, yCompany);
    yCompany += 12;
    doc.text('BCO. CREDITO DOLARES: 191-7320109-1-03', 50, yCompany);
    yCompany += 12;
    doc.text('BCO. CONTINENTAL SOLES: 0011-0175-0100099775', 50, yCompany);
    yCompany += 12;
    doc.text('BCO. CONTINENTAL DOLARES: 0011-0175-0100099783', 50, yCompany);

    // Datos del Comprobante (Alineado a la derecha)
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(colorTexto)
      .text('COMPROBANTE DE ORDEN', 250, 50, { align: 'right' });

    doc
      .fontSize(12)
      .fillColor(colorPrimario)
      .text(`N° Orden: #${String(order.id).padStart(6, '0')}`, 250, 75, {
        align: 'right',
      });

    let fechaTexto = 'PROCESADO';
    if (order.created_at) {
      fechaTexto = new Date(order.created_at).toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    doc
      .fontSize(10)
      .fillColor(colorGris)
      .text(`Fecha: ${fechaTexto}`, 250, 95, { align: 'right' });

    // Línea separadora
    const separatorY = yCompany + 20;
    doc
      .moveTo(50, separatorY)
      .lineTo(545, separatorY)
      .lineWidth(1)
      .strokeColor('#E0E0E0')
      .stroke();

    // --- DATOS DEL CLIENTE ---
    const clientName =
      `${order.client_names || ''} ${order.client_lastnames || ''}`.trim() ||
      'Cliente Desconocido';

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(colorTexto)
      .text('Facturado a:', 50, separatorY + 15);
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(colorGris)
      .text(`Cliente: ${clientName}`, 50, separatorY + 35);
    doc.text(`Estado de Orden: PROCESADO`, 50, separatorY + 50);

    // --- TABLA DE PRODUCTOS ---
    const tableTop = separatorY + 80;

    // Fondo del encabezado de la tabla
    doc.rect(50, tableTop, 495, 25).fillColor(colorPrimario).fill();

    // Texto del encabezado de la tabla
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF');
    doc.text('DESCRIPCIÓN', 60, tableTop + 8);
    doc.text('CANT.', 320, tableTop + 8, { width: 50, align: 'center' });
    doc.text('PRECIO UNIT.', 380, tableTop + 8, { width: 70, align: 'right' });
    doc.text('SUBTOTAL', 460, tableTop + 8, { width: 75, align: 'right' });

    let y = tableTop + 35;
    doc.font('Helvetica').fontSize(10).fillColor(colorTexto);

    if (items && Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.article_description) continue;

        // Fila sombreada alterna
        if (i % 2 === 1) {
          doc
            .rect(50, y - 5, 495, 20)
            .fillColor('#F9F9F9')
            .fill();
          doc.fillColor(colorTexto);
        }

        doc.text(item.article_description.substring(0, 50), 60, y);
        doc.text(item.quantity.toString(), 320, y, {
          width: 50,
          align: 'center',
        });
        doc.text(
          `S/ ${toSoles(item.unit_price, item.currency_type_id).toFixed(2)}`,
          380,
          y,
          { width: 70, align: 'right' },
        );
        doc.text(
          `S/ ${toSoles(item.subtotal, item.currency_type_id).toFixed(2)}`,
          460,
          y,
          { width: 75, align: 'right' },
        );

        y += 20;
      }
    }

    // Línea separadora final de tabla
    doc
      .moveTo(50, y + 5)
      .lineTo(545, y + 5)
      .lineWidth(1)
      .strokeColor('#E0E0E0')
      .stroke();

    // --- TOTALES ---
    const totalTop = y + 15;

    // Recuadro para el total
    doc.rect(350, totalTop, 195, 30).fillColor('#F0F0F0').fill();

    doc.font('Helvetica-Bold').fontSize(12).fillColor(colorTexto);
    doc.text('TOTAL:', 360, totalTop + 9);
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(colorPrimario)
      .text(`S/ ${totalSoles.toFixed(2)}`, 400, totalTop + 8, {
        width: 135,
        align: 'right',
      });

    // Mensaje de agradecimiento
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(colorGris);
    doc.text('¡Gracias por su preferencia!', 50, totalTop + 10);
    doc.text(
      'Si tiene alguna duda sobre esta orden, por favor contáctenos.',
      50,
      totalTop + 25,
    );
    doc.text('Teléfono: 981206097', 50, totalTop + 50);

    // Pie de página
    const bottomY = doc.page.height - 50;
    doc
      .moveTo(50, bottomY - 10)
      .lineTo(545, bottomY - 10)
      .lineWidth(0.5)
      .strokeColor('#E0E0E0')
      .stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#999999');
    doc.text(
      'Este documento es un comprobante de orden generado electrónicamente.',
      50,
      bottomY,
      { align: 'center', width: 495 },
    );

    doc.end();
  }

  async masVendidos() {
    const respuesta = await this.prisma.$queryRaw<any[]>`
SELECT 
  a.description,  
  SUM(oi.quantity) AS total_vendido
FROM order_items oi
JOIN articles a ON a.id = oi.article_id
GROUP BY a.id
ORDER BY total_vendido DESC;
  `;
    return respuesta;
  }
}
