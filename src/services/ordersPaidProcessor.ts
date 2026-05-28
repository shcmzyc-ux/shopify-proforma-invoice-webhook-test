import type { InvoiceEmailLogRepository } from "../repositories/invoiceEmailLogRepository.js";
import type { ShopifyWebhookContext } from "../types/shopify.js";
import type { InvoiceEmailService } from "./emailService.js";
import { buildInvoiceEmail } from "./invoiceService.js";
import { extractInvoiceOrder } from "./orderExtractor.js";
import { maskEmail, safeOrderLabel } from "../utils/masking.js";

export type Logger = Pick<Console, "info" | "warn" | "error">;

export type OrdersPaidProcessorDeps = {
  logRepository: InvoiceEmailLogRepository;
  emailService: InvoiceEmailService;
  logger?: Logger;
  maxRetryAttempts: number;
};

export type OrdersPaidProcessingResult = {
  status: "sent" | "duplicate" | "failed" | "skipped" | "ignored";
  providerMessageId?: string;
};

function isOrdersPaidTopic(topic: string): boolean {
  const normalized = topic.toLowerCase();
  return normalized === "orders/paid" || normalized === "orders_paid";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function processOrdersPaidWebhook(
  context: ShopifyWebhookContext,
  deps: OrdersPaidProcessorDeps
): Promise<OrdersPaidProcessingResult> {
  const logger = deps.logger ?? console;

  if (!isOrdersPaidTopic(context.topic)) {
    logger.info(`[webhook] Ignored topic=${context.topic} shop=${context.shop}`);
    return { status: "ignored" };
  }

  const order = extractInvoiceOrder(context.payload);
  const orderLabel = safeOrderLabel(order.orderName, order.orderId);
  const logInput = {
    shop: context.shop,
    orderId: order.orderId,
    orderName: order.orderName,
    webhookId: context.webhookId,
    recipientEmail: order.customerEmail
  };

  if (!order.customerEmail) {
    await deps.logRepository.markSkipped(logInput, "Missing customer email");
    logger.warn(`[webhook] Skipped invoice email: missing customer email shop=${context.shop} order=${orderLabel}`);
    return { status: "skipped" };
  }

  const existing = await deps.logRepository.findRelevant(context.shop, context.webhookId, order.orderId);
  if (existing?.status === "sent") {
    logger.info(`[webhook] Duplicate ignored shop=${context.shop} order=${orderLabel} webhookId=${context.webhookId}`);
    return {
      status: "duplicate",
      providerMessageId: existing.providerMessageId
    };
  }

  if (existing?.status === "failed" && existing.attemptCount >= deps.maxRetryAttempts) {
    await deps.logRepository.markSkipped(logInput, `Retry limit reached after ${existing.attemptCount} attempts`);
    logger.warn(`[webhook] Retry limit reached shop=${context.shop} order=${orderLabel}`);
    return { status: "skipped" };
  }

  const pendingLog = await deps.logRepository.savePending(logInput);

  try {
    const invoice = await buildInvoiceEmail(order);
    const sendResult = await deps.emailService.sendInvoiceEmail({
      to: order.customerEmail,
      orderName: order.orderName,
      invoice
    });

    await deps.logRepository.markSent(pendingLog.id, sendResult.providerMessageId);
    logger.info(
      `[webhook] Sent invoice email shop=${context.shop} order=${orderLabel} recipient=${maskEmail(
        sendResult.recipientEmail
      )} providerMessageId=${sendResult.providerMessageId}`
    );

    return {
      status: "sent",
      providerMessageId: sendResult.providerMessageId
    };
  } catch (error) {
    const message = errorMessage(error);
    await deps.logRepository.markFailed(pendingLog.id, message);
    logger.error(
      `[webhook] Invoice email failed shop=${context.shop} order=${orderLabel} recipient=${maskEmail(
        order.customerEmail
      )} error=${message}`
    );

    return { status: "failed" };
  }
}
