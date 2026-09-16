import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ArticlesModule } from './articles/articles.module';
import { PrismaModule } from './prisma/prisma.module';
import { ClientsModule } from './clients/clients.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { BrandsModule } from './brands/brands.module';
import { SubCategoriesModule } from './sub-categories/sub-categories.module';
import { FavoritesModule } from './favorites/favorites.module';
import { CartModule } from './cart/cart.module';
import { ArticleImageModule } from './article_images/article_image.module';
import { ReviewsModule } from './reviews/reviews.module';
import { OrdersModule } from './orders/orders.module';
import { HeroSliderModule } from './hero-slider/hero-slider.module';
import { ChatbootModule } from './chatboot/chatboot.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ConsultaModule } from './consulta/consulta.module';
import { ComplaintsModule } from './libro-reclamos/libro-reclamos.module';
import { TermsModule } from './terms/terms.module';
import { WatermarkModule } from './common/watermark/watermark.module';
import { PriceFeedModule } from './price-feed/price-feed.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './auth/csrf/csrf.guard';



@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    ClientsModule,
    ArticlesModule,
    AuthModule,
    CategoriesModule,
    BrandsModule,
    SubCategoriesModule,
    FavoritesModule,
    CartModule,
    ArticleImageModule,
    ReviewsModule,
    OrdersModule,
    HeroSliderModule,
    ChatbootModule,
    NotificationsModule,
    ConsultaModule,
    ComplaintsModule,
    TermsModule,
    WatermarkModule,
    PriceFeedModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
