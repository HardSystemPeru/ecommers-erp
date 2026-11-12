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