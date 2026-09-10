import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AppModule } from '../src/app.module';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { of } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/prisma/prisma.service';

(BigInt.prototype as any).toJSON = function () { return this.toString(); };

// Mock recaptcha: bypass para tokens de prueba
const MOCK_CAPTCHA_SUCCESS = { data: { success: true } };

async function bootstrap() {
  // Mock HttpService before module creation
  const mockHttpService = {
    post: () => of(MOCK_CAPTCHA_SUCCESS),
    axiosRef: {
      get: async () => ({ status: 200, data: { success: true, data: { document_number: '12345678' } } }),
      post: async () => MOCK_CAPTCHA_SUCCESS,
    },
  } as any;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(HttpService)
    .useValue(mockHttpService)
    .compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.use((cookieParser as any)());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: false }));
  app.setGlobalPrefix('/api');
  // Disable CSRF for test: we send Origin allowed, or no Origin => allowed
  await app.init();

  const server = app.getHttpServer();
  const results: string[] = [];
  const log = (msg: string) => { results.push(msg); console.log(msg); };

  const uniqueEmail = `test_auth_${Date.now()}@example.com`;
  const password = 'Test123!';
  let accessToken = '';
  let refreshCookie = '';

  // 1. Swagger docs existe (solo cuando se ejecuta dist/main.js, en Test no está montado)
  log('\n=== 1. Swagger docs ===');
  const docsRes = await request(server).get('/api/docs-json');
  if (docsRes.status === 404) {
    log(`GET /api/docs-json status=404 (esperado en Test, Swagger solo en main.ts) SKIP`);
  } else {
    const hasAuthTag = JSON.stringify(docsRes.body).includes('"auth"');
    log(`GET /api/docs-json status=${docsRes.status} hasAuthTag=${hasAuthTag} ${docsRes.status===200 && hasAuthTag ? 'PASS' : 'FAIL'}`);
  }

  // 2. Register sin captcha -> 400 Captcha requerido
  log('\n=== 2. Register sin captcha -> 400 ===');
  const noCaptcha = await request(server).post('/api/auth/register').send({
    names: 'Test', lastnames: 'User', email: uniqueEmail, password,
  });
  log(`status=${noCaptcha.status} body=${JSON.stringify(noCaptcha.body)} ${noCaptcha.status===400 ? 'PASS' : 'FAIL'}`);

  // 3. Register OK (con captchaToken mock)
  log('\n=== 3. Register OK ===');
  const regRes = await request(server).post('/api/auth/register').send({
    names: 'Test', lastnames: 'User', email: uniqueEmail, password, captchaToken: 'test-bypass', document_number: '', phone: '+51 999000001'
  });
  log(`status=${regRes.status} body=${JSON.stringify(regRes.body).slice(0,300)}`);
  if (regRes.status === 201 || regRes.status === 200) {
    accessToken = regRes.body.token;
    const cookies: string[] = (regRes.headers['set-cookie'] as any) || [];
    refreshCookie = (cookies as string[]).find((c:string)=>c.includes('refresh_token')) || '';
    log(`register token present=${!!accessToken} cookie present=${!!refreshCookie} ${accessToken && refreshCookie ? 'PASS' : 'FAIL'}`);
  } else {
    log('FAIL register');
  }

  // 4. Register duplicado -> 409
  log('\n=== 4. Register duplicado -> 409 ===');
  const dupRes = await request(server).post('/api/auth/register').send({
    names: 'Test', lastnames: 'User', email: uniqueEmail, password, captchaToken: 'test-bypass'
  });
  log(`status=${dupRes.status} ${dupRes.status===409 ? 'PASS' : 'FAIL'} body=${JSON.stringify(dupRes.body)}`);

  // 5. Login sin captcha -> 400
  log('\n=== 5. Login sin captcha -> 400 ===');
  const loginNoCaptcha = await request(server).post('/api/auth/login').send({ email: uniqueEmail, password });
  log(`status=${loginNoCaptcha.status} ${loginNoCaptcha.status===400 ? 'PASS' : 'FAIL'}`);

  // 6. Login OK
  log('\n=== 6. Login OK ===');
  const loginRes = await request(server).post('/api/auth/login').send({ email: uniqueEmail, password, captchaToken: 'test-bypass' });
  log(`status=${loginRes.status} body=${JSON.stringify(loginRes.body).slice(0,300)}`);
  if (loginRes.status===201 || loginRes.status===200) {
    accessToken = loginRes.body.token;
    const cookies: string[] = (loginRes.headers['set-cookie'] as any) || [];
    refreshCookie = (cookies as string[]).find((c:string)=>c.includes('refresh_token')) || (cookies as string[])[0] || refreshCookie;
    log(`login token=${!!accessToken} cookie=${!!refreshCookie} ${accessToken ? 'PASS' : 'FAIL'}`);
  }

  // 7. Login con password mala -> 401
  log('\n=== 7. Login credenciales inválidas -> 401 ===');
  const badPass = await request(server).post('/api/auth/login').send({ email: uniqueEmail, password: 'WrongPass123', captchaToken: 'test-bypass' });
  log(`status=${badPass.status} ${badPass.status===401 ? 'PASS' : 'FAIL'}`);

  // 8. GET /profile sin token -> 401
  log('\n=== 8. GET /profile sin token -> 401 ===');
  const noAuthProfile = await request(server).get('/api/auth/profile');
  log(`status=${noAuthProfile.status} ${noAuthProfile.status===401 ? 'PASS' : 'FAIL'}`);

  // 9. GET /profile con token -> 200
  log('\n=== 9. GET /profile con token -> 200 ===');
  const profileRes = await request(server).get('/api/auth/profile').set('Authorization', `Bearer ${accessToken}`);
  log(`status=${profileRes.status} body=${JSON.stringify(profileRes.body)} ${profileRes.status===200 ? 'PASS' : 'FAIL'}`);

  // 10. PATCH /profile
  log('\n=== 10. PATCH /profile -> 200 ===');
  const patchRes = await request(server).patch('/api/auth/profile').set('Authorization', `Bearer ${accessToken}`).send({ phone: '+51 999000002' });
  log(`status=${patchRes.status} body=${JSON.stringify(patchRes.body).slice(0,300)} ${patchRes.status===200 ? 'PASS' : 'FAIL'}`);

  // 11. Google login inválido -> 401
  log('\n=== 11. Google login inválido -> 401 ===');
  const googleRes = await request(server).post('/api/auth/google').send({ token: 'invalid-google-token' });
  log(`status=${googleRes.status} ${googleRes.status===401 ? 'PASS' : 'FAIL'} body=${JSON.stringify(googleRes.body)}`);

  // 12. Login-admin inválido -> 401
  log('\n=== 12. Login-admin inválido -> 401 ===');
  const adminBad = await request(server).post('/api/auth/login-admin').send({ username: 'admin@gmail.com', password: 'wrongpass' });
  log(`status=${adminBad.status} ${adminBad.status===401 ? 'PASS' : 'FAIL'}`);

  // 12b. Login-admin OK (reseteamos password temporal)
  log('\n=== 12b. Login-admin OK (reset temp password) ===');
  const prisma = app.get(PrismaService);
  let adminLoginOk = false;
  let originalHash = '';
  try {
    const adminBefore = await prisma.clients.findUnique({ where: { email: 'admin@gmail.com' } });
    originalHash = adminBefore?.password || '';
    const hashed = await bcrypt.hash('AdminTest123!', 10);
    await prisma.clients.update({ where: { email: 'admin@gmail.com' }, data: { password: hashed } });
    const adminRes = await request(server).post('/api/auth/login-admin').send({ username: 'admin@gmail.com', password: 'AdminTest123!' });
    log(`status=${adminRes.status} body=${JSON.stringify(adminRes.body).slice(0,300)} ${adminRes.status===201||adminRes.status===200 ? 'PASS' : 'FAIL'}`);
    adminLoginOk = adminRes.status===201||adminRes.status===200;
    // restaurar hash original
    if (originalHash) await prisma.clients.update({ where: { email: 'admin@gmail.com' }, data: { password: originalHash } });
    log(`admin password restaurado`);
  } catch (e:any) { log(`admin setup error ${e.message} FAIL`); try { if(originalHash) await prisma.clients.update({ where:{email:'admin@gmail.com'}, data:{password: originalHash}});} catch {} }

  // 13. Forgot-password con email inexistente -> 400
  log('\n=== 13. forgot-password inexistente -> 400 ===');
  const forgotBad = await request(server).post('/api/auth/forgot-password').send({ email: 'noexiste_12345@example.com' });
  log(`status=${forgotBad.status} ${forgotBad.status===400 ? 'PASS' : 'FAIL'} body=${JSON.stringify(forgotBad.body)}`);

  // 14. Forgot-password OK
  log('\n=== 14. forgot-password OK ===');
  const forgotOk = await request(server).post('/api/auth/forgot-password').send({ email: uniqueEmail });
  log(`status=${forgotOk.status} body=${JSON.stringify(forgotOk.body).slice(0,500)} ${forgotOk.status===201||forgotOk.status===200 ? 'PASS' : 'FAIL'}`);
  let resetToken = forgotOk.body?.token || '';
  if (!resetToken) {
    // fallback: leer de DB
    const client = await prisma.clients.findUnique({ where: { email: uniqueEmail } });
    resetToken = client?.reset_token || '';
    log(`token fallback from DB=${resetToken ? 'found' : 'not found'}`);
  }

  // 15. Reset-password con token inválido -> 400
  log('\n=== 15. reset-password token inválido -> 400 ===');
  const resetBad = await request(server).post('/api/auth/reset-password').send({ token: 'invalidtoken123', password: 'NewPass123!' });
  log(`status=${resetBad.status} ${resetBad.status===400 ? 'PASS' : 'FAIL'}`);

  // 16. Reset-password OK
  log('\n=== 16. reset-password OK ===');
  const newPass = 'NewPass123!';
  const resetOk = await request(server).post('/api/auth/reset-password').send({ token: resetToken, password: newPass });
  log(`status=${resetOk.status} body=${JSON.stringify(resetOk.body)} ${resetOk.status===201||resetOk.status===200 ? 'PASS' : 'FAIL'}`);

  // 17. Login con nueva contraseña
  log('\n=== 17. Login con nueva contraseña -> 200 ===');
  const loginNew = await request(server).post('/api/auth/login').send({ email: uniqueEmail, password: newPass, captchaToken: 'test-bypass' });
  log(`status=${loginNew.status} ${loginNew.status===201||loginNew.status===200 ? 'PASS' : 'FAIL'}`);
  if (loginNew.body?.token) accessToken = loginNew.body.token;

  // 18. Logout
  log('\n=== 18. Logout -> 201 + revoke ===');
  // extraer refresh_token valor para enviar como cookie
  let cookieHeader = '';
  if (refreshCookie) {
    const match = refreshCookie.match(/refresh_token=([^;]+)/);
    if (match) cookieHeader = `refresh_token=${match[1]}`;
  } else if ((loginNew.headers as any)['set-cookie']) {
    const c = ((loginNew.headers as any)['set-cookie'] as string[]).find(s=>s.includes('refresh_token'));
    if (c) { const m=c.match(/refresh_token=([^;]+)/); if(m) cookieHeader=`refresh_token=${m[1]}`; }
  }
  const logoutRes = await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`).set('Cookie', cookieHeader);
  log(`status=${logoutRes.status} body=${JSON.stringify(logoutRes.body)} ${logoutRes.status===201||logoutRes.status===200 ? 'PASS' : 'FAIL'}`);
  const cleared = (((logoutRes.headers as any)['set-cookie']||[]) as string[]).join(';');
  log(`cookie cleared=${cleared.includes('refresh_token=;') || cleared.includes('Expires=Thu, 01 Jan 1970')} check`);

  // 19. Profile tras logout -> 401 (revocado)
  log('\n=== 19. Profile tras logout -> 401 revocado ===');
  const profileAfter = await request(server).get('/api/auth/profile').set('Authorization', `Bearer ${accessToken}`);
  log(`status=${profileAfter.status} ${profileAfter.status===401 ? 'PASS (revocado)' : 'FAIL (esperaba 401, token no revocado?)' } body=${JSON.stringify(profileAfter.body)}`);

  log('\n=== RESUMEN ===');
  log(`Docs, register, login, profile, google, admin, forgot/reset, logout probados. Revisar PASS/FAIL arriba.`);
  log(`Nota: no se hizo git push (solo pruebas locales).`);

  await app.close();
  process.exit(0);
}

bootstrap().catch(e=>{ console.error(e); process.exit(1); });
