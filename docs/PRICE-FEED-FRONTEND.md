# Price Feed en vivo (SSE) — Guía Frontend

Ya no necesitas hacer polling al catálogo cada X segundos. El backend te avisa
cuando cambia un precio, la visibilidad web o el tipo de cambio.

```
backend-hsgestion (ERP, Laravel)          ecommers-erp (NestJS)              Frontend
─────────────────────────────          ─────────────────────────          ──────────
Update precio / TC / habilitado_web
  └─ Job NotifyEcommercePriceChanged ──→ POST /api/internal/price-changed
                                           (secreto x-price-secret)
                                           └─ publish evento ──→ GET /api/stream/prices (SSE)
                                                                   └─ EventSource en el front
```

## 1. Endpoints (base = `APP_URL`, con prefijo `/api`)

| Método | URL | Auth | Para qué |
|---|---|---|---|
| GET | `/api/prices/version?companyId=1` | pública | Polling liviano (~100 bytes). Devuelve `{ fxRate, fxUpdatedAt, maxArticleUpdatedAt, hash }`. Solo pide el catálogo cuando `hash` cambia. |
| GET | `/api/stream/prices?companyId=1` | pública (SSE) | Push en vivo. Mantén **una sola** conexión por pestaña. |
| POST | `/api/internal/price-changed` | solo server-to-server (`x-price-secret`) | **No usar desde el front.** Solo lo llama `backend-hsgestion`. |

`companyId` = `company_type_id` del tenant. Si lo omites recibes todo (`all`).
El tipo de cambio es global: los eventos `fx` llegan como broadcast a todos.

## 2. Uso recomendado

**Paso 1 — al cargar:** pide `GET /api/prices/version?companyId=1` y guarda `hash`.

**Paso 2 — abre el stream una sola vez:**

```js
const es = new EventSource('/api/stream/prices?companyId=1');

es.addEventListener('price', (e) => {
  const evt = JSON.parse(e.data);
  // evt = { id, type:'price', companyId, articleIds, slugs, fxRate, version, occurredAt }
  refetchProducts(evt.slugs); // o parchea solo esos SKUs
});

es.addEventListener('fx', (e) => {
  const evt = JSON.parse(e.data);
  recalcWithRate(evt.fxRate); // el TC cambió para todo el catálogo
});

es.addEventListener('web-status', (e) => {
  const evt = JSON.parse(e.data);
  removeOrAdd(evt.articleIds); // habilitado_web / status cambió
});

es.addEventListener('sync', (e) => {
  // Llega justo al conectar si hubo cambios mientras estabas offline.
  const evt = JSON.parse(e.data);
  if (evt.version !== savedHash) refetchProducts();
});

es.addEventListener('heartbeat', () => {}); // ignorar, solo mantiene viva la conexión
es.onerror = () => { /* EventSource reintenta solo. Como respaldo, revalida con /prices/version */ };
```

**Paso 3 — fallback si se cae el stream:** cada 30s pide `GET /api/prices/version`
y compara `hash`. Si cambió y no llegó evento SSE, refresca.

Ejemplo React:

```jsx
useEffect(() => {
  const es = new EventSource(`${API}/api/stream/prices?companyId=${companyId}`);
  const onChange = (e) => {
    const evt = JSON.parse(e.data);
    queryClient.invalidateQueries({ queryKey: ['products', evt.companyId] });
  };
  es.addEventListener('price', onChange);
  es.addEventListener('fx', onChange);
  es.addEventListener('web-status', onChange);
  es.addEventListener('sync', onChange);
  return () => es.close(); // una conexión por pestaña, ciérrala al desmontar
}, [companyId]);
```

## 3. Contrato del evento

```json
{
  "id": 12,
  "type": "price | fx | web-status | sync",
  "companyId": "1",
  "articleIds": [101, 102],
  "slugs": ["laptop-hp-101"],
  "fxRate": 3.75,
  "version": "a1b2c3d4e5f60718",
  "occurredAt": "2026-09-16T15:30:00.000Z"
}
```

* `price`: cambió `public_price / precio_final / offer`. Recarga esos `slugs`.
* `fx`: cambió `parallel_rate`. Recalcula todo con `fxRate`.
* `web-status`: cambió `habilitado_web / status`. Ese `articleId` puede aparecer/desaparecer.
* `sync`: foto del último cambio al momento de conectar.
* `heartbeat`: cada 25s, ignóralo.

## 4. Reglas importantes

1.  **El precio del checkout nunca sale del SSE.** El SSE es solo para pintar la UI.
    `POST /api/orders` siempre recalcula contra DB. No envíes precios desde el front.
2.  **Una conexión por pestaña.** No abras un `EventSource` por componente o por producto.
3.  **No pongas el secreto en el front.** `x-price-secret` vive solo entre los dos backends
    (`ECOMMERCE_PRICE_SECRET` en ambos `.env` + `ECOMMERCE_URL` en hsgestion apuntando a ecommers-erp).
4.  **Reconexión:** `EventSource` reintenta solo con backoff. Si `onerror` se repite,
    cierra y revalida una vez con `/api/prices/version`.

## 5. Probar a mano

```bash
# Versión actual (pesa bytes, ideal para cron del front)
curl 'http://192.168.18.26:3000/api/prices/version?companyId=1'

# Stream (deja abierto, luego cambia un precio en el ERP y mira el evento)
curl -N 'http://192.168.18.26:3000/api/stream/prices?companyId=1'
```

## 6. Variables de entorno (backend, referencia)

* `ecommers-erp/.env`: `ECOMMERCE_PRICE_SECRET=<mismo-secreto>` (fallback a `REVALIDATE_SECRET`).
* `backend-hsgestion/.env`: `ECOMMERCE_URL=http://192.168.18.26:3000` y
  `ECOMMERCE_PRICE_SECRET=<mismo-secreto>`. Sin estas dos, el Job hace skip con warning
  y el front sigue funcionando con polling a `/prices/version`.
* Colas Laravel: el aviso viaja en queue (`database` por defecto). Asegura un worker
  `php artisan queue:work` para que salga. Si la cola se detiene, el SSE no recibe nada
  pero `/prices/version` sigue respondiendo.
