import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  NotFoundException,
} from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { Serialize } from 'src/common/interceptors/serialize.interceptor';
import { ArticleResponseDto } from './dto/article-response.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}


     @Get('recargoTarjeta')
   incrementoPorcentaje(){
    return this.articlesService.incrementoPorcentaje()
  }

  @Get('stocks-articles')
  stocks(@Query('article_id') article_id: number) {
    return this.articlesService.stocksArticles(article_id);
  }

  @Serialize(ArticleResponseDto)
  @Get()
  findAll(@Query() query: any) {
    return this.articlesService.findAll({
      page: query.page ? +query.page : 1,
      limit: query.limit ? +query.limit : 10,
      search: query.search,
      minPrice: query.minPrice ? +query.minPrice : undefined,
      maxPrice: query.maxPrice ? +query.maxPrice : undefined,
      categoryId: query.categoryId ? +query.categoryId : undefined,
      subCategoryId: query.subCategoryId ? +query.subCategoryId : undefined,
      brandId: query.brandId ? +query.brandId : undefined,
      inStock: query.inStock === 'true',
      sort: query.sort,
      exclude: query.exclude ? +query.exclude : undefined,
      nuevos: query.nuevos,
      ofertas: query.ofertas,
      type: query.type,
      aleatorio: query.aleatorio === 'true',
    });
  }

  @Post('upload-build-image/:id')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 2 * 1024 * 1024,
      },
      storage: diskStorage({
        destination: './storage/builds',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          return cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  uploadBuildImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.articlesService.uploadBuildImage(+id, file);
  }

  @Serialize(ArticleResponseDto)
  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.articlesService.findBySlug(slug);
  }

  @Post('regenerate-slugs')
  regenerateSlugs() {
    return this.articlesService.regenerateSlugs();
  }

  @Serialize(ArticleResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    if (!id || id === 'null' || id === 'undefined') {
      throw new NotFoundException(`Identificador inválido: ${id}`);
    }

    const numId = Number(id);
    if (!isNaN(numId)) {
      return this.articlesService.findOne(numId);
    }

    return this.articlesService.findBySlug(id);
  }

}
