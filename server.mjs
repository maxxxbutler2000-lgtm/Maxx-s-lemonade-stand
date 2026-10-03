import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));
const ownerEmail = 'maxxxbutler2000@gmail.com';
const products = ['Cookies', 'Titleist Pro V1 & Pro V1x bag', 'Hitaways bundle', 'Unsorted golf ball bundle', 'Specific golf ball request'];
const phonePattern = /^\+[1-9]\d{7,14}$/;
const requiredConfig = ['RESEND_API_KEY', 'ORDER_FROM_EMAIL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'ORDER_ALERT_PHONE'];
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/script.js', ['script.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/lemonade-hero.jpg', ['assets/lemonade-hero.jpg', 'image/jpeg']]
]);

export function validateOrder(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Please complete the order form.');
  const text = (key, max, required = false) => {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('Please check your order details.');
    const value = input[key].trim();
    if (required && !value) throw new Error('Please add your name, email, phone number, and quantities.');
    return value;
  };
  const customer = text('customer', 100, true);
  const email = text('email', 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Please enter a valid email address.');
  const phone = text('phone', 40, true);
  const digits = phone.replace(/[^\d]/g, '');
  if (!/^[+\d ()\-.]+$/.test(phone) || digits.length < 8 || digits.length > 15) throw new Error('Please enter a valid phone number, including your area code.');
  const specificBalls = text('specificBalls', 500);
  const details = text('details', 2000, true);
  const delivery = text('delivery', 300);
  if (!Array.isArray(input.items) || input.items.length > products.length || input.items.some(item => !products.includes(item))) throw new Error('Please choose a listed product.');
  const items = [...new Set(input.items)];
  if (specificBalls && !items.includes('Specific golf ball request')) items.push('Specific golf ball request');
  if (!items.length) throw new Error('Please choose an item or specify the golf balls you want.');
  return { customer, email, phone, items, specificBalls, details, delivery };
}

function orderEmail(order, id) {
  return `New order request from maxx.biz\nReference: ${id}\n\nName: ${order.customer}\nEmail: ${order.email}\nPhone: ${order.phone}\n\nItems:\n${order.items.map(item => '- ' + item).join('\n')}\n\nSpecific golf balls:\n${order.specificBalls || 'Listed selections only'}\n\nQuantities and notes:\n${order.details}\n\nDelivery location and preferred time:\n${order.delivery || 'To be arranged'}\n\nThis is an order request. Confirm availability, price, and delivery with the customer.`;
}

export function createApp({ env = process.env, fetchImpl = fetch, dataDir, now = Date.now, log = console.error } = {}) {
  const dir = dataDir || env.ORDER_DATA_DIR || resolve(root, '.data');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dir, 'orders.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, hash TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL,
    email_id TEXT, sms_id TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt INTEGER NOT NULL DEFAULT 0, sms_failed INTEGER NOT NULL DEFAULT 0
  );`);
  const ready = () => requiredConfig.every(key => env[key]?.trim()) &&
    phonePattern.test(env.TWILIO_FROM_NUMBER || '') && phonePattern.test(env.ORDER_ALERT_PHONE || '') &&
    /^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') &&
    (env.NODE_ENV !== 'production' || !!env.ORDER_DATA_DIR);
  const origins = new Set((env.SITE_ORIGINS || 'https://maxx.biz,https://www.maxx.biz').split(',').map(s => s.trim()));
  const inFlight = new Map();
  const rate = new Map();
  const headers = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  };
  const json = (res, status, value) => {
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  async function sendEmail(order, id) {
    const result = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `order/${id}`
      }, body: JSON.stringify({ from: env.ORDER_FROM_EMAIL, to: [ownerEmail], reply_to: order.email,
        subject: `New order request — Maxx’s Lemonade [${id.slice(0, 8)}]`, text: orderEmail(order, id) })
    });
    const body = await result.json();
    if (!result.ok || !body.id) throw new Error('Email provider did not accept the order.');
    db.prepare('UPDATE orders SET email_id = ? WHERE id = ?').run(body.id, id);
  }
  const smsInFlight = new Set();
  async function sendAlert(id) {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!row?.email_id || row.sms_id || row.sms_failed || smsInFlight.has(id)) return;
    smsInFlight.add(id);
    try {
      const result = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST', signal: AbortSignal.timeout(10000), headers: {
          Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }, body: new URLSearchParams({ To: env.ORDER_ALERT_PHONE, From: env.TWILIO_FROM_NUMBER, Body: 'Check your email!' }).toString()
      });
      const body = await result.json();
      if (!result.ok || !body.sid || ['failed', 'undelivered'].includes(body.status)) throw new Error('SMS provider did not accept the alert.');
      db.prepare('UPDATE orders SET sms_id = ? WHERE id = ?').run(body.sid, id);
    } catch {
      const attempts = row.attempts + 1;
      db.prepare('UPDATE orders SET attempts = ?, next_attempt = ?, sms_failed = ? WHERE id = ?')
        .run(attempts, now() + Math.min(3600000, 30000 * 2 ** attempts), attempts >= 10 ? 1 : 0, id);
      log(`Order ${id}: SMS alert ${attempts >= 10 ? 'needs attention' : 'queued for retry'}.`);
    } finally { smsInFlight.delete(id); }
  }
  async function retryAlerts() {
    if (!ready()) return;
    const rows = db.prepare('SELECT id FROM orders WHERE email_id IS NOT NULL AND sms_id IS NULL AND sms_failed = 0 AND next_attempt <= ? LIMIT 10').all(now());
    for (const row of rows) await sendAlert(row.id);
    // Completed requests need no long-term copy on the website server.
    db.prepare('DELETE FROM orders WHERE sms_id IS NOT NULL AND created < ?').run(now() - 30 * 86400000);
  }
  async function submit(id, order) {
    const hash = createHash('sha256').update(JSON.stringify(order)).digest('hex');
    let row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (row && row.hash !== hash) return [409, { error: 'This request changed. Please refresh the page before placing a new order.' }];
    if (row?.email_id) { void sendAlert(id); return [200, { accepted: true, orderId: id }]; }
    if (row && now() - row.created >= 23 * 3600000) return [409, { error: 'Please email Maxx to check this earlier request before submitting again.' }];
    if (!row) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM orders WHERE created > ?').get(now() - 86400000).count;
      if (count >= 100) return [429, { error: 'Online ordering is busy. Please email Maxx directly.' }];
      db.prepare('INSERT INTO orders (id, hash, payload, created) VALUES (?, ?, ?, ?)').run(id, hash, JSON.stringify(order), now());
    }
    try { await sendEmail(order, id); }
    catch { log(`Order ${id}: email submission failed; customer can retry safely.`); return [503, { error: 'Your request could not be sent yet. Please try again or email Maxx directly.' }]; }
    // An SMS outage must not turn an emailed order into a failed customer submission.
    void sendAlert(id);
    return [201, { accepted: true, orderId: id }];
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/order-status') return json(res, 200, { available: ready() });
      if (req.method === 'POST' && path === '/api/orders') {
        if (!origins.has(req.headers.origin)) return json(res, 403, { error: 'Please place your order from maxx.biz.' });
        if (!ready()) return json(res, 503, { error: 'Online ordering is being connected. Please email Maxx directly for now.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Please use the order form.' });
        const id = req.headers['idempotency-key'];
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return json(res, 400, { error: 'Please refresh the page and try again.' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk.toString();
          if (Buffer.byteLength(raw) > 12000) return json(res, 413, { error: 'Your order details are too long.' });
        }
        let input, order;
        try { input = JSON.parse(raw); if (input.website) throw new Error('Please use the order form.'); order = validateOrder(input); }
        catch (error) { return json(res, 400, { error: error instanceof SyntaxError ? 'Please check your order details.' : error.message }); }
        // Bound attempts per client and storage/notification volume globally. X-Forwarded-For is not trusted.
        const ip = req.socket.remoteAddress;
        const previous = rate.get(ip);
        const bucket = previous && now() - previous.started < 60000 ? previous : null;
        if (bucket && now() - bucket.started < 60000 && bucket.count >= 15) return json(res, 429, { error: 'Please wait a minute before trying again.' });
        for (const [key, value] of rate) if (now() - value.started >= 60000) rate.delete(key);
        rate.set(ip, { started: bucket?.started || now(), count: (bucket?.count || 0) + 1 });
        const signature = JSON.stringify(order);
        if (inFlight.has(id) && inFlight.get(id).signature !== signature) return json(res, 409, { error: 'Please wait for your earlier request before changing the details.' });
        if (!inFlight.has(id)) inFlight.set(id, { signature, promise: submit(id, order).finally(() => inFlight.delete(id)) });
        const [code, body] = await inFlight.get(id).promise;
        return json(res, code, body);
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = staticFiles.get(path);
        if (file) {
          const bytes = await readFile(resolve(root, file[0]));
          res.writeHead(200, { ...headers, 'Content-Type': file[1], 'Cache-Control': file[1].startsWith('image/') ? 'public, max-age=86400' : 'no-cache' });
          return res.end(req.method === 'HEAD' ? undefined : bytes);
        }
      }
      json(res, 404, { error: 'Not found.' });
    } catch { if (!res.headersSent) json(res, 500, { error: 'Please try again in a moment.' }); else res.end(); }
  });
  return { server, retryAlerts, close: () => db.close() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.server.listen(Number(process.env.PORT || 8766), '0.0.0.0', () => console.log('Maxx’s Lemonade website is ready.'));
  const timer = setInterval(() => app.retryAlerts().catch(() => console.error('Alert retry needs attention.')), 30000);
  timer.unref();
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { clearInterval(timer); app.server.close(() => { app.close(); process.exit(0); }); });
}
