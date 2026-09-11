import slugify from 'slugify';

export class ArticleMapper {
  static formatImageUrl(url: string | null, baseUrl: string): string | null {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  static toArticleResponse(
    article: any,
    dollarRate: number,
    baseUrl: string,
    itemType: string = 'article',
    subCategory: any = null,
  ) {
    const publicPrice = article.public_price ? Number(article.public_price) : null;
    const purchasePrice = article.purchase_price ? Number(article.purchase_price) : null;
    const distributorPrice = article.distributor_price ? Number(article.distributor_price) : null;
    const authorizedPrice = article.authorized_price ? Number(article.authorized_price) : null;

    const currencyTypeStr = article.currency_type_id?.toString();

    // Calculations
    const precio_public_soles = publicPrice
      ? Number(
          (
            currencyTypeStr === '1'
              ? publicPrice
              : publicPrice * dollarRate
          ).toFixed(2)
        )
      : null;

    const precio_public_dolares = publicPrice
      ? Number(
          (
            currencyTypeStr === '2'
              ? publicPrice
              : dollarRate > 0 ? publicPrice / dollarRate : 0
          ).toFixed(2)
        )
      : null;

    const offerPercent = Number(article.offer_price_percent || 0);

    const precio_porcentaje = publicPrice
      ? Number(
          (
            (
              currencyTypeStr === '1'
                ? publicPrice
                : publicPrice * dollarRate
            ) * (1 - offerPercent / 100)
          ).toFixed(2)
        )
      : null;

    const precio_porcentaje_dolares = publicPrice
      ? Number(
          (
            (
              currencyTypeStr === '2'
                ? publicPrice
                : dollarRate > 0 ? publicPrice / dollarRate : 0
            ) * (1 - offerPercent / 100)
          ).toFixed(2)
        )
      : null;

    const totalReviews = article.reviews?.length || 0;
    const averageRating = totalReviews > 0
      ? parseFloat(
          (
            article.reviews.reduce((sum: number, r: any) => sum + r.rating, 0) /
            totalReviews
          ).toFixed(1)
        )
      : 0;

    const name = article.description || '';
    const slug = `${slugify(name.replace(/\./g, '-'), {
      lower: true,
      strict: true,
    })}-${article.id}`;

    return {
      ...article,
      type: itemType,
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
      
      precio_public_soles,
      precio_public_dolares,
      precio_porcentaje,
      precio_porcentaje_dolares,

      is_new_for_web: article.is_new_for_web ? 1 : 0,
      has_offer: article.has_offer ? 1 : 0,
      offer_price_percent: offerPercent,

      categories: article.categories
        ? {
            ...article.categories,
            id: article.categories.id.toString(),
          }
        : null,
      brands: article.brands
        ? {
            ...article.brands,
            id: article.brands.id.toString(),
          }
        : null,
      sub_categories: subCategory
        ? {
            ...subCategory,
            id: subCategory.id.toString(),
          }
        : article.sub_categories
          ? {
              ...article.sub_categories,
              id: article.sub_categories.id.toString(),
            }
          : null,

      public_price: publicPrice,
      purchase_price: purchasePrice,
      distributor_price: distributorPrice,
      authorized_price: authorizedPrice,
      article_images: article.article_images,
      total_reviews: totalReviews,
      name,
      slug,
      average_rating: averageRating,
    };
  }

  static toComboResponse(combo: any, dollarRate: number, baseUrl: string) {
    let calcTotalDolares = 0;
    let calcTotalSoles = 0;
    const items = (combo.build_detail_pc_tabla || []).map((detail: any) => {
      const detailArticle = detail.articles;
      const publicPrice = detailArticle.public_price
        ? parseFloat(detailArticle.public_price.toString())
        : null;
      
      const currencyTypeStr = detailArticle.currency_type_id?.toString();

      const public_price_soles = publicPrice
        ? parseFloat(
            (
              currencyTypeStr === '1'
                ? publicPrice
                : publicPrice * dollarRate
            ).toFixed(2)
          )
        : null;

      const public_price_dolares = publicPrice
        ? parseFloat(
            (
              currencyTypeStr === '2'
                ? publicPrice
                : dollarRate > 0 ? publicPrice / dollarRate : 0
            ).toFixed(2)
          )
        : null;

      if (publicPrice !== null) {
        const pSoles = parseFloat((currencyTypeStr === '1' ? publicPrice : publicPrice * dollarRate).toFixed(2));
        const pDolares = parseFloat((currencyTypeStr === '2' ? publicPrice : dollarRate > 0 ? publicPrice / dollarRate : 0).toFixed(2));
        calcTotalSoles += pSoles * detail.quantity;
        calcTotalDolares += pDolares * detail.quantity;
      }

      return {
        quantity: detail.quantity,
        article_id: detailArticle.id.toString(),
        cod_fab: detailArticle.cod_fab,
        description: detailArticle.description,
        name: detailArticle.description,
        public_price: publicPrice,
        public_price_soles,
        public_price_dolares,
        category: detailArticle.categories
          ? {
              id: detailArticle.categories.id.toString(),
              name: detailArticle.categories.name,
            }
          : null,
        brand: detailArticle.brands
          ? {
              id: detailArticle.brands.id.toString(),
              name: detailArticle.brands.name,
            }
          : null,
        article_images: (detailArticle.article_images || []).map((img: any) => ({
          id: img.id.toString(),
          url: this.formatImageUrl(img.url, baseUrl),
          position: img.position,
          is_main: img.is_main,
        })),
      };
    });
    const calcTotalPrice = parseFloat(calcTotalDolares.toFixed(2));
    const calcTotalPriceSoles = parseFloat(calcTotalSoles.toFixed(2));
    const finalTotalPrice = calcTotalPrice > 0 ? calcTotalPrice : combo.total_price;
    const finalTotalPriceSoles = calcTotalSoles > 0 ? calcTotalPriceSoles : dollarRate > 0 ? parseFloat((combo.total_price * dollarRate).toFixed(2)) : null;
    return {
      id: combo.id.toString(),
      type: 'combo',
      name: combo.name,
      description: combo.description,
      image_build: this.formatImageUrl(combo.image_build, baseUrl),
      total_price: finalTotalPrice,
      total_price_soles: finalTotalPriceSoles,
      created_at: combo.created_at,
      updated_at: combo.updated_at,
      items,
    };
  }
}
