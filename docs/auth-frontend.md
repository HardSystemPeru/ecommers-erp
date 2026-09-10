# Auth – Guía Frontend

**Base URL:** `http(s)://<host>/api` (`app.setGlobalPrefix('/api')` en `src/main.ts:29`).

**Swagger UI:** `GET /api/docs` → tag **auth** (si está habilitado).

**Todos los endpoints bajo `/api/auth/*`.** CORS con `credentials: true` (`src/main.ts:46-49`) — origins = `FRONTEND_URL`, `APP_URL`, `CSRF_ALLOWED_ORIGINS` (coma-separadas). **El frontend DEBE enviar `credentials: 'include'` (fetch) / `withCredentials: true` (axios)** para que las cookies `access_token` / `refresh_token` viajen. Sin esto, login parecerá exitoso pero el refresh/logout fallarán.

---

## Esquema de autenticación

| Concepto | Detalle (código fuente) |
|---|---|
| **AccessToken (JWT)** | Firmado con `JWT_SECRET`, `expiresIn: '8h'` (`src/auth/auth.module.ts:23`). Payload cliente: `{ sub: id(string), email, username, jti }` ; admin: `{ sub, username, role:'admin', jti }` (`src/auth/auth.service.ts:190-195,248-253`). **NUNCA viaja al frontend** — ni en body ni en header `Authorization`. Solo `Set-Cookie: access_token` `httpOnly` (`src/auth/auth.controller.ts:193`) y `JwtStrategy` lo lee exclusivamente de `cookies.access_token` (`src/auth/jwt.strategy.ts:16`). Respuesta del login/register es solo `{ success:true, user }`. El frontend **no almacena ni envía JWT**; solo usa `withCredentials:true`. |
| **RefreshToken** | `randomBytes(64).hex` hasheado `SHA256` y persistido en tabla `refresh_tokens` (`RefreshToken` en `prisma/schema.prisma:2893`, `@map("refresh_tokens")`). Expira en **7 días** (`src/auth/auth.service.ts:200-201,258-259,423-424`). Se setea como cookie `httpOnly` (ver tabla). No accesible desde JS. Rotación en cada `POST /api/auth/refresh`: el token viejo se marca `revoked=true, revokedReason='rotated', replacedById=<nuevo>` (`src/auth/auth.service.ts:438-446`). |
| **Cookies** | Ambas seteadas en `src/auth/auth.controller.ts:161-180` (`setAccessCookie` / `setRefreshCookie`) — **DEBUG asimétrico actual**: |
| | `access_token`: `httpOnly:true, secure: NODE_ENV==='production', sameSite:'strict', path:'/api', maxAge: 10*1000` (10 s) |
| | `refresh_token`: `httpOnly:true, secure: NODE_ENV==='production', sameSite:'lax', path:'/api', maxAge: 5*60*1000` (5 min) — _en prod cambiar a `15*60*1000` y `7*24*60*60*1000`_ |
| | `POST /api/auth/logout` limpia ambas con `response.clearCookie(..., { path:'/api', sameSite:'lax', httpOnly:true, secure })` (`src/auth/auth.controller.ts:113-125`). |
| **Revocación** | `POST /api/auth/logout` revoca `jti` en memoria hasta `exp` vía `TokenRevocationService` (`src/auth/revocation/revocation.service.ts`) y marca el refresh como `revoked, revokedReason='logout'` (`src/auth/auth.service.ts:384-391`). `JwtStrategy.validate` rechaza `jti` revocado (`src/auth/jwt.strategy.ts:23-25`) → `401 Sesión revocada`. |
| **Throttle** | `@Throttle` de `@nestjs/throttler` por IP. Responde `429 Too Many Requests` (`@Throttle` en cada handler de `src/auth/auth.controller.ts`). |
| **BruteForce** | Solo `POST /api/auth/login` y `POST /api/auth/login-admin` vía `BruteForceInterceptor` (`src/auth/brute-force/brute-force.interceptor.ts`). Bloquea por **IP** (`x-forwarded-for` o `req.ip`) y por **cuenta** (`body.email ?? body.username ?? body.document_number` lowercased). Tras 401 repetidos → `429` con header `Retry-After: <seg>` (`src/auth/brute-force/brute-force.interceptor.ts:52-62`). En login exitoso limpia contadores (`tap → recordSuccess`, `src/auth/brute-force/brute-force.interceptor.ts:66`). |

