# Shopify Orders/Paid Proforma Invoice Webhook MVP

This project is a standalone Node.js + Express webhook service. It verifies Shopify webhook HMAC signatures, extracts paid order data, generates a test proforma invoice HTML email, sends it with Resend, and stores idempotency logs in a JSON file.

## Environment Variables

Copy `.env.example` to `.env` and update these values:

```bash
PORT=3000
SHOPIFY_API_SECRET=your_shopify_app_client_secret
RESEND_API_KEY=re_your_resend_key
INVOICE_FROM_EMAIL="Invoices <invoices@yourdomain.com>"
INVOICE_REPLY_TO_EMAIL="support@yourdomain.com"
SEND_INVOICE_TO_TEST_EMAIL="your-test-inbox@example.com"
INVOICE_EMAIL_LOG_PATH=data/invoice-email-logs.json
MAX_INVOICE_EMAIL_RETRY_ATTEMPTS=3
```

`SEND_INVOICE_TO_TEST_EMAIL` is optional. Keep it set during testing so all invoice emails go to one safe inbox. Remove it in production to send to the real Shopify customer email.

## Shopify Webhook Configuration

`shopify.app.toml` includes:

```toml
[access_scopes]
scopes = "read_orders"

[webhooks]
api_version = "2026-04"

[[webhooks.subscriptions]]
topics = ["orders/paid"]
uri = "/webhooks/orders-paid"
```

It also includes basic `app/uninstalled` and compliance webhook endpoints. Replace `client_id`, `application_url`, and redirect URLs before deploying with Shopify CLI.

## Local Setup

Install dependencies:

```bash
npm install
```

Start the webhook server:

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## Local Tests

Generate mock invoice HTML and PDF:

```bash
npm run test:invoice-html
```

The previews are written to:

```text
tmp/mock-proforma-invoice.html
tmp/mock-proforma-invoice.pdf
```

The generated PDF is two pages:

```text
Page 1: English proforma invoice using Polymath Display
Page 2: Chinese proforma invoice using Source Han Sans CN
```

Test idempotency without sending real email:

```bash
npm run test:idempotency
```

Test missing customer email handling:

```bash
npm run test:no-email
```

Run all local verification checks:

```bash
npm run verify
```

Send a signed mock webhook to the local server:

```bash
npm run dev
npm run test:mock-webhook
```

Run `npm run test:mock-webhook` twice with the same `MOCK_WEBHOOK_ID` to confirm it does not resend after the first successful send. If Resend credentials are missing, the handler records `failed` and still returns `200`.

## Shopify CLI Testing

Expose the local service with Shopify CLI, Cloudflare Tunnel, ngrok, or another HTTPS tunnel, then point `application_url` and the webhook URI to that public URL.

Trigger a paid order webhook:

```bash
shopify app dev
shopify webhook trigger orders/paid --address=https://your-tunnel.example.com/webhooks/orders-paid
```

Keep `SEND_INVOICE_TO_TEST_EMAIL` set while testing. Confirm Resend receives one email and `data/invoice-email-logs.json` contains a `sent` record with `providerMessageId`.

## Production Deployment Notes

Use a stable HTTPS host and set the final URL in `shopify.app.toml`.

### Deploying to Vercel

This project includes a Vercel Serverless Function entrypoint at `api/index.ts`. `vercel.json` rewrites these public URLs into that function:

```text
/health
/webhooks/orders-paid
/webhooks/app-uninstalled
/webhooks/compliance
```

In Vercel:

1. Import this project from GitHub.
2. Use the default Node.js project settings.
3. Set the build command to `npm run build`.
4. Leave the output directory empty.
5. Add environment variables in Project Settings.

Recommended Vercel environment variables:

```bash
SHOPIFY_API_SECRET=your_shopify_app_client_secret
RESEND_API_KEY=re_your_resend_key
INVOICE_FROM_EMAIL="Invoices <invoices@yourdomain.com>"
INVOICE_REPLY_TO_EMAIL="support@yourdomain.com"
SEND_INVOICE_TO_TEST_EMAIL="your-test-inbox@example.com"
INVOICE_EMAIL_LOG_PATH=/tmp/invoice-email-logs.json
MAX_INVOICE_EMAIL_RETRY_ATTEMPTS=3
```

Use `/tmp/invoice-email-logs.json` on Vercel only for MVP testing. Vercel functions have ephemeral storage, so this is not reliable idempotency storage for production. Use Postgres, Vercel Postgres, Neon, Supabase, or another durable database before sending real customer invoices at volume.

After deployment, verify:

```bash
curl https://your-project.vercel.app/health
```

Then send a signed mock webhook:

```bash
SHOPIFY_API_SECRET="same secret as Vercel" \
MOCK_WEBHOOK_URL="https://your-project.vercel.app/webhooks/orders-paid" \
npm run test:mock-webhook
```

The Shopify webhook address should be:

```text
https://your-project.vercel.app/webhooks/orders-paid
```

Do not use `/api` in the Shopify webhook URL.

Deploy the Shopify config:

```bash
shopify app deploy
```

Production environment variables should be stored in your hosting provider's secret manager. Do not commit `.env` or runtime log JSON.

The MVP uses a JSON file repository. For multi-instance production, replace `JsonInvoiceEmailLogRepository` with a database-backed repository, preferably Prisma/Postgres, and add unique constraints on `(shop, webhookId)` and `(shop, orderId)` for `sent` invoice emails.

## Switching Test and Real Recipients

Testing mode:

```bash
SEND_INVOICE_TO_TEST_EMAIL=qa@example.com
```

Production customer mode:

```bash
# Remove SEND_INVOICE_TO_TEST_EMAIL
```

When the variable is removed, the service sends to `order.email`, `order.contact_email`, or `order.customer.email`.

## Current Limitations

This sends a test proforma invoice only. It is not a tax invoice and should not be used as official tax documentation.

PDF attachments are generated with `pdf-lib`, embedded with the bundled fonts in `assets/fonts`, and attached directly to the Resend email. They are not stored in durable object storage and do not have a hosted download URL.

The JSON log repository is suitable for local MVP testing, not horizontally scaled production.

There is no retry worker yet. Failed sends are logged and Shopify still receives `200`; retries should be handled later by an admin tool, queue worker, or scheduled job.
