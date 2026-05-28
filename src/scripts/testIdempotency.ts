import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonInvoiceEmailLogRepository } from "../repositories/invoiceEmailLogRepository.js";
import type { InvoiceEmailService, SendInvoiceEmailInput, SendInvoiceEmailResult } from "../services/emailService.js";
import { processOrdersPaidWebhook } from "../services/ordersPaidProcessor.js";
import type { ShopifyOrderPayload, ShopifyWebhookContext } from "../types/shopify.js";

class FakeEmailService implements InvoiceEmailService {
  sends = 0;

  async sendInvoiceEmail(_input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
    this.sends += 1;
    return {
      providerMessageId: `fake-message-${this.sends}`,
      recipientEmail: "test@example.com"
    };
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const payload = JSON.parse(await fs.readFile(path.join(rootDir, "src/mocks/orders-paid.json"), "utf8")) as ShopifyOrderPayload;
const logPath = path.join(os.tmpdir(), `invoice-email-logs-${Date.now()}.json`);
const repository = new JsonInvoiceEmailLogRepository(logPath);
const emailService = new FakeEmailService();
const context: ShopifyWebhookContext = {
  topic: "orders/paid",
  shop: "test-shop.myshopify.com",
  webhookId: "duplicate-webhook-id",
  payload
};

const first = await processOrdersPaidWebhook(context, {
  logRepository: repository,
  emailService,
  logger: console,
  maxRetryAttempts: 3
});

const second = await processOrdersPaidWebhook(context, {
  logRepository: repository,
  emailService,
  logger: console,
  maxRetryAttempts: 3
});

if (first.status !== "sent") {
  throw new Error(`Expected first delivery to send, got ${first.status}`);
}

if (second.status !== "duplicate") {
  throw new Error(`Expected duplicate delivery to be skipped, got ${second.status}`);
}

if (emailService.sends !== 1) {
  throw new Error(`Expected exactly 1 send, got ${emailService.sends}`);
}

console.info("Idempotency test passed: duplicate webhookId did not resend");