> **Backend-only:** JWT vive solo en el backend. `JwtStrategy` extrae únicamente de `cookies.access_token` (`src/auth/jwt.strategy.ts:16`). Ningún endpoint requiere `Authorization: Bearer`; solo `withCredentials:true`.

---

## Endpoints

### `POST /api/auth/register`
Throttle `5/min` por IP (`@Throttle({limit:5, ttl:60000})` en `src/auth/auth.controller.ts:37`).

**Body `RegisterDto` (`src/auth/dto/register.dto.ts`):**
```json
{
  "names": "Juan",                          // string, required, solo letras/espacios/'/-
  "lastnames": "Pérez García",              // string, required
  "email": "juan@example.com",              // email, required, max 255, se normaliza trim+lowercase
  "phone": "+51 999 888 777",               // optional, string
  "document_type": "DNI",                   // optional, string
  "document_number": "12345678",            // optional, string, /^\d{8,11}$/ si se envía
  "password": "S3cur3P@ss"                  // string, required, min 6, max 72 (bcrypt)
}
```
> `captchaToken` y validación `document_number` contra `EXTERNAL_API_URL` están **deshabilitados** (comentados en `src/auth/auth.service.ts:48-53` y sin campo en `RegisterDto`). No enviarlos.

**Respuestas:**
- `201` → `{ success: true, user: { id: string, username: string, email: string } }` + `Set-Cookie: access_token=...; Path=/api; HttpOnly` + `Set-Cookie: refresh_token=...; Path=/api; HttpOnly` (`src/auth/auth.controller.ts:42-52`). **El token NUNCA viaja en el body** — solo confirmación `success:true` + `user` mínimo.
- `400` validación DTO (`names` inválido, `document_number` no cumple regex, `password` <6)
- `409` `{ message: "El correo ya está registrado" }` (`src/auth/auth.service.ts:45,69`)
- `429` throttle

**Ejemplo:**
```ts
await axios.post('/api/auth/register', {
  names: 'Juan', lastnames: 'Pérez', email: 'juan@example.com', password: 'S3cur3P@ss'
}, { withCredentials: true });
// No hay token en body; solo { success:true, user } + cookies httpOnly. Usa /api/auth/profile para obtener datos.
```

---

### `POST /api/auth/login`
Throttle `5/min` + `BruteForceInterceptor` (`src/auth/auth.controller.ts:55-56`).

**Body `LoginDto` (`src/auth/dto/login.dto.ts`):**
```json
{ "email": "juan@example.com", "password": "S3cur3P@ss" }
```
> `captchaToken` deshabilitado (comentado en DTO y en `src/auth/auth.service.ts:79`). No enviarlo.

**Respuestas:**
- `201` → `{ success: true, user: { id, username, email } }` + cookies `access_token` + `refresh_token` (`src/auth/auth.controller.ts:62-73`). **Sin token en body.**
- `400` validación
- `401` `{ message: "Credenciales inválidas" }` (`src/auth/auth.service.ts:85,90`)
- `429` throttle o brute-force con header `Retry-After` (segundos)

```ts
const { data } = await axios.post('/api/auth/login', { email, password }, { withCredentials: true });
// data = { success:true, user:{id, username, email} } — token solo en cookies httpOnly
```

---

### `POST /api/auth/google`
Throttle `10/min` (`src/auth/auth.controller.ts:76`).

**Body `GoogleAuthDto` (`src/auth/dto/google-auth.dto.ts`):**
```json
{ "token": "eyJhbGciOiJSUzI1NiIs..." }  // Google ID Token (credential) de GIS
```
Verifica con `google-auth-library` (`audience=GOOGLE_CLIENT_ID`, `src/auth/auth.service.ts:100-102`). Si email no existe → auto-create vía `clientsService.createFromGoogle` (`src/auth/auth.service.ts:119-123`).

