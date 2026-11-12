export class Order {
  id: bigint;

  client_id: bigint;

  total: number;

  status: string;

  payment_method_id: bigint;

  shipping_address?: string;

  notes?: string;

  created_at: Date;

  updated_at?: Date;
}
