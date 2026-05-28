import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonInvoiceEmailLogRepository } from "../repositories/invoiceEmailLogRepository.js";
import type { InvoiceEmailService, SendInvoiceEmailInput, SendInvoiceEmailResult } from "../services/emailService.js";
import { processOrdersPaidWebhook } from "../services/ordersPaidProcessor.js";
import type { ShopifyOrderPayload, ShopifyWebhookContext } from "../types/shopify.js";

class FailingEmailService implements InvoiceEmailService {
  async sendInvoiceEmail(_input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
    throw new Error("Email service should not be called when customer email is missing");
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const payload = JSON.parse(await fs.readFile(path.join(rootDir, "src/mocks/orders-paid.json"), "utf8")) as ShopifyOrderPayload;
delete payload.email;
delete payload.contact_email;
if (payload.customer) {
  delete payload.customer.email;
}

const repository = new JsonInvoiceEmailLogRepository(path.join(os.tmpdir(), `invoice-email-no-email-${Date.now()}.json`));
const context: ShopifyWebhookContext = {
  topic: "orders/paid",
  shop: "test-shop.myshopify.com",
  webhookId: "missing-email-webhook-id",
  payload
};

const result = await processOrdersPaidWebhook(context, {
  logRepository: repository,
  emailService: new FailingEmailService(),
  logger: console,
  maxRetryAttempts: 3
});

if (result.status !== "skipped") {
  throw new Error(`Expected missing email delivery to be skipped, got ${result.status}`);
}

console.info("Missing email test passed: webhook was acknowledged without sending");