**Respuestas:** `201 { success:true, user }` + cookies, `401 Token de Google inválido`, `429`. **Token nunca en body.**

**Frontend (GIS):**
```ts
google.accounts.id.initialize({
  client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
  callback: async ({ credential }) => {
    await axios.post('/api/auth/google', { token: credential }, { withCredentials: true });
    await axios.get('/api/auth/profile', { withCredentials: true });
  }
});
google.accounts.id.renderButton(el, { theme: 'outline' });
```

---

### `POST /api/auth/login-admin`
Throttle `5/min` + `BruteForceInterceptor` (`src/auth/auth.controller.ts:139-140`).

**Body `LoginAdminDto` (`src/auth/dto/login-admin.dto.ts`):**
```json
{ "username": "admin@example.com", "password": "Admin123!" } // username = email OR names (OR en query, src/auth/auth.service.ts:227-230)
```
Verifica `bcrypt`, exige `role==='admin'` (`src/auth/auth.service.ts:242-244`), emite JWT con `role:'admin'` y cookies.

**Respuestas:** `201 { success:true, message: "Login correcto", user: { id, username, role:'admin' } }` + cookies (`src/auth/auth.controller.ts:146-159`), `401 Credenciales inválidas / No tienes permisos`, `429`. **Sin token en body.**

---

### `POST /api/auth/refresh` 🔒 — renueva sesión sin que el frontend toque JWT
Sin guard, sin throttle explícito (`src/auth/auth.controller.ts:141-155`). **Solo cookies `httpOnly`, JWT nunca viaja al front** (`src/auth/jwt.strategy.ts:16`). Lee `refresh_token` de `Cookie`.

**Request:** `POST /api/auth/refresh` con `withCredentials:true`, sin body, sin header `Authorization`. Requiere `Cookie: refresh_token=<hex>` (automático).

**Lógica backend (`src/auth/auth.service.ts:394-453`):**
1. `SHA256(refresh_token)` → busca en `refresh_tokens` (`prisma/schema.prisma:2893`), valida `!revoked && expiresAt > now` (en tabla 7d, en cookie DEBUG 5min).
2. Si no hay cookie → `401 { message:"No hay sesión activa" }` (`auth.controller.ts:145`). Si inválido/revocado/expirado → `401 Refresh token inválido o expirado` (`auth.service.ts:401`).
3. Genera nuevo `access_token` JWT `8h` (`auth.service.ts:413`) + nuevo `refresh_token` `randomBytes(64).hex` (`421`).
4. Persiste nuevo `RefreshToken` con `ip/userAgent/deviceName` (`ua-parser-js`, `auth.controller.ts:182-195`, `auth.service.ts:426`).
5. Marca el viejo como `revoked:true, revokedReason:'rotated', replacedById=<nuevo>, lastUsedAt=now` (`438-446`) — **un solo uso**, reintentar con el viejo → `401`.
6. Setea ambas cookies nuevas `httpOnly` (`auth.controller.ts:161-180`): `access_token 10s` / `refresh_token 5min` (DEBUG), en prod `15min / 7d`.

**Respuestas:**
- `201` → `{ success:true, user: { id, username, email } }` + `Set-Cookie: access_token=...; Max-Age=10` + `Set-Cookie: refresh_token=...; Max-Age=300` (rotado). **Sin token en body.**
- `401` `{ message:"No hay sesión activa" }` si no hay cookie, o `Refresh token inválido o expirado` si rotado/expirado/revocado.

**DEBUG asimétrico actual:** `access 10s` / `refresh 5min` → ventana de prueba real:
```ts
// t0: login
await api.post('/auth/login', {email, password}); // con withCredentials
// t+15s: access muerto, refresh vivo
await api.get('/auth/profile'); // → 401
await api.post('/auth/refresh', {}, {withCredentials:true}); // → 201 + nuevas cookies
await api.get('/auth/profile'); // → 200
// t+5min sin refresh: ambas muertas → refresh → 401 → login
```

