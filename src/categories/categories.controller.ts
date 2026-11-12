import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UseFilters,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/guards/admin.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AllExceptionsFilter } from 'src/multer-exception.filter';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2mb
      },
      storage: diskStorage({
        destination: './storage/categories',
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
  create(
    @UploadedFile() file: Express.Multer.File,
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(createCategoryDto, file);
  }

  @Get()
  findAll(@Query('search') search?: string) {
    return this.categoriesService.findAll({ search });
  }

  @Get('pagination')
  findAllPagination(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.categoriesService.findAllPagination({ page, limit, search });
  }

  @Get('pagination-infinity')
  findAllPaginationInfinity(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.categoriesService.findAllPaginationInfinity({
      page,
      limit,
      search,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseFilters(AllExceptionsFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2mb
      },
      storage: diskStorage({
        destination: './storage/categories',
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
  update(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, updateCategoryDto, file);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  remove(@Param('id') id: string) {
    return this.categoriesService.remove(id);
  }

  @Get('filtrar-subcategories/:id')
  filterSubcategories(@Param('id') id: string) {
    return this.categoriesService.filterSubcategories(id);
  }
  z;
}
