import crypto from "node:crypto";
import type { Request } from "express";
import type { ShopifyOrderPayload, ShopifyWebhookContext } from "../types/shopify.js";

export class ShopifyWebhookAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyWebhookAuthenticationError";
  }
}

function headerValue(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return value?.trim() || undefined;
}

function timingSafeEqualBase64(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "base64");
  const expectedBuffer = Buffer.from(expected, "base64");

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const calculatedHmac = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return timingSafeEqualBase64(hmacHeader, calculatedHmac);
}

export function authenticateShopifyWebhook(
  request: Request,
  shopifyApiSecret: string
): ShopifyWebhookContext {
  const rawBody = request.body;
  if (!Buffer.isBuffer(rawBody)) {
    throw new ShopifyWebhookAuthenticationError("Webhook route must receive a raw request body");
  }

  const hmac = headerValue(request, "x-shopify-hmac-sha256");
  const topic = headerValue(request, "x-shopify-topic");
  const shop = headerValue(request, "x-shopify-shop-domain");
  const webhookId = headerValue(request, "x-shopify-webhook-id");

  if (!hmac || !topic || !shop || !webhookId) {
    throw new ShopifyWebhookAuthenticationError("Missing required Shopify webhook headers");
  }

  if (!verifyShopifyHmac(rawBody, hmac, shopifyApiSecret)) {
    throw new ShopifyWebhookAuthenticationError("Invalid Shopify webhook HMAC");
  }

  let payload: ShopifyOrderPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrderPayload;
  } catch {
    throw new ShopifyWebhookAuthenticationError("Webhook payload is not valid JSON");
  }

  return {
    topic,
    shop,
    webhookId,
    payload
  };
}
