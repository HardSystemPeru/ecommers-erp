import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';

@Injectable()
export class PaymentMethodService {
  constructor(private prisma: PrismaService) {}

  create(createPaymentMethodDto: CreatePaymentMethodDto) {
    return 'This action adds a new paymentMethod';
  }

  async findAll() {
    const paymentMethods = await this.prisma.payment_methods.findMany({
      orderBy: { description: 'asc' },
    });

    return paymentMethods.map((paymentMethod) => ({
      ...paymentMethod,
      id: paymentMethod.id.toString(),
    }));
  }

  async findOne(id: string) {
    const paymentMethod = await this.prisma.payment_methods.findUnique({
      where: { id: BigInt(id) },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Método de pago no encontrado');
    }

    return {
      ...paymentMethod,
      id: paymentMethod.id.toString(),
    };
  }

  update(id: number, updatePaymentMethodDto: UpdatePaymentMethodDto) {
    return `This action updates a #${id} paymentMethod`;
  }

  remove(id: number) {
    return `This action removes a #${id} paymentMethod`;
  }
}
