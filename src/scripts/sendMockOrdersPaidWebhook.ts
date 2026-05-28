import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const payloadPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(rootDir, "src/mocks/orders-paid.json");
const targetUrl = process.env.MOCK_WEBHOOK_URL || "http://localhost:3000/webhooks/orders-paid";
const secret = process.env.SHOPIFY_API_SECRET;

if (!secret) {
  throw new Error("SHOPIFY_API_SECRET is required to sign the mock webhook");
}

const rawBody = await fs.readFile(payloadPath);
const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
const webhookId = process.env.MOCK_WEBHOOK_ID || "mock-orders-paid-webhook-id";

const response = await fetch(targetUrl, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-shopify-topic": "orders/paid",
    "x-shopify-shop-domain": process.env.SHOPIFY_SHOP_DOMAIN || "test-shop.myshopify.com",
    "x-shopify-webhook-id": webhookId,
    "x-shopify-hmac-sha256": hmac
  },
  body: rawBody
});

const responseText = await response.text();
console.info(`Mock webhook response: ${response.status} ${responseText}`);
