# Módulo Payment Method

Módulo NestJS para gestionar los métodos de pago (`payment_methods` en Prisma).

- **Controlador:** `payment-method.controller.ts`
- **Servicio:** `payment-method.service.ts`
- **Ruta base:** `/api/payment-method` (el prefijo `/api` es global, ver `src/main.ts`)
- **Puerto local:** `3009` (`PORT` en `.env`)

Base URL local:

```
http://localhost:3009/api/payment-method
```

## Modelo `payment_methods`

| Campo          | Tipo       | Descripción                                  |
| -------------- | ---------- | -------------------------------------------- |
| `id`           | BigInt     | Identificador (se devuelve como string)      |
| `description`  | String(40) | Nombre del método de pago                    |
| `status`       | Int        | `1` activo, `0` inactivo (default `1`)       |
| `st_visible`   | Boolean    | Visible en el frontend (default `true`)      |
| `abbreviation` | String(5)  | Abreviatura opcional                         |
| `st_voucher`   | Boolean    | Requiere voucher/comprobante (default `false`)|
| `created_at`   | DateTime   | Fecha de creación                            |
| `updated_at`   | DateTime   | Fecha de actualización                       |

## Rutas

| Método   | Ruta                     | Estado        | Descripción                       |
| -------- | ------------------------ | ------------- | --------------------------------- |
| `GET`    | `/api/payment-method`         | Implementado  | Lista todos los métodos de pago   |
| `GET`    | `/api/payment-method/:id`     | Implementado  | Obtiene un método de pago por ID  |
| `POST`   | `/api/payment-method`         | Pendiente     | Crea un método de pago            |
| `PATCH`  | `/api/payment-method/:id`     | Pendiente     | Actualiza un método de pago       |
| `DELETE` | `/api/payment-method/:id`     | Pendiente     | Elimina un método de pago         |

> Las rutas `POST`, `PATCH` y `DELETE` existen en el controlador, pero el servicio aún devuelve respuestas de ejemplo (scaffold). Solo `GET` está conectado a Prisma.

## GET `/api/payment-method`

Devuelve todos los métodos de pago ordenados por `description` ascendente.

**Ejemplo de respuesta `200`:**

```json
[
  {
    "id": "1",
    "description": "Efectivo",
    "status": 1,
    "st_visible": true,
    "abbreviation": "EFE",
    "created_at": "2025-01-15T10:00:00.000Z",
    "updated_at": null,
    "st_voucher": false
  },
  {
    "id": "2",
    "description": "Tarjeta",
    "status": 1,
    "st_visible": true,
    "abbreviation": "TAR",
    "created_at": "2025-01-15T10:00:00.000Z",
    "updated_at": null,
    "st_voucher": true
  }
]
```

## GET `/api/payment-method/:id`

Busca un método de pago por su `id` (BigInt). El `id` se convierte con `BigInt(id)`.

**Ejemplo:**

```
GET /api/payment-method/1
```

**Respuesta `200`:**

```json
{
  "id": "1",
  "description": "Efectivo",
  "status": 1,
  "st_visible": true,
  "abbreviation": "EFE",
  "created_at": "2025-01-15T10:00:00.000Z",
  "updated_at": null,
  "st_voucher": false
}
```

**Respuesta `404`** si no existe:

```json
{
  "statusCode": 404,
  "message": "Método de pago no encontrado"
}
```

**Respuesta `500`** si el `id` no es un número válido (falla `BigInt(id)`).

## Notas

- El `id` se serializa como string para evitar problemas con `BigInt` en JSON. Además `main.ts` define `BigInt.prototype.toJSON`, pero se mantiene el `toString()` explícito en el servicio.
- No hay guards de autenticación en este controlador; actualmente es público.
- Las rutas `PATCH` y `DELETE` reciben `id` como string pero el servicio aún usa `+id` (número). Deben actualizarse a `BigInt` cuando se implementen.
