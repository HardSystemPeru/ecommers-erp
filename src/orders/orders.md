# Módulo Orders - Lógica de Surcharge (Sobreprecio por Tarjeta)

Cuando se crea una orden, el recargo (surcharge) se aplica según el `surcharge_percent` configurado en el método de pago de la tabla `payment_methods`.

## ¿Cómo funciona?

1. **Método de pago en la petición:**
   - El `payment_method_id` se define en el cuerpo de la orden.
   - El servicio consulta la tabla `payment_methods` para obtener el `surcharge_percent` configurado.

2. **Cálculo del subtotal por artículo:**
   - Se toma el `unit_price` original del artículo.
   - Si el método de pago tiene `surcharge_percent > 0`, se calcula: `subtotal = unit_price + (unit_price × surcharge_percent/100)`
   - Si `surcharge_percent` es 0, no se aplica ningún recargo; el precio final es el precio original.

3. **Ejemplo práctico:**
   - Si el método de pago tiene `surcharge_percent: 4` (tarjeta), el 4% se aplica a todos los artículos.
   - Si el método de pago tiene `surcharge_percent: 0` (efectivo u otro), no hay sobreprecio.

## Flujo en el código

1. Al crear la orden (`POST /api/orders`), el servicio:
   - Consulta `payment_methods` por el `payment_method_id` recibido
   - Obtiene el `surcharge_percent` configurado (puede ser 0, 4, o cualquier valor definido en la base de datos)
   - Aplica ese porcentaje a todos los items de la orden de manera uniforme

2. **Este valor es único para la orden:** No se calcula por item, sino que se aplica el mismo porcentaje a todos los items del pedido, tal como está configurado en el método de pago.

3. El `surcharge_percent` se almacena en la base de datos en la tabla `payment_methods` y ahora está debidamente considerado en la lógica del servicio.

## Nota importante

- El recargo aplica el porcentaje que tenga configurado cada método de pago en la base de datos.
- Si el método de pago tiene `surcharge_percent: 0` (ej. efectivo), no habrá sobreprecio para ningún item.
- Si el método de pago tiene `surcharge_percent: 4` (tarjeta), se aplicará el 4% a todos los items.
- Los precios del catálogo están en Soles (S/).
- El valor es configurable en la tabla `payment_methods`, permitiendo definir diferentes porcentajes por método de pago.

# Módulo Orders - Detalle de `order_items`

Cada orden creada guarda sus productos en la tabla `order_items`. Además del precio y el subtotal, cada item conserva el tipo de cambio usado al momento de la venta.

## Campos principales

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `id` | BigInt | Identificador del item. |
| `order_id` | BigInt | Orden a la que pertenece. |
| `article_id` | BigInt | Artículo vendido. |
| `quantity` | Int | Cantidad vendida. |
| `unit_price` | Decimal | Precio unitario del artículo en su moneda original (con recargo si aplica). |
| `subtotal` | Decimal | `unit_price × quantity` en la moneda original del artículo. |
| `tipo_cambio` | Decimal | Tipo de cambio (soles por dólar) usado al crear la orden. |
| `created_at` | DateTime | Fecha de creación del item. |

## Registro al crear la orden

En `POST /api/orders`:

1. Se obtiene el tipo de cambio actual desde `exchange_rates` (`parallel_rate`).
2. Ese valor se guarda en `orders.tipo_cambio` y también en cada `order_items.tipo_cambio`.
3. El `unit_price` se toma de `articles.public_price` y se le aplica el `surcharge_percent` del método de pago si corresponde.
4. El `subtotal` se calcula como `unit_price × quantity`.

## Respuesta al listar y ver el detalle

Al listar órdenes (`findAll`), cada item incluye:

| Campo | Descripción |
| --- | --- |
| `tipo_cambio` | Tipo de cambio del item. Si es `0` o no existe, se usa el de la orden; si tampoco existe, el tipo de cambio actual. |
| `unit_price` | Precio unitario expresado en soles. |
| `unit_price_soles` | Precio unitario en soles. |
| `unit_price_dolares` | Precio unitario en dólares. |
| `subtotal` | Subtotal expresado en soles. |
| `subtotal_soles` | Subtotal en soles. |
| `subtotal_dolares` | Subtotal en dólares. |

## Fórmulas de conversión

- Artículo en soles (`currency_type_id = 1`):
  - `soles = monto`
  - `dolares = monto / tipo_cambio`
- Artículo en dólares (`currency_type_id = 2`):
  - `soles = monto × tipo_cambio`
  - `dolares = monto`

Ejemplo: artículo de `US$ 100`, tipo de cambio `3.80`:

```json
{
  "tipo_cambio": 3.8,
  "unit_price": 380,
  "unit_price_soles": 380,
  "unit_price_dolares": 100,
  "subtotal": 760,
  "subtotal_soles": 760,
  "subtotal_dolares": 200
}
```

> Nota: los totales de la orden se calculan sumando los `subtotal_soles` de sus items.