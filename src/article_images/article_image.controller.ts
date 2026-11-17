import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  UseFilters,
  BadRequestException,
} from '@nestjs/common';
import { ArticleImageService } from './article_image.service';
import { CreateArticleImageDto } from './dto/create-article_image.dto';
import { UpdateArticleImageDto } from './dto/update-article_image.to';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/guards/admin.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AllExceptionsFilter } from 'src/multer-exception.filter';

const UPLOAD_LIMIT = 20 * 1024 * 1024; // 20MB entrada, salida se normaliza a ~300KB

function imageFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (error: any, acceptFile: boolean) => void,
) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const blocked = ['image/svg+xml', 'image/gif', 'image/tiff'];
  if (blocked.includes(file.mimetype)) {
    return cb(
      new BadRequestException(
        'Formato no permitido. No se aceptan SVG, GIF ni TIFF',
      ),
      false,
    );
  }
  if (!allowed.includes(file.mimetype)) {
    return cb(
      new BadRequestException(
        'Formato no permitido. Solo se aceptan imágenes JPEG, PNG o WebP',
      ),
      false,
    );
  }
  cb(null, true);
}

@Controller('article-images')
export class ArticleImageController {
  constructor(private readonly articleImageService: ArticleImageService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseFilters(AllExceptionsFilter)
  @UseInterceptors(
    FileInterceptor('url', {
      limits: { fileSize: UPLOAD_LIMIT },
      fileFilter: imageFileFilter,
      storage: memoryStorage(),
    }),
  )
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() createArticleImageDto: CreateArticleImageDto,
  ) {
    return this.articleImageService.create(createArticleImageDto, file);
  }

  @Get()
  findAll(@Query('article_id') article_id?: string) {
    return this.articleImageService.findAll(article_id);
  }

  @Get('article/:article_id')
  findAllByArticle(@Param('article_id') article_id: string) {
    return this.articleImageService.findAll(article_id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.articleImageService.findOne(id);
  }

  @Patch('set-main/:id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  setMain(@Param('id') id: string) {
    return this.articleImageService.setMain(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseFilters(AllExceptionsFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: UPLOAD_LIMIT },
      fileFilter: imageFileFilter,
      storage: memoryStorage(),
    }),
  )
  update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() updateArticleImageDto: UpdateArticleImageDto,
  ) {
    return this.articleImageService.update(id, updateArticleImageDto, file);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  remove(@Param('id') id: string) {
    return this.articleImageService.remove(id);
  }
}
