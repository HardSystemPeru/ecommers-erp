import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Query,
  UseFilters,
} from '@nestjs/common';
import { HeroSliderService } from './hero-slider.service';
import { CreateHeroSliderDto } from './dto/create-hero-slider.dto';
import { UpdateHeroSliderDto } from './dto/update-hero-slider.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AllExceptionsFilter } from 'src/multer-exception.filter';

@Controller('hero-slider')
export class HeroSliderController {
  constructor(private readonly heroSliderService: HeroSliderService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), AdminGuard)
    @UseFilters(AllExceptionsFilter)
  @UseInterceptors(
    FileInterceptor('image', {
       limits: {
        fileSize: 2 * 1024 * 1024,
      },
      storage: diskStorage({
        destination: './storage/hero-slider',
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
    @Body() createHeroSliderDto: CreateHeroSliderDto,
  ) {
    return this.heroSliderService.create(createHeroSliderDto, file);
  }

  @Get()
  findAll( 
    @Query('name') search?: string,
    @Query('orden') orden?: string,
    @Query('category_id') category_id?: string,
    @Query('sub_category_id') sub_category_id?: string,
  ) {
    return this.heroSliderService.findAll({  search,orden, category_id, sub_category_id });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.heroSliderService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: diskStorage({
        destination: './storage/hero-slider',
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
    @Body() updateHeroSliderDto: UpdateHeroSliderDto,
  ) {
    return this.heroSliderService.update(id, updateHeroSliderDto, file);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), AdminGuard)
  remove(@Param('id') id: string) {
    return this.heroSliderService.remove(id);
  }
}