**Frontend:** no almacena ni envía JWT. El interceptor solo hace `await api.post('/auth/refresh', {}, {withCredentials:true})` al recibir `401` y reintenta la petición original. Si el refresh falla → `location.href='/login'`. No usar `Authorization`.

---

### `POST /api/auth/logout` — cierra sesión solo con cookies (no requiere access vivo)
Sin `@UseGuards` (`src/auth/auth.controller.ts:70`). **Funciona aunque `access_token` esté expirado (10s DEBUG)** — decodifica con `ignoreExpiration:true` y revoca `jti` si existe (`auth.controller.ts:74-86`). Siempre revoca `refresh_token` de `Cookie` (`auth.service.ts:373`) y limpia ambas cookies `httpOnly`. Enviar con `withCredentials:true`, sin `Authorization`. Antes exigía `@UseGuards(AuthGuard('jwt'))` y devolvía `401` con access expirado, dejando el `refresh_token` vivo.

**Efecto (`src/auth/auth.controller.ts:70-100`):**
- Intenta decodificar `cookies.access_token` con `jwtService.verify(..., ignoreExpiration:true)` y revoca `jti` hasta `exp` aunque esté expirado (fix para access 10s).
- Si hay `refresh_token` cookie → `prisma.refreshToken.update({ revoked:true, revokedReason:'logout' })` (`src/auth/auth.service.ts:384-391`) — **siempre se revoca**, no depende del access.
- Limpia cookies: `clearCookie('access_token', { path:'/api', sameSite:'lax', httpOnly:true, secure })` y `clearCookie('refresh_token', ...)` (nota: `set` usa `sameSite:'strict'` para access pero `clear` usa `lax`).

**Respuestas:** `201 { success:true, message: "Sesión cerrada correctamente." }`, `401` si JWT inválido/revocado. **Sin token en body.**

```ts
await axios.post('/api/auth/logout', {}, { withCredentials: true });
clearAuth();
location.href = '/login';
```

---

### `GET /api/auth/profile` 🔒
`@UseGuards(AuthGuard('jwt'))` (`src/auth/auth.controller.ts:133`). **Autenticado solo por cookie `access_token` `httpOnly`** (`src/auth/jwt.strategy.ts:16`). No acepta `Authorization`. Enviar con `withCredentials:true`.

Retorna lo que `JwtStrategy.validate` devuelve (`src/auth/jwt.strategy.ts:34-56`):

Para cliente:
```json
{ "id": 1, "email": "juan@example.com", "name": "Juan Pérez", "role": "client", "jti": "...", "exp": 1234567890 }
```

Para admin:
```json
{ "id": "1", "username": "Admin", "role": "admin", "jti": "...", "exp": 1234567890 }
```

Usar como `GET /api/auth/me` para validar sesión y poblar store:
```ts
const { data } = await axios.get('/api/auth/profile', { withCredentials: true });
```

---

### `PATCH /api/auth/profile` 🔒
`@UseGuards(AuthGuard('jwt'))` (`src/auth/auth.controller.ts:121`) — solo cookie `access_token` `httpOnly` (`src/auth/jwt.strategy.ts:16`). No `Authorization`.

> **Seguridad — `GET /clientes/:id`**: `ClientsService.findOne/findById/findByEmail/findAll` ahora hacen `stripPassword` (`src/clients/clients.service.ts:6,54,103,170,126`). Antes retornaban `password` hasheado por `...data`. Ahora el hash nunca viaja al front.

**Body `UpdateClientDto` (`src/clients/dto/update-client.dto.ts`):** todo opcional: `names, lastnames, email, phone, document_type, document_number, password(min6)` (si `password` se envía, se hashea con bcrypt `src/auth/auth.service.ts:286-288`).

**Respuestas:** `200` cliente actualizado, `401` no autenticado.

---

### `POST /api/auth/forgot-password`
Throttle `3/min` (`src/auth/auth.controller.ts:169`), `@HttpCode(201)`.

**Body:** `{ "email": "juan@example.com" }` (extraído como `@Body('email')` en `src/auth/auth.controller.ts:171`).

