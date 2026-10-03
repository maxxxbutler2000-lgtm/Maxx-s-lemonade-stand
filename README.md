# Maxx’s Lemonade Stand

[Visit maxx.biz](https://maxx.biz/).

Lemonade at the DBE roundabout in Dorado Beach East, cookies, and golf balls. Cookie and golf ball delivery covers the Dorado Beach gated community wherever Maxx can reach by electric bike. Titleist Pro V1 and Pro V1x are sold together in bags at $4 per ball.

## Orders

The new form requires the customer's name, email, phone number, and quantities. Customers select **Place order** to send the details directly to **maxxxbutler2000@gmail.com** through Resend. The customer's email is the Reply-To address. Once Resend accepts the email, the website shows a thank-you screen: the request is being processed and a reply will follow soon. It does not collect payment or confirm availability automatically.

Twilio sends **Check your email!** to Maxx's configured alert phone, never to a customer. Secrets and the alert phone stay on the server. Failed text submissions retry in the background; they do not make a successfully emailed order look unsuccessful. After ten unsuccessful attempts, the Railway log marks the alert as needing attention. Twilio acceptance is not proof of carrier delivery.

## Connect before deploying

1. In Resend, verify the sending domain (for example `maxx.biz`) and create a sending API key. Configure `RESEND_API_KEY` and `ORDER_FROM_EMAIL` in Railway Variables.
2. In Twilio, configure an SMS-capable sender and the required messaging permissions/registration. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `ORDER_ALERT_PHONE`. Both phone variables need international format, for example `+1787...`. Do not put credentials in GitHub or chat. Twilio trial restrictions must be satisfied before sending to the recipient.
3. Attach a Railway volume at `/data`, and set `ORDER_DATA_DIR=/data`. This preserves submitted request IDs and queued text alerts across deployments. Use one service replica.
4. Set `SITE_ORIGINS=https://maxx.biz,https://www.maxx.biz` and deploy this branch using its Dockerfile. Remove any older static-file start/build overrides in Railway. Keep the existing custom domain pointing to this service's application port (`PORT`).
5. Submit a clearly labeled test request after configuration. Verify receipt in Gmail and on Maxx's phone, and test replying to the customer's email. A valid configuration alone does not verify domain authorization, SMS permissions, or final delivery.

Until setup is complete, the service refuses automatic orders and the form tells customers to email Maxx directly. Never deploy it as a working notification service before the real test succeeds. SMS service charges and registration may apply; no paid sender or subscription is provisioned by this code.

## Local development

Use Node 24. No npm dependencies or build step are required.

```sh
npm start
```

Open `http://localhost:8766`. For local submission tests, set `SITE_ORIGINS=http://localhost:8766` and provider variables privately, using your shell or `node --env-file=.env server.mjs`. `.env` and `.data/` are ignored by Git. Merely copying `.env.example` does not enable notifications.

```sh
npm test
```

Tests use mocked providers, temporary databases, and temporary localhost ports. They send no real emails or texts. Coverage includes required contact details, duplicate clicks, safe email retry, SMS retry after a restart, provider errors, origin checks, and private-file blocking.

## Request handling

Only public website assets are served; the database, environment files, tests, and server source are unavailable over HTTP. The server validates and limits input, checks the requesting origin, rejects the hidden spam field, bounds requests per minute, and caps new requests at 100 per day. These are basic protections, not a full bot-management service. Deploy behind the existing Cloudflare protection and monitor notification usage.

Requests receive a persistent identifier. Email retries use Resend's idempotency key; an uncertain request more than 23 hours old requires manual follow-up instead of risking a duplicate outside the provider's 24-hour key window. Successfully emailed and text-alerted records are removed from the website database after 30 days; email copies remain in the configured services. Failed records remain for troubleshooting. Keep the Railway volume private.

The private ChatGPT Sites draft is a separate project. This repository powers maxx.biz through Railway.
