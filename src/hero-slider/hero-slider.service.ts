import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { CreateHeroSliderDto } from './dto/create-hero-slider.dto';
import { UpdateHeroSliderDto } from './dto/update-hero-slider.dto';

@Injectable()
export class HeroSliderService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private formatImageUrl(url: string | null): string | null {
    if (!url) return null;
    if (url.startsWith('http')) {
      return url.replace(
        /http:\/\/localhost:\d+/g,
        this.configService.get('APP_URL') || 'http://192.168.18.26:3000',
      );
    }
    const baseUrl =
      this.configService.get('APP_URL') || 'http://192.168.18.26:3000';
    return `${baseUrl}${url}`;
  }

  async create(createHeroSliderDto: CreateHeroSliderDto, file?: Express.Multer.File) {
    let imageUrl = '';
    if (file) {
      imageUrl = `/storage/hero-slider/${file.filename}`;
    }
    const lastSlide = await this.prisma.hero_slides.findFirst({
      orderBy: { orden: 'desc' },
      select: { orden: true, name:true },
    });

      const selectName:any[] =  await this.prisma.$queryRaw`
         SELECT name, orden FROM hero_slides WHERE name = ${createHeroSliderDto.name}
         ORDER BY orden ASC
 `;   
      
       const nextOrden = selectName ? selectName?.[selectName.length - 1]?.orden + 1 : 0;
     
      const slide = await this.prisma.hero_slides.create({
      data: {
        title: createHeroSliderDto.title,
        subtitle: createHeroSliderDto.subtitle,
        image: imageUrl,
        link: createHeroSliderDto.link || null,
        orden: createHeroSliderDto.order !== undefined ? Number(createHeroSliderDto.order) : (Number(nextOrden) || 0),
        active: createHeroSliderDto.active !== false,
        name: createHeroSliderDto.name || "",
        category_id: createHeroSliderDto.category_id ? BigInt(createHeroSliderDto.category_id) : null,
        sub_category_id: createHeroSliderDto.sub_category_id ? BigInt(createHeroSliderDto.sub_category_id) : null,
      },
    });

    return {
      ...slide,
      id: slide.id.toString(),
      category_id: slide.category_id?.toString() ?? null,
      sub_category_id: slide.sub_category_id?.toString() ?? null,
      image: this.formatImageUrl(slide.image),
    };
  }

async findAll(params: { search?: string, orden?: string, category_id?: string, sub_category_id?: string }) {
  const { search, orden, category_id, sub_category_id } = params;

  const where: any = {};

  if (search) {
    where.name = { contains: search };
  }

  if (orden) {
    where.orden = Number(orden);
  }

  if (category_id !== undefined) {
    where.category_id = category_id ? BigInt(category_id) : null;
  }
  if (sub_category_id !== undefined) {
    where.sub_category_id = sub_category_id ? BigInt(sub_category_id) : null;
  }

  // Se eliminó el filtro forzoso de category_id = null para que el listado
  // traiga todos los slides (incluidos los que tienen categoría), y el frontend
  // pueda filtrar por categoría si lo desea. Sin filtro, se devuelven todos.
  const slides = await this.prisma.hero_slides.findMany({
    where,
    orderBy: { orden: 'asc' },
    select: {
      id: true,
      name: true,
      image: true,
      subtitle: true,
      title: true,
      orden: true,
      active: true,
      link: true,
      category_id: true,
      sub_category_id: true,
    }
  });

  const formatted = slides.map((slide) => ({
    ...slide,
    id: slide.id.toString(),
    category_id: slide.category_id?.toString() ?? null,
    sub_category_id: slide.sub_category_id?.toString() ?? null,
    image: this.formatImageUrl(slide.image),
  }));

  if (search === 'carrusel') {
    return formatted;
  }

  if (search === 'side') {
    return formatted;
  }

  return formatted[0] ?? null;
}

  async findOne(id: string) {
    const slide = await this.prisma.hero_slides.findUnique({
      where: { id: BigInt(id) },
    });

    if (!slide) {
      throw new NotFoundException('Hero slider no encontrado');
    }

    return {
      ...slide,
      id: slide.id.toString(),
      category_id: (slide as any).category_id?.toString() ?? null,
      sub_category_id: (slide as any).sub_category_id?.toString() ?? null,
      image: this.formatImageUrl(slide.image),
    };
  }

  async update(id: string, updateHeroSliderDto: UpdateHeroSliderDto, file?: Express.Multer.File) {
    const slideId = BigInt(id);
    const existing = await this.prisma.hero_slides.findUnique({
      where: { id: slideId },
    });

    if (!existing) {
      throw new NotFoundException('Hero slider no encontrado');
    }

    let imageUrl = existing.image;
    if (file) {
      imageUrl = `/storage/hero-slider/${file.filename}`;
      if (existing.image) {
        const fs = require('fs');
        const path = require('path');
        const oldImagePath = path.join(process.cwd(), existing.image);
        if (fs.existsSync(oldImagePath)) {
          try {
            fs.unlinkSync(oldImagePath);
          } catch (error) {
            console.error('Error deleting old image:', error);
          }
        }
      }
    }

    const slide = await this.prisma.hero_slides.update({
      where: { id: slideId },
      data: {
        title: updateHeroSliderDto.title !== undefined ? updateHeroSliderDto.title : existing.title,
        subtitle: updateHeroSliderDto.subtitle !== undefined ? updateHeroSliderDto.subtitle : existing.subtitle,
        link: updateHeroSliderDto.link !== undefined ? updateHeroSliderDto.link : existing.link,
        orden: updateHeroSliderDto.order !== undefined ? Number(updateHeroSliderDto.order) : existing.orden,
        active: updateHeroSliderDto.active !== undefined ? updateHeroSliderDto.active : existing.active,
        name: updateHeroSliderDto.name !== undefined ? updateHeroSliderDto.name : existing.name,
        category_id: updateHeroSliderDto.category_id !== undefined ? (updateHeroSliderDto.category_id ? BigInt(updateHeroSliderDto.category_id) : null) : (existing as any).category_id,
        sub_category_id: updateHeroSliderDto.sub_category_id !== undefined ? (updateHeroSliderDto.sub_category_id ? BigInt(updateHeroSliderDto.sub_category_id) : null) : (existing as any).sub_category_id,
        image: imageUrl,
      },
    });

    return {
      ...slide,
      id: slide.id.toString(),
      category_id: (slide as any).category_id?.toString() ?? null,
      sub_category_id: (slide as any).sub_category_id?.toString() ?? null,
      image: this.formatImageUrl(slide.image),
    };
  }

  async remove(id: string) {
    const slideId = BigInt(id);
    
    // First find the slide to get the image path
    const slide = await this.prisma.hero_slides.findUnique({
      where: { id: slideId },
    });

    if (!slide) {
      throw new NotFoundException('Hero slider no encontrado');
    }

    // Delete from database
    await this.prisma.hero_slides.delete({
      where: { id: slideId },
    });

    // Delete image from disk if it exists
    if (slide.image) {
      const fs = require('fs');
      const path = require('path');
      const imagePath = path.join(process.cwd(), slide.image);
      if (fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch (error) {
          console.error('Error deleting image during removal:', error);
        }
      }
    }

    return {
      ...slide,
      id: slide.id.toString(),
    };
  }
}
