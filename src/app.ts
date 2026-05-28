import express from "express";
import { loadConfig } from "./config.js";
import { JsonInvoiceEmailLogRepository } from "./repositories/invoiceEmailLogRepository.js";
import {
  authenticateShopifyWebhook,
  ShopifyWebhookAuthenticationError
} from "./shopify/authenticateWebhook.js";
import { ResendInvoiceEmailService } from "./services/emailService.js";
import { processOrdersPaidWebhook } from "./services/ordersPaidProcessor.js";

function createWebhookDeps() {
  const config = loadConfig();

  return {
    config,
    logRepository: new JsonInvoiceEmailLogRepository(config.invoiceEmailLogPath),
    emailService: new ResendInvoiceEmailService({
      apiKey: config.resendApiKey,
      fromEmail: config.invoiceFromEmail,
      replyToEmail: config.invoiceReplyToEmail,
      testRecipientEmail: config.sendInvoiceToTestEmail
    })
  };
}

function handleRuntimeConfigError(error: unknown, response: express.Response): boolean {
  if (error instanceof Error && error.message.startsWith("Missing required environment variable")) {
    console.error(`[config] ${error.message}`);
    response.status(500).json({
      ok: false,
      error: error.message
    });
    return true;
  }

  return false;
}

export function createApp(): express.Express {
  const app = express();

  app.get("/health", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.post("/webhooks/orders-paid", express.raw({ type: "application/json" }), async (request, response) => {
    try {
      const { config, logRepository, emailService } = createWebhookDeps();
      const context = authenticateShopifyWebhook(request, config.shopifyApiSecret);
      const result = await processOrdersPaidWebhook(context, {
        logRepository,
        emailService,
        maxRetryAttempts: config.maxInvoiceEmailRetryAttempts
      });

      response.status(200).json({ ok: true, status: result.status });
    } catch (error) {
      if (error instanceof ShopifyWebhookAuthenticationError) {
        console.warn(`[webhook] Authentication failed: ${error.message}`);
        response.status(401).json({ ok: false });
        return;
      }

      if (handleRuntimeConfigError(error, response)) {
        return;
      }

      console.error(`[webhook] Unexpected handler error: ${error instanceof Error ? error.message : String(error)}`);
      response.status(200).json({ ok: true, status: "failed" });
    }
  });

  app.post("/webhooks/app-uninstalled", express.raw({ type: "application/json" }), (request, response) => {
    try {
      const { config } = createWebhookDeps();
      const context = authenticateShopifyWebhook(request, config.shopifyApiSecret);
      console.info(`[webhook] App uninstalled shop=${context.shop} webhookId=${context.webhookId}`);
      response.sendStatus(200);
    } catch (error) {
      if (error instanceof ShopifyWebhookAuthenticationError) {
        console.warn(`[webhook] App uninstall authentication failed: ${error.message}`);
        response.sendStatus(401);
        return;
      }

      if (handleRuntimeConfigError(error, response)) {
        return;
      }

      console.error(
        `[webhook] App uninstall unexpected error: ${error instanceof Error ? error.message : String(error)}`
      );
      response.sendStatus(200);
    }
  });

  app.post("/webhooks/compliance", express.raw({ type: "application/json" }), (request, response) => {
    try {
      const { config } = createWebhookDeps();
      const context = authenticateShopifyWebhook(request, config.shopifyApiSecret);
      console.info(`[webhook] Compliance webhook received topic=${context.topic} shop=${context.shop}`);
      response.sendStatus(200);
    } catch (error) {
      if (error instanceof ShopifyWebhookAuthenticationError) {
        console.warn(`[webhook] Compliance authentication failed: ${error.message}`);
        response.sendStatus(401);
        return;
      }

      if (handleRuntimeConfigError(error, response)) {
        return;
      }

      console.error(`[webhook] Compliance unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      response.sendStatus(200);
    }
  });

  app.use(express.json());

  app.use((request, response) => {
    response.status(404).json({ ok: false, error: `No route for ${request.method} ${request.path}` });
  });

  return app;
}
