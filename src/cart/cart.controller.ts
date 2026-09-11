import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CartService } from './cart.service';
import { GetClient } from '../auth/decorators/get-client.decorator';
import { CreateCartDto } from './dto/create-cart.dto';
import { UpdateCartDto } from './dto/update-cart.dto';

@Controller('cart')
@UseGuards(AuthGuard('jwt'))
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@GetClient() client: any) {
    return this.cartService.getCart(client.id);
  }

  @Post()
  addToCart(@GetClient() client: any, @Body() dto: CreateCartDto) {
    return this.cartService.addToCart(client.id, dto);
  }

  @Patch(':id')
  updateQuantity(
    @GetClient() client: any,
    @Param('id') id: string,
    @Body() dto: UpdateCartDto,
  ) {
    return this.cartService.updateQuantity(client.id, id, dto.quantity);
  }

  @Delete(':id')
  removeFromCart(@GetClient() client: any, @Param('id') id: string) {
    return this.cartService.removeFromCart(client.id, id);
  }
}
