import { Module } from '@nestjs/common';
import { ArticlesService } from './articles.service';
import { ArticlesController } from './articles.controller';
import { ArticlesSaveController } from './articles-save.controller';

@Module({
  controllers: [ArticlesController, ArticlesSaveController],
  providers: [ArticlesService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
