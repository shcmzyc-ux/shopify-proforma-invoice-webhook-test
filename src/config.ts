export type AppConfig = {
  port: number;
  shopifyApiSecret: string;
  invoiceEmailLogPath: string;
  maxInvoiceEmailRetryAttempts: number;
  resendApiKey?: string;
  invoiceFromEmail?: string;
  invoiceReplyToEmail?: string;
  sendInvoiceToTestEmail?: string;
};

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function integerEnv(name: string, fallback: number): number {
  const value = optionalEnv(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }

  return parsed;
}

export function loadConfig(): AppConfig {
  return {
    port: integerEnv("PORT", 3000),
    shopifyApiSecret: requiredEnv("SHOPIFY_API_SECRET"),
    invoiceEmailLogPath: optionalEnv("INVOICE_EMAIL_LOG_PATH") ?? "data/invoice-email-logs.json",
    maxInvoiceEmailRetryAttempts: integerEnv("MAX_INVOICE_EMAIL_RETRY_ATTEMPTS", 3),
    resendApiKey: optionalEnv("RESEND_API_KEY"),
    invoiceFromEmail: optionalEnv("INVOICE_FROM_EMAIL"),
    invoiceReplyToEmail: optionalEnv("INVOICE_REPLY_TO_EMAIL"),
    sendInvoiceToTestEmail: optionalEnv("SEND_INVOICE_TO_TEST_EMAIL")
  };
}
