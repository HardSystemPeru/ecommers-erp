import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FavoritesService } from './favorites.service';
import { GetClient } from '../auth/decorators/get-client.decorator';
import { ForbiddenException } from '@nestjs/common';

@Controller('favorites')
@UseGuards(AuthGuard('jwt'))
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  getFavorites(
    @GetClient() client: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.favoritesService.getFavorites(client.id, { page, limit });
  }

  @Get('usuario/:id')
  getFavoritesByUser(
    @Param('id') id: string,
    @GetClient() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (user.role !== 'admin' && String(user.id) !== String(id)) {
      throw new ForbiddenException(
        'No tienes permiso para ver los favoritos de otro usuario',
      );
    }
    return this.favoritesService.getFavorites(+id, { page, limit });
  }

  @Post(':articleId')
  addFavorite(
    @GetClient() client: any,
    @Param('articleId') articleId: string,
    @Query('type') type?: string,
  ) {
    return this.favoritesService.addFavorite(client.id, articleId, type);
  }

  @Delete(':articleId')
  removeFavorite(
    @GetClient() client: any,
    @Param('articleId') articleId: string,
    @Query('type') type?: string,
  ) {
    return this.favoritesService.removeFavorite(client.id, articleId, type);
  }

  @Get(':articleId')
  isFavorite(
    @GetClient() client: any,
    @Param('articleId') articleId: string,
    @Query('type') type?: string,
  ) {
    return this.favoritesService.isFavorite(client.id, articleId, type);
  }
}
