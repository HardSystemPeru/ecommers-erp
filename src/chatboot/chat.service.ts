import { Inject, Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from '@prisma/client';
import { RedisClientType } from "redis";
import { PrismaService } from "src/prisma/prisma.service";
import { randomUUID, createHash } from 'crypto';
import { normalizeToken as normalizeWithDict, getVariants } from './plural-variants';

// Intención de oferta: "oferta(s), descuento(s), promoción, promo, barato(s), remate, liquidación"
const OFERTA_RE = /\b(ofertas?|descuentos?|promociones?|promos?|baratos?|remates?|liquidaciones?)\b/i;
const OFERTA_RE_G = /\b(ofertas?|descuentos?|promociones?|promos?|baratos?|remates?|liquidaciones?)\b/gi;
// Tope de ofertas por página (el resto del chat usa 12)
const OFFER_LIMIT = 10;

@Injectable()
export class Chat implements OnModuleInit {
  
    

  constructor(
    @Inject('REDIS_CLIENT')
    private redisClient: RedisClientType,
    private prisma: PrismaService,
    private configService:ConfigService
  ) {}

  async onModuleInit() {
    await this.construirVocabulario();
  }

  private normalizarToken(token: string): string {
    // delega al diccionario plural-variants.ts (soporta singular/plural + sinónimos hw)
    return normalizeWithDict(token);
  }

  async construirVocabulario() {
    const filas: any[] = await this.prisma.$queryRaw`SELECT DISTINCT description FROM articles WHERE status=1 AND venta=1 AND habilitado_web=1 AND slug IS NOT NULL AND id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)`;

    const vocabulario = new Set<string>();

    for (const fila of filas) {
      if (!fila.description) continue;

      fila.description
        .toLowerCase()
        .split(/[\s|,\-\/\.]+/)
        .filter((p: string) => p.length > 2)
        .map((p: string) => this.normalizarToken(p))
        .forEach((p: string) => vocabulario.add(p));
    }

    await this.redisClient.del('vocabulario:articulos');

    const arr = Array.from(vocabulario);

    if (arr.length > 0) {
      await this.redisClient.sAdd('vocabulario:articulos', arr);
    }
  }

  async filtrarTokensValidos(tokens: string[]): Promise<string[]> {
    if (tokens.length === 0) return [];

    const tokensNormalizados = tokens.map(t => this.normalizarToken(t));

    const resultados = await this.redisClient.smIsMember( 'vocabulario:articulos',tokensNormalizados,);

    return tokensNormalizados.filter((_, i) => resultados[i])}

  async buscarArticulos(queryOriginal: string) {

    const limit = 12;

    // Antispam: la misma consulta repetida más de 10 veces se bloquea 10 minutos
    if (await this.verificarBloqueoRepeticion(queryOriginal)) {
      return {
        message: 'Has repetido muchas veces la misma consulta. Inténtalo de nuevo en unos minutos.',
        type: 'product_list',
        data: [],
        meta: {
          total: 0,
          hasMore: false,
          nextCursor: null,
          queryId: null,
        },
      };
    }
    const tipo_de_cambio: any = await this.prisma.exchange_rates.findFirst({ orderBy: { date: 'desc' } });
    const rate = Number(tipo_de_cambio?.parallel_rate) || 0;
    const appURL = this.configService.get<string>('APP_URL');

    // Atajo: si el mensaje es solo números, buscar por id/cod_fab (nunca están en el vocabulario)
    if (/^\d+$/.test(queryOriginal.trim())) {
      return this.buscarPorId(queryOriginal.trim());
    }

    const pideOferta = OFERTA_RE.test(queryOriginal);
    // Las palabras de oferta son intención, no términos de búsqueda
    const texto = queryOriginal.replace(OFERTA_RE_G, ' ');
    const tokens = texto.toLowerCase().split(/\s+/).filter(t => t.length > 2).map(t => this.normalizarToken(t));

    const tokensValidos = await this.filtrarTokensValidos(tokens);
    const tokensTexto = tokensValidos.join(' ');

    // Solo pidió ofertas, sin producto: listar las 10 primeras ofertas
    if (tokensValidos.length === 0 && pideOferta) {
      const cachePayload = { ofertaPura: true };
      const { rows, total } = await this.ejecutarBusqueda({
        booleanQuery: '', tokensTexto: '', queryOriginal: '',
        pideOferta: true, ofertaPura: true, comboLikes: [],
        limit: OFFER_LIMIT, offset: 0, rate,
      });
      const hasMore = total > rows.length;
      const queryId = hasMore ? randomUUID() : null;
      if (queryId) {
        await this.redisClient.set(`chat:query:${queryId}`, JSON.stringify(cachePayload), { EX: 60 * 10 });
      }
      return {
        message: rows.length === 0 ? 'Por ahora no tenemos ofertas disponibles' : 'Aqui tienes las ofertas ',
        type: 'product_list',
        data: this.mapPrecios(rows, rate, appURL),
        meta: { total, hasMore, nextCursor: null, queryId },
      };
    }

    if (tokensValidos.length === 0) {
         return {
         message: 'Lo siento, no puedo resolver esa duda',
         type: 'product_list',
         data: [],
         meta: {
               total: 0,
               hasMore: false,
               nextCursor: null,
               queryId: null,
     },
   };
 }

      // Grupos OR opcionales: cada concepto suma si coincide, pero ninguno excluye.
      // Así un título largo pegado devuelve los más parecidos (ordenados por relevancia)
      // en vez de vacío por exigir todos los términos a la vez.
      const booleanQuery = tokensValidos
        .map(valid => {
          const variants = Array.from(new Set(getVariants(valid).map(v => v.toLowerCase().trim()).filter(v => v.length > 2))).slice(0, 6);
          if (variants.length === 1) return `${variants[0]}*`;
          return `(${variants.map(v => `${v}*`).join(' ')})`;
        })
        .join(' ');
      const comboLikes = this.comboLikesDe(texto);

      const cachePayload = { booleanQuery, tokensTexto, queryOriginal, pideOferta, comboLikes };
      const { rows: data, total } = await this.ejecutarBusqueda({
        booleanQuery, tokensTexto, queryOriginal, pideOferta, ofertaPura: false, comboLikes,
        limit, offset: 0, rate,
      });

     const hasMore = total > data.length;

    const queryId = hasMore ? randomUUID() : null;

     if (queryId) {
        await this.redisClient.set(`chat:query:${queryId}`, JSON.stringify(cachePayload),
        {
           EX: 60 * 10,
        },
  );
}

     return {
             message: data?.length === 0
               ? (pideOferta ? 'No encontramos ofertas para esa búsqueda' : 'Lo siento no hay producto disponible')
               : 'Aqui tienes los resultados ',
             type: "product_list",
             data: this.mapPrecios(data, rate, appURL),
             meta:{
              total,
              hasMore,
              nextCursor: null,
               queryId
              }
            }
  }

  /**
   * Bloquea 10 minutos la consulta que se repite más de 10 veces.
   * Ventana deslizante de 10 min por hash del mensaje. Fail-open si Redis falla.
   */
  private async verificarBloqueoRepeticion(queryOriginal: string): Promise<boolean> {
    try {
      const texto = (queryOriginal || '').toLowerCase().trim();
      if (!texto) return false;
      const hash = createHash('sha1').update(texto).digest('hex');
      const blockKey = `chat:bloqueo:${hash}`;
      const countKey = `chat:repeticiones:${hash}`;
      if (await this.redisClient.exists(blockKey)) return true;
      const veces = await this.redisClient.incr(countKey);
      if (veces === 1) await this.redisClient.expire(countKey, 600);
      if (veces > 10) {
        await this.redisClient.set(blockKey, '1', { EX: 600 });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Palabras sanitizadas para el LIKE de combos (build_pc_tabla no tiene FULLTEXT). */
  private comboLikesDe(texto: string): string[] {    const out = new Set<string>();
    for (const w of texto.toLowerCase().split(/\s+/)) {
      const limpio = w.replace(/[^a-z0-9áéíóúñü]/gi, '');
      if (limpio.length >= 2 && out.size < 8) out.add(limpio);
    }
    return Array.from(out);
  }

  /** Mapeo final de precios: artículos se convierten con TC, combos ya vienen en soles. */
  private mapPrecios(rows: any[], rate: number, appURL: string | undefined) {
    return (rows || []).map((item: any) => {
      const esCombo = item?.tipo === 'combo';
      const base = Number(item?.precio) || 0;
      const out: any = {
        ...item,
        precio: esCombo ? Number(base.toFixed(2)) : Number((base * rate).toFixed(2)),
        imagen: item?.imagen
          ? (String(item.imagen).startsWith('http') ? item.imagen : (appURL || '') + item.imagen)
          : null,
      };
      const pct = Number(item?.oferta_pct) || 0;
      if (!esCombo && item?.oferta && pct > 0) {
        out.precio_oferta = Number((base * (1 - pct / 100) * rate).toFixed(2));
      }
      return out;
    });
  }

  /**
   * Búsqueda unificada artículos (FULLTEXT) + combos build_pc_tabla (LIKE).
   * Con pideOferta los artículos se filtran por has_offer=1 y los combos se omiten
   * (no tienen flag de oferta). Con ofertaPura solo se listan ofertas.
   */
  private async ejecutarBusqueda(o: {
    booleanQuery: string;
    tokensTexto: string;
    queryOriginal: string;
    pideOferta: boolean;
    ofertaPura: boolean;
    comboLikes: string[];
    limit: number;
    offset: number;
    rate: number;
  }): Promise<{ rows: any[]; total: number }> {
    const VIS = Prisma.sql`a.status=1 AND a.venta=1 AND a.habilitado_web=1 AND a.slug IS NOT NULL AND a.id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)`;
    const ofertaFrag = o.pideOferta ? Prisma.sql`AND a.has_offer = 1` : Prisma.empty;

    if (o.ofertaPura) {
      const [rows, tot] = await Promise.all([
        this.prisma.$queryRaw(Prisma.sql`
          SELECT a.id, a.description AS nombre, 0 AS relevanciaDesc, 0 AS relevanciaCategoria, 0 AS categoriaExacta,
            a.public_price AS precio, a.offer_price_percent AS oferta_pct, a.has_offer AS oferta,
            (SELECT i.url FROM article_images i WHERE i.article_id = a.id LIMIT 1) AS imagen,
            b.name AS marca, c.name AS categoria, a.slug AS ruta, 'article' AS tipo
          FROM articles a
          INNER JOIN brands b ON b.id = a.brand_id
          INNER JOIN categories c ON c.id = a.category_id
          WHERE ${VIS} AND a.has_offer = 1
          ORDER BY a.id DESC LIMIT ${o.limit} OFFSET ${o.offset}`) as any as any[],
        this.prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*) AS total FROM articles a WHERE ${VIS} AND a.has_offer = 1`) as any as any[],
      ]);
      return { rows, total: Number((tot as any[])[0]?.total ?? 0) };
    }

    const artSel = Prisma.sql`
      SELECT a.id, a.description AS nombre,
        MATCH(a.description) AGAINST (${o.queryOriginal} IN NATURAL LANGUAGE MODE) AS relevanciaDesc,
        MATCH(c.name) AGAINST (${o.queryOriginal} IN NATURAL LANGUAGE MODE) AS relevanciaCategoria,
        (c.name = UPPER(${o.tokensTexto})) AS categoriaExacta,
        a.public_price AS precio, a.offer_price_percent AS oferta_pct, a.has_offer AS oferta,
        (SELECT i.url FROM article_images i WHERE i.article_id = a.id LIMIT 1) AS imagen,
        b.name AS marca, c.name AS categoria, a.slug AS ruta, 'article' AS tipo
      FROM articles a
      INNER JOIN brands b ON b.id = a.brand_id
      INNER JOIN categories c ON c.id = a.category_id
      WHERE ${VIS}
        AND (MATCH(c.name) AGAINST (${o.booleanQuery} IN BOOLEAN MODE)
          OR MATCH(a.description) AGAINST (${o.booleanQuery} IN BOOLEAN MODE))
        ${ofertaFrag}`;

    // build_pc_tabla no tiene FULLTEXT: se busca con LIKE y el precio se suma de sus componentes en soles
    const conCombos = o.comboLikes.length > 0 && !o.pideOferta;
    const likeConds = o.comboLikes.map(l =>
      Prisma.sql`(b.name LIKE ${'%' + l + '%'} OR b.description LIKE ${'%' + l + '%'})`);
    const comboSel = conCombos ? Prisma.sql`
      UNION ALL
      (SELECT b.id, b.name AS nombre, 0 AS relevanciaDesc, 0 AS relevanciaCategoria, 0 AS categoriaExacta,
        COALESCE((
          SELECT SUM(d.quantity * CASE WHEN art.currency_type_id = 1 THEN art.public_price ELSE art.public_price * ${o.rate} END)
          FROM build_detail_pc_tabla d INNER JOIN articles art ON art.id = d.article_id
          WHERE d.build_pc_id = b.id
        ), b.total_price) AS precio,
        NULL AS oferta_pct, 0 AS oferta, b.image_build AS imagen,
        NULL AS marca, 'Combos' AS categoria, b.slug AS ruta, 'combo' AS tipo
      FROM build_pc_tabla b
      WHERE b.status = 1 AND b.slug IS NOT NULL AND (${Prisma.join(likeConds, ' OR ')}))` : Prisma.empty;

    const [rows, artTot, comboTot] = await Promise.all([
      this.prisma.$queryRaw(Prisma.sql`
        ${artSel} ${comboSel}
        ORDER BY tipo DESC, categoriaExacta DESC, relevanciaCategoria DESC, relevanciaDesc DESC, id ASC
        LIMIT ${o.limit} OFFSET ${o.offset}`) as any as any[],
      this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS total FROM articles a
        INNER JOIN categories c ON c.id = a.category_id
        WHERE ${VIS}
          AND (MATCH(c.name) AGAINST (${o.booleanQuery} IN BOOLEAN MODE)
            OR MATCH(a.description) AGAINST (${o.booleanQuery} IN BOOLEAN MODE))
          ${ofertaFrag}`) as any as any[],
      conCombos
        ? this.prisma.$queryRaw(Prisma.sql`
          SELECT COUNT(*) AS total FROM build_pc_tabla b
          WHERE b.status = 1 AND b.slug IS NOT NULL AND (${Prisma.join(likeConds, ' OR ')})`) as any as any[]
        : Promise.resolve([{ total: 0 }]),
    ]);
    return {
      rows,
      total: Number((artTot as any[])[0]?.total ?? 0) + Number((comboTot as any[])[0]?.total ?? 0),
    };
  }

  /**
   * Búsqueda directa por id exacto y luego por cod_fab.
   * No usa FULLTEXT ni vocabulario: los códigos nunca están ahí.
   */
  async buscarPorId(idStr: string) {
    const limit = 12;
    const idNum = Number(idStr);
    const like = `%${idStr}%`;
    const appURL = this.configService.get<string>('APP_URL');
    const tipo_de_cambio: any = await this.prisma.exchange_rates.findFirst({ orderBy: { date: 'desc' } });
    const rate = Number(tipo_de_cambio?.parallel_rate) || 0;

    const mapRows = (rows: any[]) => rows.map((item: any) => ({
      ...item,
      precio: Number((Number(item?.precio) * rate).toFixed(2)),
      imagen: item?.imagen ? appURL + item.imagen : null,
    }));

    // 1) id exacto
    let data = await this.prisma.$queryRaw`
      SELECT
        a.id,
        a.description AS nombre,
        a.public_price AS precio,
        (
          SELECT i.url
          FROM article_images i
          WHERE i.article_id = a.id
          LIMIT 1
        ) AS imagen,
        b.name AS marca,
        c.name AS categoria,
        a.slug AS ruta
      FROM articles a
      INNER JOIN brands b ON b.id = a.brand_id
      INNER JOIN categories c ON c.id = a.category_id
      WHERE a.status=1 AND a.venta=1 AND a.habilitado_web=1 AND a.slug IS NOT NULL AND a.id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)
        AND a.id = ${idNum}
      LIMIT ${limit}
    ` as any[];

    // 2) si no hubo id exacto, probar cod_fab
    if (!data || data.length === 0) {
      data = await this.prisma.$queryRaw`
        SELECT
          a.id,
          a.description AS nombre,
          a.public_price AS precio,
          (
            SELECT i.url
            FROM article_images i
            WHERE i.article_id = a.id
            LIMIT 1
          ) AS imagen,
          b.name AS marca,
          c.name AS categoria,
          a.slug AS ruta
        FROM articles a
        INNER JOIN brands b ON b.id = a.brand_id
        INNER JOIN categories c ON c.id = a.category_id
        WHERE a.status=1 AND a.venta=1 AND a.habilitado_web=1 AND a.slug IS NOT NULL AND a.id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)
          AND a.cod_fab LIKE ${like}
        ORDER BY (a.cod_fab = ${idStr}) DESC, a.id ASC
        LIMIT ${limit}
      ` as any[];
    }

    return {
      message: data.length === 0 ? 'Lo siento no hay producto con ese código' : 'Aqui tienes los resultados ',
      type: 'product_list',
      data: mapRows(data || []),
      meta: {
        total: (data || []).length,
        hasMore: false,
        nextCursor: null,
        queryId: null,
      },
    };
  }

  async verMas(consultaId: string, pagina: number) {
  const cache = await this.redisClient.get(
    `chat:query:${consultaId}`,
  );

  if (!cache) {
    return {
      message: 'La consulta ha expirado. Realiza una nueva búsqueda.',
      type: 'product_list',
      data: [],
      meta: {
        total: 0,
        hasMore: false,
        nextCursor: null,
        queryId: null,
        pagina: 0,
      },
    };
  }

  const parsed = JSON.parse(cache);

  // Modo ofertas pagina de 10 en 10, el resto de 12 en 12
  const limit = parsed.ofertaPura ? OFFER_LIMIT : 12;
  const offset = (pagina - 1) * limit;

  // Formato legacy (solo booleanQuery, sin comboLikes): paginado solo-artículos como antes
  if (parsed.comboLikes === undefined && !parsed.ofertaPura) {
    return this.verMasLegacy(consultaId, parsed.booleanQuery, pagina);
  }

  const tipo_de_cambio: any =
    await this.prisma.exchange_rates.findFirst({
      orderBy: {
        date: 'desc',
      },
    });
  const rate = Number(tipo_de_cambio?.parallel_rate) || 0;
  const appURL = this.configService.get<string>('APP_URL');

  const { rows: data, total } = await this.ejecutarBusqueda({
    booleanQuery: parsed.booleanQuery || '',
    tokensTexto: parsed.tokensTexto || '',
    queryOriginal: parsed.queryOriginal || '',
    pideOferta: !!parsed.pideOferta,
    ofertaPura: !!parsed.ofertaPura,
    comboLikes: parsed.comboLikes || [],
    limit,
    offset,
    rate,
  });

  const hasMore = offset + data.length < total;

  const totalPaginas = Math.ceil(total / limit);

  return {
    message:
      data.length === 0
        ? 'No hay más productos'
        : 'Aquí tienes más resultados',

    type: 'product_list',

    data: this.mapPrecios(data, rate, appURL),

    meta: {
      total,
      hasMore,
      queryId: hasMore ? consultaId : null,
      pagina,
      totalPaginas,
    },
  };
  }

  /** Paginado legacy para queryIds guardados antes del formato unión+ofertas (TTL 10 min). */
  private async verMasLegacy(consultaId: string, booleanQuery: string, pagina: number) {
  const limit = 12;
  const offset = (pagina - 1) * limit;

  const [data = [], totalResult] = await Promise.all([
    this.prisma.$queryRaw`
      SELECT
        a.id,
        a.description AS nombre,
        a.public_price AS precio,

        (
          SELECT i.url
          FROM article_images i
          WHERE i.article_id = a.id
          LIMIT 1
        ) AS imagen,

        b.name AS marca,
        c.name AS categoria,
        a.slug AS ruta

      FROM articles a

      INNER JOIN brands b
        ON b.id = a.brand_id

      INNER JOIN categories c
        ON c.id = a.category_id

      WHERE a.status=1 AND a.venta=1 AND a.habilitado_web=1 AND a.slug IS NOT NULL AND a.id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)
      AND MATCH(a.description)
        AGAINST (${booleanQuery} IN BOOLEAN MODE)

      ORDER BY
  MATCH(a.description)
    AGAINST (${booleanQuery} IN BOOLEAN MODE) DESC,
  a.id ASC

      LIMIT ${limit}
      OFFSET ${offset}
    ` as any,

    this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total
      FROM articles a
      WHERE a.status=1 AND a.venta=1 AND a.habilitado_web=1 AND a.slug IS NOT NULL AND a.id IN (SELECT article_id FROM v_article_stock_global WHERE saldo > 0)
      AND MATCH(a.description)
        AGAINST (${booleanQuery} IN BOOLEAN MODE)
    `,
  ]);

  const total = Number(totalResult[0]?.total ?? 0);

  const hasMore = offset + data.length < total;

  const totalPaginas = Math.ceil(total / limit);

  const tipo_de_cambio: any =
    await this.prisma.exchange_rates.findFirst({
      orderBy: {
        date: 'desc',
      },
    });

  const appURL =
    this.configService.get<string>('APP_URL');

  return {
    message:
      data.length === 0
        ? 'No hay más productos'
        : 'Aquí tienes más resultados',

    type: 'product_list',

    data: data.map((item: any) => ({
      ...item,

      precio: Number(
        (
          Number(item.precio) *
          (Number(tipo_de_cambio?.parallel_rate) || Number(tipo_de_cambio?.parallel_rate) || 0)
        ).toFixed(2)
      ),

      imagen: item.imagen
        ? appURL + item.imagen
        : null,
    })),

    meta: {
      total,
      hasMore,
      queryId: hasMore ? consultaId : null,
      pagina,
      totalPaginas,
    },
  };
  }
}
 