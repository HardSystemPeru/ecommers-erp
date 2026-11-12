import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { SubCategoriesService } from './sub-categories.service';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { AdminGuard } from 'src/auth/guards/admin.guard';
import { extname } from 'path';
import { CreateArticleImageDto } from 'src/article_images/dto/create-article_image.dto';
import { SubCategoriesDto } from './dto/sub-categories.dto';
import { AllExceptionsFilter } from 'src/multer-exception.filter';

@Controller('sub-categories')
export class SubCategoriesController {
  constructor(private readonly subCategoriesService: SubCategoriesService) {}

  @Get()
  findAll(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.subCategoriesService.findAll({ categoryId, search });
  }

  @Get('pagination-infinity')
  findAllPaginationInfinity(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.subCategoriesService.findAllPaginationInfinity({
      page,
      limit,
      categoryId,
      search,
    });
  }

  @Get('pagination')
  findAllPagination(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.subCategoriesService.findAllPagination({
      page,
      limit,
      categoryId,
      search,
    });
  }
  //subir imagenes a subcategoria existentes
  @Patch('upload-image/:id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseFilters(AllExceptionsFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 2 * 1024 * 1024, // 5mb
      },
      storage: diskStorage({
        destination: './storage/sub-categories',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');

          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.subCategoriesService.uploadImage(id, file);
  }
}
