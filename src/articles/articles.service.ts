import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { calcComboTotals, priceComboLine } from './utils/combo-price.util';

@Injectable()
export class ArticlesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }
  async findAll(params: {
page?: number;
    limit?: number;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    categoryId?: number;
    subCategoryId?: number;
    brandId?: number;
    inStock?: boolean;
    sort?: string;
    exclude?: number;
    nuevos?: boolean;
    ofertas?: boolean;
    type?: string;
    aleatorio?: boolean;  
  }) {
    const {
      page = 1,
      limit = 10,
      search,
      minPrice,
      maxPrice,
      categoryId,
      subCategoryId,
      brandId,
      inStock,
      sort,
      exclude,
      nuevos,
      ofertas,
      type,
      aleatorio,
    } = params;

    const skip = (page - 1) * limit;

    const where: any = {
      status: 1,
      venta: true,
      habilitado_web: true,
      slug: { not: null },
    };

    if (search) {
      const rawTerms = search.toLowerCase().trim().split(/\s+/);

      const synonymMap: Record<string, string[]> = {
        laptop: ['notebook', 'laptop', 'portatil'],
        laptops: ['notebook', 'laptop', 'portatil'],
        notebook: ['laptop', 'notebook', 'portatil'],
        computadora: ['computador', 'desktop'],
        computadoras: ['computador', 'desktop'],
        celular: ['telefono', 'smartphone', 'movil'],
        celulares: ['telefono', 'smartphone', 'movil'],
      };

      where.AND = rawTerms.map((originalTerm) => {
        let term = originalTerm;
        if (term.endsWith('s') && term.length > 4) term = term.slice(0, -1);
        if (term.endsWith('es') && term.length > 5) term = term.slice(0, -2);

        const relatedTerms = Array.from(
          new Set([
            originalTerm,
            term,
            ...(synonymMap[originalTerm] || []),
            ...(synonymMap[term] || []),
          ]),
        // Filtrar términos muy cortos que generan falsos positivos (ej: "pc" → PCIE)
        ).filter((t) => t.length >= 4);

        // Si no quedan términos válidos, usar el término original directamente
        const termsToSearch = relatedTerms.length > 0 ? relatedTerms : [originalTerm];

        return {
          OR: termsToSearch.flatMap((t) => [
            // 1. Coincidencia directa en Categoría o Marca
            { categories: { name: { contains: t } } },
            { brands: { name: { contains: t } } },

            // 2. Coincidencia en Descripción, excluyendo accesorios relacionados
            {
              AND: [
                { description: { contains: t } },
                { description: { not: { contains: `para ${t}` } } },
                { description: { not: { contains: `compatible ${t}` } } },
                { description: { not: { contains: `compatible con ${t}` } } },
                { description: { not: { contains: `uso en ${t}` } } },
              ],
            },

            // 3. Coincidencia en Código de Fabricante
            { cod_fab: { contains: t } },
          ]),
        };
      });
    }

    if (categoryId) where.category_id = BigInt(categoryId);
    if (subCategoryId) where.sub_category_id = BigInt(subCategoryId);
    if (brandId) where.brand_id = BigInt(brandId);

    if (minPrice || maxPrice) {
      where.public_price = {
        gte: minPrice ? Number(minPrice) : undefined,
        lte: maxPrice ? Number(maxPrice) : undefined,
      };
    }

    const stockRows: any[] = await this.prisma.$queryRaw`SELECT article_id FROM v_article_stock_global WHERE saldo > 0`;
    const inStockIds = stockRows.map(r => BigInt(r.article_id));
    // Si no hay stock, forzar where imposible para devolver vacío rápido
    if (inStockIds.length === 0) {
      where.id = { in: [] };
    } else {
      where.id = { in: inStockIds };
      // Si además se pide exclude, combinar con NOT
      if (exclude) {
        where.AND = [...(where.AND || []), { id: { not: BigInt(exclude) } }];
        // Limpiar where.id.in para no duplicar clave id
        // Se mantiene el filtro de stock via AND   
        const stockIn = where.id;
        delete where.id;
        where.AND.push({ id: stockIn });
      }
    }
    // El param inStock queda deprecado: el filtro es siempre obligatorio para web pública
    // Si en el futuro se necesita bypass admin, usar ?includeOutOfStock=true

    // Nota: el bloque if (exclude) anterior ya fue integrado con el filtro de stock
    // Se deja sin duplicar para no sobrescribir where.id.in

    if (nuevos) {
      where.is_new_for_web = true;
    }

    if (ofertas) {
      where.has_offer = true;
    }
    


    // ── Inteligencia de Type Filter ──────────────────────────────────────────
    // Si envían type='brand' y un search, intentamos buscar esa marca y filtrar por ella
    if (search && type) {
      if (type === 'brand') {
        const brand = await this.prisma.brands.findFirst({
          where: { name: { contains: search } },
          select: { id: true },
        });
        if (brand) where.brand_id = brand.id;
      } else if (type === 'category') {
        const category = await this.prisma.categories.findFirst({
          where: { name: { contains: search } },
          select: { id: true },
        });
        if (category) where.category_id = category.id;
      } else if (type === 'subcategory') {
        const subcategory = await this.prisma.sub_categories.findFirst({
          where: { name: { contains: search } },
          select: { id: true },
        });
        if (subcategory) where.sub_category_id = subcategory.id;
      }
    }

    //  schema original usa 'date_at'
    let orderBy: any = { date_at: 'desc' };
    if (sort === 'price_asc') orderBy = { public_price: 'asc' };
    if (sort === 'price_desc') orderBy = { public_price: 'desc' };
    if (sort === 'newest') orderBy = { date_at: 'desc' };

    // Si es aleatorio, no usamos el skip/take tradicional de la misma forma si queremos real aleatoriedad
    // Pero para simplificar, si es aleatorio y no hay sort, barajamos

    const [articles, total] = await Promise.all([
      type === 'combo' ? Promise.resolve([]) : this.prisma.articles.findMany({
        where,
        skip: aleatorio ? undefined : (isNaN(skip) ? 0 : skip),
        take: aleatorio ? 100 : limit, // Traemos más para barajar si es aleatorio
        orderBy,
        include: {
          categories: true,
          brands: true,
          article_images: true,
          reviews: {
            where: { status: 1 },
            select: { rating: true },
          },
        },
      }),
      type === 'combo' ? Promise.resolve(0) : this.prisma.articles.count({ where }),
    ]);

    let finalArticles = articles;
    if (aleatorio) {
      finalArticles = articles.sort(() => Math.random() - 0.5).slice(0, limit);
    }

    // ── Combos (build_pc_tabla) ──────────────────────────────────────────────
    // Un combo aparece si su nombre coincide con el search
    // OR si contiene artículos de la categoría/marca/subcategoría buscada.
    const needCombos = !!(search || categoryId || subCategoryId || brandId);

    const comboOrConditions: any[] = [];

    if (search) {
      const searchTerms = search.toLowerCase().trim().split(/\s+/);
      const isComputerSearch = searchTerms.some(t =>
        ['computadora', 'computadoras', 'pc', 'desktop', 'computador', 'laptop', 'notebook'].includes(t)
      );

      if (isComputerSearch) {
        // Si busca computadoras, traer todos los combos activos por defecto o por coincidencia
        comboOrConditions.push({ status: true });
      } else {
        comboOrConditions.push({ name: { contains: search } });
        comboOrConditions.push({ description: { contains: search } });
      }
    }

    if (categoryId || subCategoryId || brandId || (type === 'category' && where.category_id)) {
      const articleFilter: any = {};
      const finalCatId = categoryId || (type === 'category' ? where.category_id : undefined);
      const finalSubCatId = subCategoryId || (type === 'subcategory' ? where.sub_category_id : undefined);
      const finalBrandId = brandId || (type === 'brand' ? where.brand_id : undefined);

      if (finalCatId) articleFilter.category_id = BigInt(finalCatId);
      if (finalSubCatId) articleFilter.sub_category_id = BigInt(finalSubCatId);
      if (finalBrandId) articleFilter.brand_id = BigInt(finalBrandId);

      comboOrConditions.push({
        build_detail_pc_tabla: { some: { articles: articleFilter } },
      });
    }

    // Si hay más de una condición usar OR, si hay una sola usarla directa
    const comboWhere: any =
      
      comboOrConditions.length > 1
        ? { OR: comboOrConditions }
        : comboOrConditions.length === 1
          ? comboOrConditions[0]
          : {};

    // Si se pide específicamente type brand o category y no hay combos relacionados, no traer combos
    const skipCombos = type === 'article' || (type === 'brand' && !brandId) || (type === 'category' && !categoryId);

    const rawCombos = (needCombos && !skipCombos) || type === 'combo'
      ? await this.prisma.build_pc_tabla.findMany({
          where: {...comboWhere,
              build_detail_pc_tabla: {
    some: {
      articles: {
        habilitado_web:true
      },
    },
  },
          },
          take: aleatorio ? 50 : limit,
          include: {
            build_detail_pc_tabla: {

              include: {
                articles: {
                  
                  include: {
                    article_images: {
                      orderBy: { position: 'asc' },
                    },
                    categories: true,
                    brands: true,
                  },
                },
              },
            },
          },
        })
      : [];


    // ── Tipo de cambio ───────────────────────────────────────────────────────
   const exchangeRate = await this.prisma.exchange_rates.findFirst({
  orderBy: {
    date: 'desc',
  },
});


const dollarRate = exchangeRate ? Number(exchangeRate.parallel_rate) : 0;

    // ── Resolver nombres de filtros aplicados ─────────────────────────────
    const appliedFilters: { type: string; id: string; name: string }[] = [];

    if (categoryId) {
      const cat = await this.prisma.categories.findUnique({ where: { id: BigInt(categoryId) }, select: { name: true } });
      appliedFilters.push({ type: 'category', id: String(categoryId), name: cat?.name ?? 'Desconocida' });
    }
    if (subCategoryId) {
      const sub = await this.prisma.sub_categories.findUnique({ where: { id: BigInt(subCategoryId) }, select: { name: true } });
      appliedFilters.push({ type: 'subcategory', id: String(subCategoryId), name: sub?.name ?? 'Desconocida' });
    }
    if (brandId) {
      const br = await this.prisma.brands.findUnique({ where: { id: BigInt(brandId) }, select: { name: true } });
      appliedFilters.push({ type: 'brand', id: String(brandId), name: br?.name ?? 'Desconocida' });
    }

    let finalCombos = rawCombos;
    if (aleatorio) {
      finalCombos = rawCombos.sort(() => Math.random() - 0.5).slice(0, limit);
    }

    let itemType = 'article';
    if (type && ['brand', 'category', 'subcategory'].includes(type)) {
      itemType = type;
    } else if (appliedFilters.length > 0) {
      itemType = appliedFilters[0].type;
    }


    const data = finalArticles.map((article) => ({
      type: itemType as any,
      ...article,
      id: article.id.toString(),
      measurement_unit_id: article.measurement_unit_id?.toString(),
      brand_id: article.brand_id?.toString(),
      category_id: article.category_id?.toString(),
      sub_category_id: article.sub_category_id?.toString(),
      currency_type_id: article.currency_type_id?.toString(),
      company_type_id: article.company_type_id?.toString(),
      user_id: article.user_id?.toString(),
      last_supplier: article.last_supplier?.toString(),
      last_entry_guide: article.last_entry_guide?.toString(),
      article_type_id: article.article_type_id?.toString(),

precio_public_soles: article.public_price
  ? Number(
      (
        article.currency_type_id?.toString() === '1'
          ? Number(article.public_price)
          : Number(article.public_price) * Number(dollarRate)
      ).toFixed(2)
    )
  : null,

precio_public_dolares: article.public_price
  ? Number(
      (
        article.currency_type_id?.toString() === '2'
          ? Number(article.public_price)
          : Number(dollarRate) > 0 ? Number(article.public_price) / Number(dollarRate) : 0
      ).toFixed(2)
    )
  : null,

precio_porcentaje: article.public_price
  ? Number(
      (
        (
          article.currency_type_id?.toString() === '1'
            ? Number(article.public_price)
            : Number(article.public_price) * Number(dollarRate)
        ) *
        (
          1 - Number(article.offer_price_percent || 0) / 100
        )
      ).toFixed(2)
    )
  : null,

precio_porcentaje_dolares: article.public_price
  ? Number(
      (
        (
          article.currency_type_id?.toString() === '2'
            ? Number(article.public_price)
            : Number(dollarRate) > 0 ? Number(article.public_price) / Number(dollarRate) : 0
        ) *
        (
          1 - Number(article.offer_price_percent || 0) / 100
        )
      ).toFixed(2)
    )
  : null,

is_new_for_web: article.is_new_for_web ? 1 : 0,

has_offer: article.has_offer ? 1 : 0,

      offer_price_percent: article.offer_price_percent ? Number(article.offer_price_percent) : 0,
      precio_final: article.precio_final != null ? Number(article.precio_final) : null,
      precio_final_soles: article.precio_final != null
        ? Number((article.currency_type_id?.toString() === '1' ? Number(article.precio_final) : Number(article.precio_final) * Number(dollarRate)).toFixed(2))
        : null,
      precio_final_dolares: article.precio_final != null
        ? Number((article.currency_type_id?.toString() === '2' ? Number(article.precio_final) : Number(dollarRate) > 0 ? Number(article.precio_final) / Number(dollarRate) : 0).toFixed(2))
        : null,
      categories: article.categories ? { ...article.categories, id: article.categories.id.toString(),} : null,
      brands: article.brands ? { ...article.brands, id: article.brands.id.toString(),} : null,
      public_price: article.public_price ? parseFloat(article.public_price.toString()) : null,
      purchase_price: article.purchase_price ? parseFloat(article.purchase_price.toString()) : null,
      distributor_price: article.distributor_price ? parseFloat(article.distributor_price.toString()) : null,
      authorized_price: article.authorized_price ? parseFloat(article.authorized_price.toString()) : null,
      total_reviews: article.reviews.length,
      name: article.description,
      average_rating:
        article.reviews.length > 0
          ? parseFloat(
              (
                article.reviews.reduce((sum, r) => sum + r.rating, 0) /
                article.reviews.length
              ).toFixed(1),
            )
          : 0,
    }));

    // ── Formatear combos y fusionar en data ───────────────────────────────
    // stock para combos (saldo por componente) — misma vista que usa stocks-articles
    const allComboArticleIds = finalCombos.flatMap((c) => c.build_detail_pc_tabla.map((d) => d.articles.id));
    const comboStockRows: any[] = allComboArticleIds.length ? await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(allComboArticleIds)})` : [];
    const comboStockMap = new Map<string, number>();
    comboStockRows.forEach((r: any) => comboStockMap.set(String(r.article_id), Number(r.saldo)));
    // Precios de combos vienen de la suma de sus artículos (como artículos normales), no de combo.total_price (estaba en 0)
    const formattedCombos = finalCombos.map((combo) => {
      // Total desde precios efectivos (precio_final > oferta > public_price),
      // redondeo único al final para que cuadre con la suma de los items.
      const comboItems = combo.build_detail_pc_tabla.map((detail) => {
        const art = detail.articles;
        const line = priceComboLine(art, dollarRate);
        const currencyStr = art.currency_type_id?.toString();
        return {
          quantity: detail.quantity,
          article_id: art.id.toString(),
          cod_fab: art.cod_fab,
          description: art.description,
          public_price: art.public_price ? parseFloat(art.public_price.toString()) : null,
          public_price_soles: art.public_price ? parseFloat((
                  currencyStr === '1'
                    ? parseFloat(art.public_price.toString())
                    : parseFloat(art.public_price.toString()) * dollarRate
                ).toFixed(2),) : null,
          public_price_dolares: art.public_price ? parseFloat((
                  currencyStr === '2'
                    ? parseFloat(art.public_price.toString())
                    : dollarRate > 0 ? parseFloat(art.public_price.toString()) / dollarRate : 0
                ).toFixed(2),): null,
          precio_final: art.precio_final != null ? Number(art.precio_final) : null,
          has_offer: art.has_offer ? 1 : 0,
          offer_price_percent: art.offer_price_percent ? Number(art.offer_price_percent) : 0,
          effective_price: line.effective_price,
          effective_price_soles: line.effective_price_soles,
          effective_price_dolares: line.effective_price_dolares,
          saldo: comboStockMap.get(String(art.id)) ?? 0,
          category: art.categories? {
                id: art.categories.id.toString(),
                name: art.categories.name,
              }: null,
          brand: art.brands ? {
                id: art.brands.id.toString(),
                name: art.brands.name,
              }
            : null,
          article_images: art.article_images.map(img => ({
            id: img.id.toString(),
            url: this.formatImageUrl(img.url),
            position: img.position,
            is_main: img.is_main,
          })),
        };
      });
      const totals = calcComboTotals(combo.build_detail_pc_tabla, dollarRate, combo.total_price);
      const finalTotalPrice = totals.total_price;
      const finalTotalPriceSoles = totals.total_price_soles;
      return {
        id: combo.id.toString(),
        type: 'combo',
        name: combo.name,
        slug: combo.slug,
        description: combo.description,
        image_build: this.formatBuildImageUrl(combo.image_build),
        total_price: finalTotalPrice,
        total_price_soles: finalTotalPriceSoles,
        created_at: combo.created_at,
        updated_at: combo.updated_at,
        items: comboItems,
      };
    });

    // Los combos se mezclan dentro de data para que el frontend los reciba en un solo array
    const dataWithCombos = [...data, ...formattedCombos];

    return {
      data: dataWithCombos,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        applied_filters: appliedFilters.length > 0 ? appliedFilters : undefined,
      },
    };
  }

  async findBySlug(slug: string) {

     if (!slug || slug === 'null' || slug === 'undefined') {
    throw new NotFoundException(`Slug inválido: ${slug}`);
  }

    const article = await this.prisma.articles.findFirst({
      where: { slug, status: 1, venta: true, habilitado_web: true },
      include: {
        categories: true,
        brands: true,
        article_images: true,
        reviews: { where: { status: 1 }, select: { rating: true } },
      },
    });

    if (article) {
      // Validar stock > 0 (v_article_stock_global.saldo) - si no hay stock, intentar combo antes de fallar
      const stockCheck: any[] = await this.prisma.$queryRaw`SELECT saldo FROM v_article_stock_global WHERE article_id = ${article.id}`;
      if (stockCheck[0] && Number(stockCheck[0].saldo) > 0) {
        const exchangeRateArt = await this.prisma.exchange_rates.findFirst({ orderBy: { date: 'desc' } });
        const dollarRateArt = exchangeRateArt ? Number(exchangeRateArt.parallel_rate) : 0;
        let subCategoryArt: any = null;
        if (article.sub_category_id) {
          subCategoryArt = await this.prisma.sub_categories.findUnique({ where: { id: article.sub_category_id } });
        }
        // retornar artículo (mismo bloque de abajo, pero ya con stock válido)
        const matched = article;
        return {
          type: 'article' as const,
          name: matched.description,
          ...matched,
          id: matched.id.toString(),
          measurement_unit_id: matched.measurement_unit_id?.toString(),
          brand_id: matched.brand_id?.toString(),
          category_id: matched.category_id?.toString(),
          sub_category_id: matched.sub_category_id?.toString(),
          currency_type_id: matched.currency_type_id?.toString(),
          company_type_id: matched.company_type_id?.toString(),
          user_id: matched.user_id?.toString(),
          last_supplier: matched.last_supplier?.toString(),
          last_entry_guide: matched.last_entry_guide?.toString(),
          article_type_id: matched.article_type_id?.toString(),
          precio_public_soles: matched.public_price ? Number((matched.currency_type_id?.toString() === '1' ? Number(matched.public_price) : Number(matched.public_price) * Number(dollarRateArt)).toFixed(2)) : null,
          precio_public_dolares: matched.public_price ? Number((matched.currency_type_id?.toString() === '2' ? Number(matched.public_price) : dollarRateArt > 0 ? Number(matched.public_price) / Number(dollarRateArt) : 0).toFixed(2)) : null,
          precio_porcentaje: matched.public_price ? Number(((matched.currency_type_id?.toString() === '1' ? Number(matched.public_price) : Number(matched.public_price) * Number(dollarRateArt)) * (1 - Number(matched.offer_price_percent || 0) / 100)).toFixed(2)) : null,
          precio_porcentaje_dolares: matched.public_price ? Number(((matched.currency_type_id?.toString() === '2' ? Number(matched.public_price) : dollarRateArt > 0 ? Number(matched.public_price) / Number(dollarRateArt) : 0) * (1 - Number(matched.offer_price_percent || 0) / 100)).toFixed(2)) : null,
          is_new_for_web: matched.is_new_for_web ? 1 : 0,
          has_offer: matched.has_offer ? 1 : 0,
          offer_price_percent: matched.offer_price_percent ? Number(matched.offer_price_percent) : 0,
          precio_final: matched.precio_final != null ? Number(matched.precio_final) : null,
          precio_final_soles: matched.precio_final != null
            ? Number((matched.currency_type_id?.toString() === '1' ? Number(matched.precio_final) : Number(matched.precio_final) * Number(dollarRateArt)).toFixed(2))
            : null,
          precio_final_dolares: matched.precio_final != null
            ? Number((matched.currency_type_id?.toString() === '2' ? Number(matched.precio_final) : Number(dollarRateArt) > 0 ? Number(matched.precio_final) / Number(dollarRateArt) : 0).toFixed(2))
            : null,
          categories: matched.categories ? { ...matched.categories, id: matched.categories.id.toString() } : null,
          brands: matched.brands ? { ...matched.brands, id: matched.brands.id.toString() } : null,
          sub_categories: subCategoryArt ? { ...subCategoryArt, id: subCategoryArt.id.toString() } : null,
          public_price: matched.public_price ? parseFloat(matched.public_price.toString()) : null,
          purchase_price: matched.purchase_price ? parseFloat(matched.purchase_price.toString()) : null,
          distributor_price: matched.distributor_price ? parseFloat(matched.distributor_price.toString()) : null,
          authorized_price: matched.authorized_price ? parseFloat(matched.authorized_price.toString()) : null,
          total_reviews: matched.reviews.length,
          average_rating: matched.reviews.length > 0 ? parseFloat((matched.reviews.reduce((sum, r) => sum + r.rating, 0) / matched.reviews.length).toFixed(1)) : 0,
        };
      }
    }

    // No es artículo o sin stock — buscar combo por slug (misma tabla que usa GET /articles/{id} por id)
    const comboBySlug = await this.prisma.build_pc_tabla.findFirst({
      where: { slug },
      include: {
        build_detail_pc_tabla: {
          include: {
            articles: {
              include: {
                article_images: { orderBy: { position: 'asc' } },
                categories: true,
                brands: true,
              },
            },
          },
        },
      },
    });
    if (comboBySlug) {
      const exchangeRate = await this.prisma.exchange_rates.findFirst({ orderBy: { date: 'desc' } });
      const dollarRate = exchangeRate ? Number(exchangeRate.parallel_rate) : 0;
      // stock por componente para saldo en items[]
      const articleIds = comboBySlug.build_detail_pc_tabla.map((d) => d.articles.id);
      const stockRows: any[] = articleIds.length ? await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(articleIds)})` : [];
      const stockMap = new Map<string, number>();
      stockRows.forEach((r: any) => stockMap.set(String(r.article_id), Number(r.saldo)));
      const totalsBySlug = calcComboTotals(comboBySlug.build_detail_pc_tabla, dollarRate, comboBySlug.total_price);
      const finalTotalPrice = totalsBySlug.total_price;
      const finalTotalPriceSoles = totalsBySlug.total_price_soles;
      return {
        id: comboBySlug.id.toString(),
        type: 'combo' as const,
        name: comboBySlug.name,
        slug: comboBySlug.slug,
        description: comboBySlug.description,
        total_price: finalTotalPrice,
        total_price_soles: finalTotalPriceSoles,
        image_build: this.formatBuildImageUrl(comboBySlug.image_build),
        created_at: comboBySlug.created_at,
        updated_at: comboBySlug.updated_at,
        items: comboBySlug.build_detail_pc_tabla.map((detail) => {
          const lineBySlug = priceComboLine(detail.articles, dollarRate);
          return {
          quantity: detail.quantity,
          article_id: detail.articles.id.toString(),
          cod_fab: detail.articles.cod_fab,
          description: detail.articles.description,
          slug: detail.articles.slug,
          name: detail.articles.description,
          public_price: detail.articles.public_price ? parseFloat(detail.articles.public_price.toString()) : null,
          public_price_soles: detail.articles.public_price ? parseFloat((detail.articles.currency_type_id?.toString() === '1' ? parseFloat(detail.articles.public_price.toString()) : parseFloat(detail.articles.public_price.toString()) * dollarRate).toFixed(2)) : null,
          public_price_dolares: detail.articles.public_price ? parseFloat((detail.articles.currency_type_id?.toString() === '2' ? parseFloat(detail.articles.public_price.toString()) : dollarRate > 0 ? parseFloat(detail.articles.public_price.toString()) / dollarRate : 0).toFixed(2)) : null,
          precio_final: detail.articles.precio_final != null ? Number(detail.articles.precio_final) : null,
          has_offer: detail.articles.has_offer ? 1 : 0,
          offer_price_percent: detail.articles.offer_price_percent ? Number(detail.articles.offer_price_percent) : 0,
          effective_price: lineBySlug.effective_price,
          effective_price_soles: lineBySlug.effective_price_soles,
          effective_price_dolares: lineBySlug.effective_price_dolares,
          saldo: stockMap.get(String(detail.articles.id)) ?? 0,
          category: detail.articles.categories ? { id: detail.articles.categories.id.toString(), name: detail.articles.categories.name } : null,
          brand: detail.articles.brands ? { id: detail.articles.brands.id.toString(), name: detail.articles.brands.name } : null,
          article_images: detail.articles.article_images.map((img: any) => ({ id: img.id.toString(), url: this.formatImageUrl(img.url), position: img.position, is_main: img.is_main })),
          };
        }),
      };
    }

    throw new NotFoundException(`Artículo con slug "${slug}" no encontrado`);
  }

  async findOne(id: number) {

      if (id === null || id === undefined || isNaN(Number(id))) {
    throw new NotFoundException(`ID de artículo inválido: ${id}`);
  }
    const article = await this.prisma.articles.findUnique({
      where: { id: BigInt(id) },
      include: {
        categories: true,
        brands: true,
        article_images: true,
        reviews: {
          where: { status: 1 },
          select: { rating: true },
        },
      },
    });

    const exchangeRate = await this.prisma.exchange_rates.findFirst({
      orderBy: { date: 'desc' },
    });
    const dollarRate = exchangeRate ? Number(exchangeRate.parallel_rate) : 0;

    if (article) {
      // Solo mostrar en web si está habilitado, activo, venta habilitada y con stock > 0
      const isWebVisible = article.status === 1 && article.venta === true && (article as any).habilitado_web === true;
      if (isWebVisible) {
        const stockCheck: any[] = await this.prisma.$queryRaw`SELECT saldo FROM v_article_stock_global WHERE article_id = ${article.id}`;
        if (!stockCheck[0] || Number(stockCheck[0].saldo) <= 0) {
          // Sin stock -> tratar como no encontrado para web, caer al lookup de combo
        } else {
      let subCategory: any = null;
      if (article.sub_category_id) {
        subCategory = await this.prisma.sub_categories.findUnique({
          where: { id: article.sub_category_id },
        });
      }

      return {
        type: 'article' as const,
        name: article.description,
        ...article,
        id: article.id.toString(),
        measurement_unit_id: article.measurement_unit_id?.toString(),
        brand_id: article.brand_id?.toString(),
        category_id: article.category_id?.toString(),
        sub_category_id: article.sub_category_id?.toString(),
        currency_type_id: article.currency_type_id?.toString(),
        company_type_id: article.company_type_id?.toString(),
        user_id: article.user_id?.toString(),
        last_supplier: article.last_supplier?.toString(),
        last_entry_guide: article.last_entry_guide?.toString(),
        article_type_id: article.article_type_id?.toString(),
        precio_public_soles: article.public_price
  ? Number(
      (
        article.currency_type_id?.toString() === '1'
          ? Number(article.public_price)
          : Number(article.public_price) * Number(dollarRate)
      ).toFixed(2)
    )
  : null,

precio_public_dolares: article.public_price
  ? Number(
      (
        article.currency_type_id?.toString() === '2'
          ? Number(article.public_price)
          : Number(dollarRate) > 0 ? Number(article.public_price) / Number(dollarRate) : 0
      ).toFixed(2)
    )
  : null,

precio_porcentaje: article.public_price
  ? Number(
      (
        (
          article.currency_type_id?.toString() === '1'
            ? Number(article.public_price)
            : Number(article.public_price) * Number(dollarRate)
        ) *
        (
          1 - Number(article.offer_price_percent || 0) / 100
        )
      ).toFixed(2)
    )
  : null,

precio_porcentaje_dolares: article.public_price
  ? Number(
      (
        (
          article.currency_type_id?.toString() === '2'
            ? Number(article.public_price)
            : Number(dollarRate) > 0 ? Number(article.public_price) / Number(dollarRate) : 0
        ) *
        (
          1 - Number(article.offer_price_percent || 0) / 100
        )
      ).toFixed(2)
    )
  : null,

is_new_for_web: article.is_new_for_web ? 1 : 0,

has_offer: article.has_offer ? 1 : 0,

        offer_price_percent: article.offer_price_percent ? Number(article.offer_price_percent) : 0,
        precio_final: article.precio_final != null ? Number(article.precio_final) : null,
        precio_final_soles: article.precio_final != null
          ? Number((article.currency_type_id?.toString() === '1' ? Number(article.precio_final) : Number(article.precio_final) * Number(dollarRate)).toFixed(2))
          : null,
        precio_final_dolares: article.precio_final != null
          ? Number((article.currency_type_id?.toString() === '2' ? Number(article.precio_final) : Number(dollarRate) > 0 ? Number(article.precio_final) / Number(dollarRate) : 0).toFixed(2))
          : null,
        categories: article.categories ? { ...article.categories, id: article.categories.id.toString() } : null,
        brands: article.brands ? { ...article.brands, id: article.brands.id.toString() } : null,
        sub_categories: subCategory ? { ...subCategory, id: subCategory.id.toString() } : null,
        public_price: article.public_price ? parseFloat(article.public_price.toString()) : null,
        purchase_price: article.purchase_price ? parseFloat(article.purchase_price.toString()) : null,
        distributor_price: article.distributor_price ? parseFloat(article.distributor_price.toString()) : null,
        authorized_price: article.authorized_price ? parseFloat(article.authorized_price.toString()) : null,
        total_reviews: article.reviews.length,
        average_rating:
          article.reviews.length > 0
            ? parseFloat(
              (
                article.reviews.reduce((sum, r) => sum + r.rating, 0) /
                article.reviews.length
              ).toFixed(1),
            )
            : 0,
      };
        }
      }
    }

    // Si no es artículo o no es visible (habilitado_web=false / sin stock), buscar en combos
    const combo = await this.prisma.build_pc_tabla.findUnique({
      where: { id: BigInt(id) },
      include: {
        build_detail_pc_tabla: {
          include: {
            articles: {
              include: {
                article_images: {
                  orderBy: { position: 'asc' },
                },
                categories: true,
                brands: true,
              },
            },
          },
        },
      },
    });

    if (combo) {
      const articleIdsCombo = combo.build_detail_pc_tabla.map((d) => d.articles.id);
      const stockRowsCombo: any[] = articleIdsCombo.length ? await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(articleIdsCombo)})` : [];
      const stockMapCombo = new Map<string, number>();
      stockRowsCombo.forEach((r: any) => stockMapCombo.set(String(r.article_id), Number(r.saldo)));
      // Total desde precios efectivos (precio_final > oferta > public_price),
      // redondeo único al final para que cuadre con la suma de los items.
      const totalsById = calcComboTotals(combo.build_detail_pc_tabla, dollarRate, combo.total_price);
      const finalTotalPrice = totalsById.total_price;
      const finalTotalPriceSoles = totalsById.total_price_soles;
      return {
        id: combo.id.toString(),
        type: 'combo' as const,
        name: combo.name,
      slug: combo.slug,
      description: combo.description,
      total_price: finalTotalPrice,
        total_price_soles: finalTotalPriceSoles,
        image_build: this.formatBuildImageUrl(combo.image_build),
        created_at: combo.created_at,
        updated_at: combo.updated_at,
        items: combo.build_detail_pc_tabla.map((detail) => {
          const lineById = priceComboLine(detail.articles, dollarRate);
          return {
          quantity: detail.quantity,
          article_id: detail.articles.id.toString(),
          cod_fab: detail.articles.cod_fab,
          description: detail.articles.description,
          slug: detail.articles.slug,
          name: detail.articles.description,
          public_price: detail.articles.public_price
            ? parseFloat(detail.articles.public_price.toString())
            : null,
          public_price_soles: detail.articles.public_price
            ? parseFloat(
                (
                  detail.articles.currency_type_id?.toString() === '1'
                    ? parseFloat(detail.articles.public_price.toString())
                    : parseFloat(detail.articles.public_price.toString()) * dollarRate
                ).toFixed(2),
              )
            : null,
          public_price_dolares: detail.articles.public_price
            ? parseFloat(
                (
                  detail.articles.currency_type_id?.toString() === '2'
                    ? parseFloat(detail.articles.public_price.toString())
                    : dollarRate > 0 ? parseFloat(detail.articles.public_price.toString()) / dollarRate : 0
                ).toFixed(2),
              )
            : null,
          precio_final: detail.articles.precio_final != null ? Number(detail.articles.precio_final) : null,
          has_offer: detail.articles.has_offer ? 1 : 0,
          offer_price_percent: detail.articles.offer_price_percent ? Number(detail.articles.offer_price_percent) : 0,
          effective_price: lineById.effective_price,
          effective_price_soles: lineById.effective_price_soles,
          effective_price_dolares: lineById.effective_price_dolares,
          saldo: stockMapCombo.get(String(detail.articles.id)) ?? 0,
          category: detail.articles.categories
            ? {
              id: detail.articles.categories.id.toString(),
              name: detail.articles.categories.name,
            }
            : null,
          brand: detail.articles.brands
            ? {
              id: detail.articles.brands.id.toString(),
              name: detail.articles.brands.name,
            }
            : null,
          article_images: detail.articles.article_images.map(img => ({
            id: img.id.toString(),
            url: this.formatImageUrl(img.url),
            position: img.position,
            is_main: img.is_main,
          })),
          };
        }),
      };
    }
    return null;
  }

  async uploadBuildImage(id: number, file: Express.Multer.File) {
    const buildId = BigInt(id);

    // Verificar si el build existe
    const build = await this.prisma.build_pc_tabla.findUnique({
      where: { id: buildId },
    });

    if (!build) {
      throw new NotFoundException(`El build con ID ${id} no existe`);
    }

    const imageUrl = `/storage/builds/${file.filename}`;

    // Actualizar el build con la nueva imagen
    const updatedBuild = await this.prisma.build_pc_tabla.update({
      where: { id: buildId },
      data: { image_build: imageUrl },
    });

    return {
      ...updatedBuild,
      id: updatedBuild.id.toString(),
      company_id: updatedBuild.company_id.toString(),
      image_build: this.formatBuildImageUrl(updatedBuild.image_build),
    };
  }

  async regenerateSlugs() {
    const articles = await this.prisma.articles.findMany({
      where: { slug: null, description: { not: null } },
      select: { id: true, description: true },
    });

    let updated = 0;
    for (const article of articles) {
      const slug = this.generateArticleSlug(article.description!, Number(article.id));
      await this.prisma.articles.update({
        where: { id: article.id },
        data: { slug },
      });
      updated++;
    }

    if (updated > 0) {
      await this.notifyProductRevalidation();
    }

    return { message: `Slugs generados para ${updated} artículos` };
  }

  static generateArticleSlug(description: string, id: number): string {
    const base = description
      .toLowerCase()
      .replace(/\|/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const truncated = base.length <= 50
      ? base
      : base.slice(0, 50).replace(/-[^-]*$/, '');

    return `${truncated}-${id}`;
  }

  private generateArticleSlug(description: string, id: number): string {
    return ArticlesService.generateArticleSlug(description, id);
  }

  private async notifyProductRevalidation(slug?: string): Promise<void> {
    const url = this.configService.get<string>('FRONTEND_REVALIDATE_URL');
    const secret = this.configService.get<string>('REVALIDATE_SECRET');

    if (!url || !secret) return;

    const hasSlug = typeof slug === 'string' && slug.length > 0;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-revalidate-secret': secret,
            ...(hasSlug ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(hasSlug ? { body: JSON.stringify({ slug }) } : {}),
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) return;
      } catch {
        // Revalidation is best-effort and must not break the product operation.
      }

      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  /**
   * Helper para revalidar un artículo puntual con precalentamiento.
   * Obtiene el slug desde BD y lo envía en el body del webhook.
   * Si no hay slug (null/bulk), hace purga genérica sin body.
   */
  private async notifyProductRevalidationById(articleId: bigint | number): Promise<void> {
    try {
      const article = await this.prisma.articles.findUnique({
        where: { id: BigInt(articleId) },
        select: { slug: true },
      });
      const slug = article?.slug ?? undefined;
      await this.notifyProductRevalidation(slug ?? undefined);
    } catch {
      await this.notifyProductRevalidation();
    }
  }

  private formatImageUrl(url: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('http')) return url;

    const baseUrl = this.configService.get('APP_URL') || 'http://192.168.18.26:3000';
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private formatBuildImageUrl(url: string | null): string | null {
    return this.formatImageUrl(url);
  }
  
  async stocksArticles(id: number) {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      throw new BadRequestException('article_id es requerido y debe ser un número válido');
    }
    // Si es combo, devolver saldo mínimo de sus componentes (cuánto combos se pueden armar)
    const combo = await this.prisma.build_pc_tabla.findUnique({
      where: { id: BigInt(id) },
      include: { build_detail_pc_tabla: true },
    });
    if (combo) {
      const articleIds = combo.build_detail_pc_tabla.map((d) => d.article_id);
      if (articleIds.length === 0) return { article_id: String(id), saldo: 0 };
      const stockRows: any[] = await this.prisma.$queryRaw`SELECT article_id, saldo FROM v_article_stock_global WHERE article_id IN (${Prisma.join(articleIds)})`;
      const stockMap = new Map<string, number>();
      stockRows.forEach((r: any) => stockMap.set(String(r.article_id), Number(r.saldo)));
      // saldo del combo = mínimo de (saldo / quantity) entre componentes, floor
      let minSaldo: number | null = null;
      for (const d of combo.build_detail_pc_tabla) {
        const saldo = stockMap.get(String(d.article_id)) ?? 0;
        const perCombo = Math.floor(saldo / d.quantity);
        if (minSaldo === null || perCombo < minSaldo) minSaldo = perCombo;
      }
      return { article_id: String(id), saldo: minSaldo ?? 0 };
    }
    const stockRows: any[] = await this.prisma.$queryRaw`SELECT article_id , saldo FROM v_article_stock_global WHERE article_id = ${BigInt(id)}`;
    return stockRows[0] ?? { article_id: String(id), saldo: 0 };
  }

}
 