**Lógica (`src/auth/auth.service.ts:293-348`):**
- Busca cliente por email lowercased. Si no existe → `400 El correo no está registrado` (no es silencioso — evita enumeración parcial pero revela existencia).
- Genera `reset_token` (`randomBytes(20).hex`, 1h) y guarda en `clients.reset_token/reset_token_expires`.
- Envía mail con Nodemailer (`SMTP_HOST/PORT/USER/PASS`, `SMTP_SECURE`, `src/auth/auth.service.ts:308-316`). Link: `${FRONTEND_URL}/reset-password?token=<token>` (`src/auth/auth.service.ts:319`). Fallo de envío → `400 Hubo un problema intentando enviar el correo...`.

**Respuestas:** `201 { message: "Se ha enviado un correo..." }` (ya no expone `token` en respuesta, a diferencia de versiones previas), `400`, `429`.

**Frontend:** formulario email → toast genérico "Si el correo existe, revisa tu bandeja" aunque el backend revele 400, mapea a mismo mensaje para no filtrar.

---

### `POST /api/auth/reset-password`
Throttle `5/min` (`src/auth/auth.controller.ts:175`), `@HttpCode(201)`.

**Body:** `{ "token": "abc123", "password": "N3wP@ss!" }` (`@Body('token')` y `@Body('password')` en `src/auth/auth.controller.ts:178-182`).

**Lógica (`src/auth/auth.service.ts:350-371`):**
- Busca `clients` con `reset_token=token` y `reset_token_expires > now`.
- Si no → `400 Token inválido o expirado`.
- Hashea `password` y limpia `reset_token/reset_token_expires`.

**Respuestas:** `201 { message: "Contraseña actualizada correctamente" }`, `400`, `429`.

**Frontend:** página `/reset-password?token=xxx` lee `searchParams.get('token')` y hace POST.

---

## Flujo recomendado frontend

### Configuración base
```ts
import axios from 'axios';

// Toda la auth vive en el backend. El frontend nunca toca JWT.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // ¡obligatorio! cookies httpOnly viajan solas
});
// No hay interceptor Authorization, no hay accessToken en memoria/localStorage.
```

### Login / Register / Google
```ts
// Respuestas: { success:true, user } + Set-Cookie httpOnly. Nada de JWT en JS.
await api.post('/auth/login', { email, password });
await api.post('/auth/register', { names, lastnames, email, password });
await api.post('/auth/google', { token: googleCredential });
await api.post('/auth/login-admin', { username, password });

// Verificación inmediata por cookie:
const { data: me } = await api.get('/auth/profile'); // solo withCredentials
```

### Refresh silencioso + logout en 401
```ts
let isRefreshing = false;
let queue: Array<() => void> = [];

api.interceptors.response.use(null, async err => {
  const original = err.config;

  // 429 BruteForce/Throttle
  if (err.response?.status === 429) {
    const retry = err.response.headers['retry-after'];
    toast.error(`Demasiados intentos. Reintente en ${retry ?? '?'}s`);
    throw err;
  }

  // 401 -> intenta refresh una vez (todo por cookies, sin JWT en JS)
  if (err.response?.status === 401 && !original._retry) {
    if (isRefreshing) {
      await new Promise<void>(res => queue.push(res));
      return api(original);
    }
    original._retry = true;
    isRefreshing = true;
    try {
      await api.post('/auth/refresh', {}); // rota cookies httpOnly
      queue.forEach(fn => fn()); queue = [];
      return api(original);
    } catch (refreshErr) {
      queue = [];
      location.href = '/login';
      throw refreshErr;
    } finally {
      isRefreshing = false;
    }
  }

  throw err;
});
```

### Logout
```ts
async function logout() {
  try {
    await api.post('/auth/logout', {}); // cookies httpOnly
  } finally {
    useAuthStore.getState().clear();
    location.href = '/login';
  }
}
```

### Perfil / Guard de rutas
```ts
async function fetchProfile() {
  const { data } = await api.get('/auth/profile'); // solo withCredentials:true
  return data;
}
```

> **Importante (DEBUG):** `access_token` expira en **10s** y `refresh_token` en **5min** (`src/auth/auth.controller.ts:166,176`). Ventana de prueba: espera 15s tras login (access muerto, refresh vivo) y haz `POST /api/auth/refresh` → debe rotar cookies. En prod cambiar a `15min / 7días`.

