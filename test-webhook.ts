import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrdersService } from './src/orders/orders.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const ordersService = app.get(OrdersService);

  try {
    console.log('Creando orden de prueba...');
    const result = await ordersService.create({
      client_id: 1,
      document_type_id: 3,
      terms: true,
      items: [{ article_id: 8327, quantity: 1 }],
    }, 1, true);

    console.log('=== ORDEN CREADA ===');
    console.log('ID:', Number(result.orders.id));
    console.log('TOTAL:', result.orders.total);
    console.log('El webhook debería haberse disparado.');
  } catch (error) {
    console.error('Error:', error.message);
  }

  await app.close();
  process.exit(0);
}

bootstrap();
