import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from './server.mjs';

const config = {
  RESEND_API_KEY: 'test-only', ORDER_FROM_EMAIL: 'Maxx <orders@example.com>',
  TWILIO_ACCOUNT_SID: 'AC' + 'a'.repeat(32), TWILIO_AUTH_TOKEN: 'test-only',
  TWILIO_FROM_NUMBER: '+15005550006', ORDER_ALERT_PHONE: '+15005550009',
  SITE_ORIGINS: 'http://localhost'
};
const order = {customer: 'Test Customer', email: 'customer@example.com', phone: '+1 787 555 0100',
  items: ['Cookies', 'Titleist Pro V1 & Pro V1x bag'], specificBalls: '', details: '12 cookies and 4 golf balls', delivery: 'Test location, Saturday', website: ''};
const reply = (status, body) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
async function fixture(t, {env = config, provider, dir, now} = {}) {
  const dataDir = dir || await mkdtemp(join(tmpdir(), 'maxx-order-tests-'));
  const calls = [];
  const app = createApp({env, dataDir, now, log: () => {}, fetchImpl: async (url, options) => {
    calls.push({url, options});
    return provider ? provider(url, options, calls) : reply(200, url.includes('resend') ? {id:'email-test'} : {sid:'sms-test',status:'queued'});
  }});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    // Finish the asynchronous owner alert before closing its database.
    await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => app.server.close(resolve)); app.close();
    if (!dir) await rm(dataDir, {recursive:true,force:true});
  });
  return {app, calls, base, post: (input = order, id = randomUUID(), origin = 'http://localhost') => fetch(base + '/api/orders', {
    method:'POST', headers:{'Content-Type':'application/json', 'Idempotency-Key':id, Origin:origin}, body:JSON.stringify(input)
  })};
}

test('valid request sends every detail by email and only the reminder to the owner phone', async t => {
  const f = await fixture(t); const result = await f.post();
  assert.equal(result.status,201); assert.equal((await result.json()).accepted,true);
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(f.calls.length,2);
  const email = JSON.parse(f.calls[0].options.body);
  assert.deepEqual(email.to,['maxxxbutler2000@gmail.com']); assert.equal(email.reply_to,order.email);
  for (const value of [order.customer,order.phone,order.details,order.delivery]) assert.ok(email.text.includes(value));
  assert.ok(f.calls[0].options.headers['Idempotency-Key'].startsWith('order/'));
  const sms = new URLSearchParams(f.calls[1].options.body);
  assert.equal(sms.get('To'),config.ORDER_ALERT_PHONE); assert.equal(sms.get('Body'),'Check your email!');
  assert.ok(!f.calls[1].options.body.includes('customer'));
});
test('missing or invalid required phone and missing email cannot create an order', async t => {
  const f=await fixture(t);
  for (const input of [{...order,phone:''},{...order,phone:'hello 12345678'},{...order,email:''},{...order,items:[],specificBalls:''},{...order,items:['Lemonade']}]) {
    assert.equal((await f.post(input)).status,400);
  }
  assert.equal(f.calls.length,0);
});
test('customer retry or repeated clicks do not duplicate notifications', async t => {
  const f=await fixture(t); const id=randomUUID();
  const results = await Promise.all([f.post(order,id), f.post(order,id)]);
  assert.ok(results.every(r=>r.status===201||r.status===200));
  assert.equal((await f.post(order,id)).status,200);
  assert.equal((await f.post({...order,details:'Changed quantities'},id)).status,409);
  await new Promise(resolve=>setTimeout(resolve,20)); assert.equal(f.calls.length,2);
});
test('email failure shows an error and never sends the SMS; retry keeps the email idempotency key', async t => {
  let emailAttempts=0;
  const f=await fixture(t,{provider:(url)=>url.includes('resend')?reply(++emailAttempts===1?503:200,emailAttempts===1?{error:'unavailable'}:{id:'email-test'}):reply(201,{sid:'sms-test'})});
  const id=randomUUID(); const first=await f.post(order,id);
  assert.equal(first.status,503); assert.equal((await first.json()).accepted,undefined); assert.equal(f.calls.length,1);
  assert.equal((await f.post(order,id)).status,201);
  assert.equal(f.calls[0].options.headers['Idempotency-Key'],f.calls[1].options.headers['Idempotency-Key']);
});
test('SMS failure preserves successful order and retries the reminder without sending another email', async t => {
  let time=Date.now(); let smsAttempts=0;
  const f=await fixture(t,{now:()=>time,provider:(url)=>url.includes('resend')?reply(200,{id:'email-test'}):reply(++smsAttempts===1?503:201,smsAttempts===1?{error:'outage'}:{sid:'sms-test'})});
  assert.equal((await f.post()).status,201); await new Promise(resolve=>setTimeout(resolve,20));
  time+=120000; await f.app.retryAlerts();
  assert.equal(f.calls.filter(c=>c.url.includes('resend')).length,1); assert.equal(smsAttempts,2);
});
test('SMS retry survives restarting the server', async t => {
  const dir=await mkdtemp(join(tmpdir(),'maxx-restart-test-')); let time=Date.now();
  const first=createApp({env:config,dataDir:dir,now:()=>time,log:()=>{},fetchImpl:async url=>url.includes('resend')?reply(200,{id:'saved-email'}):reply(503,{error:'outage'})});
  await new Promise(resolve=>first.server.listen(0,'127.0.0.1',resolve));
  const res=await fetch(`http://127.0.0.1:${first.server.address().port}/api/orders`,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(order)});
  assert.equal(res.status,201); await new Promise(resolve=>setTimeout(resolve,20));
  await new Promise(resolve=>first.server.close(resolve)); first.close(); time+=120000;
  const calls=[]; const restarted=createApp({env:config,dataDir:dir,now:()=>time,fetchImpl:async url=>{calls.push(url);return reply(201,{sid:'retry-sms'});}});
  await restarted.retryAlerts(); assert.equal(calls.length,1); assert.ok(calls[0].includes('twilio'));
  restarted.close(); await rm(dir,{recursive:true,force:true});
});
test('unconfigured services, foreign origins, and honeypot submissions fail without sending',async t=>{
  const f=await fixture(t); assert.equal((await f.post(order,randomUUID(),'https://other.example')).status,403);
  assert.equal((await f.post({...order,website:'spam'})).status,400);
  for (const path of ['/.env','/server.mjs','/.data/orders.sqlite','/README.md']) assert.equal((await fetch(f.base+path)).status,404);
  const missing=await fixture(t,{env:{SITE_ORIGINS:'http://localhost'}});
  assert.equal((await missing.post()).status,503); assert.equal((await (await fetch(missing.base+'/api/order-status')).json()).available,false);
  assert.equal(f.calls.length+missing.calls.length,0);
});