---

## Variables de entorno relevantes

`JWT_SECRET`, `GOOGLE_CLIENT_ID`, `RECAPTCHA_SECRET_KEY` (actualmente no usado), `EXTERNAL_API_URL`/`PUBLICTOKEN` o `PUBLIC_TOKEN` (validación DNI deshabilitada), `SMTP_HOST/PORT/SECURE/USER/PASS`, `FRONTEND_URL` (usada para link de reset), `APP_URL`, `CSRF_ALLOWED_ORIGINS` (coma-separada, se combina con `FRONTEND_URL`/`APP_URL` para CORS), `NODE_ENV` (controla `secure` en cookies).

---

## Swagger

Desarrollo: `http://localhost:3000/api/docs` → tag **auth**. Ya no hay `Authorize Bearer`; probar con `withCredentials` (las cookies `httpOnly` se setean solas tras login).

---

## Errores comunes

| Código | Causa | Acción frontend |
|---|---|---|
| `400` validación DTO | `names` con números, `document_number` no 8-11 dígitos, `password` <6, `email` inválido | Mostrar `error.response.data.message[0]` (ValidationPipe) |
| `400` `El correo no está registrado` | `forgot-password` con email inexistente | Mapear a toast genérico para no enumerar usuarios |
| `401` `Credenciales inválidas` | `login`/`login-admin` con password/email mal | Mensaje genérico, no distinguir si es email o password |
| `401` `Token de Google inválido` | `google` con credential expirado o `GOOGLE_CLIENT_ID` distinto | Re-inicializar GIS y pedir nuevo credential |
| `401` `Sesión revocada` / `Sesión inválida` / `Cliente no encontrado` | `logout` previo, `jti` blacklisted, o admin sin `role=admin` (`src/auth/jwt.strategy.ts:24,31,46`) | `clearAuth()` + redirect `/login` |
| `401` `Refresh token inválido o expirado` / `No hay sesión activa` | `refresh` sin cookie, token revocado/rotado o expirado (`src/auth/auth.service.ts:402`, `src/auth/auth.controller.ts:239`) | Forzar login |
| `401` `Token inválido o expirado` | `reset-password` con token vencido (>1h) o ya usado | Pedir nuevo `forgot-password` |
| `409` `El correo ya está registrado` | `register` con email duplicado (`P2002` Prisma) | Sugerir login / forgot-password |
| `429` + `Retry-After` | Throttle (`@Throttle`) o BruteForce (`BruteForceInterceptor`) | Deshabilitar botón + countdown con `retry-after` header |
| CORS sin cookies | Olvidaste `withCredentials:true` / `credentials:'include'` | Verifica `api.defaults.withCredentials` y que backend tenga `credentials:true` |

---

## Checklist frontend antes de prod

- [x] JWT solo en backend: `JwtStrategy` solo lee `cookies.access_token` (`src/auth/jwt.strategy.ts:16`), sin `Authorization`.
- [x] DEBUG asimétrico actual: `10s / 5min` (`src/auth/auth.controller.ts:161-180`) — verificado para probar refresh.
- [x] `GET /clientes/:id` ya no expone `password` hash (`src/clients/clients.service.ts:6,103,126`) — stripPassword.
- [x] `POST /auth/logout` sin guard, revoca `refresh_token` aunque `access_token` esté expirado (`src/auth/auth.controller.ts:70`).
- [ ] Prod: cambiar `maxAge` a `15*60*1000` (access) y `7*24*60*60*1000` (refresh) antes de deploy.
- [ ] Si `captchaToken` se reactiva, añadir campo en `RegisterDto`/`LoginDto` y `verifyCaptcha` en `AuthService`.
- [ ] Si `document_number` se valida contra SUNAT, reactivar `verifyDocumentNumber` y manejar `404`/`success=false`.
- [ ] Asegurar `FRONTEND_URL` sin trailing slash duplicado para link de reset (`${FRONTEND_URL}/reset-password`).
