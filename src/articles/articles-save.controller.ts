import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ArticlesService } from './articles.service';

function imageUrlFileFilter(
  _req: any,
  file: Express.Multer.File,
  cb: (error: any, acceptFile: boolean) => void,
) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  const blocked = ['image/svg+xml', 'image/gif', 'image/tiff'];
  if (blocked.includes((file.mimetype || '').toLowerCase())) {
    return cb(
      new BadRequestException({
        message: 'La imagen no es válida.',
        errors: {
          image_url: ['La imagen debe ser de tipo: jpeg, png, jpg o webp.'],
        },
      }),
      false,
    );
  }
  if (!allowed.includes((file.mimetype || '').toLowerCase())) {
    return cb(
      new BadRequestException({
        message: 'La imagen no es válida.',
        errors: {
          image_url: ['La imagen debe ser de tipo: jpeg, png, jpg o webp.'],
        },
      }),
      false,
    );
  }
  cb(null, true);
}

@Controller()
export class ArticlesSaveController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Post('articles-save')
  @UseInterceptors(
    FileInterceptor('image_url', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: imageUrlFileFilter,
    }),
  )
  async save(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.articlesService.saveArticleWithImage(body, file);
  }

  @Post('articlesupdate/:id')
  @UseInterceptors(
    FileInterceptor('image_url', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: imageUrlFileFilter,
    }),
  )
  async update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.articlesService.updateArticleWithImage(id, body, file);
  }
}
