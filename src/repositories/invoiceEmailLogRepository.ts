import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type InvoiceEmailLogStatus = "pending" | "sent" | "failed" | "skipped";

export type InvoiceEmailLog = {
  id: string;
  shop: string;
  orderId: string;
  orderName?: string;
  webhookId: string;
  recipientEmail?: string;
  status: InvoiceEmailLogStatus;
  providerMessageId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  attemptCount: number;
};

export type PendingInvoiceEmailLogInput = {
  shop: string;
  orderId: string;
  orderName?: string;
  webhookId: string;
  recipientEmail?: string;
};

export type InvoiceEmailLogRepository = {
  findRelevant(shop: string, webhookId: string, orderId: string): Promise<InvoiceEmailLog | null>;
  savePending(input: PendingInvoiceEmailLogInput): Promise<InvoiceEmailLog>;
  markSent(id: string, providerMessageId: string): Promise<InvoiceEmailLog>;
  markFailed(id: string, errorMessage: string): Promise<InvoiceEmailLog>;
  markSkipped(input: PendingInvoiceEmailLogInput, reason: string): Promise<InvoiceEmailLog>;
};

type LogFile = {
  logs: InvoiceEmailLog[];
};

function now(): string {
  return new Date().toISOString();
}

function sameDeliveryOrOrder(log: InvoiceEmailLog, shop: string, webhookId: string, orderId: string): boolean {
  return log.shop === shop && (log.webhookId === webhookId || log.orderId === orderId);
}

function normalizeErrorMessage(errorMessage: string): string {
  return errorMessage.slice(0, 1000);
}

export class JsonInvoiceEmailLogRepository implements InvoiceEmailLogRepository {
  constructor(private readonly filePath: string) {}

  async findRelevant(shop: string, webhookId: string, orderId: string): Promise<InvoiceEmailLog | null> {
    const file = await this.readFile();
    const matches = file.logs.filter((log) => sameDeliveryOrOrder(log, shop, webhookId, orderId));
    return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  }

  async savePending(input: PendingInvoiceEmailLogInput): Promise<InvoiceEmailLog> {
    const file = await this.readFile();
    const timestamp = now();
    const existing = file.logs.find((log) => sameDeliveryOrOrder(log, input.shop, input.webhookId, input.orderId));

    if (existing) {
      existing.orderName = input.orderName ?? existing.orderName;
      existing.webhookId = input.webhookId;
      existing.recipientEmail = input.recipientEmail ?? existing.recipientEmail;
      existing.status = "pending";
      existing.errorMessage = undefined;
      existing.updatedAt = timestamp;
      existing.attemptCount += 1;
      await this.writeFile(file);
      return existing;
    }

    const created: InvoiceEmailLog = {
      id: crypto.randomUUID(),
      shop: input.shop,
      orderId: input.orderId,
      orderName: input.orderName,
      webhookId: input.webhookId,
      recipientEmail: input.recipientEmail,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
      attemptCount: 1
    };

    file.logs.push(created);
    await this.writeFile(file);
    return created;
  }

  async markSent(id: string, providerMessageId: string): Promise<InvoiceEmailLog> {
    return this.updateById(id, (log) => {
      log.status = "sent";
      log.providerMessageId = providerMessageId;
      log.errorMessage = undefined;
      log.sentAt = now();
    });
  }

  async markFailed(id: string, errorMessage: string): Promise<InvoiceEmailLog> {
    return this.updateById(id, (log) => {
      log.status = "failed";
      log.errorMessage = normalizeErrorMessage(errorMessage);
    });
  }

  async markSkipped(input: PendingInvoiceEmailLogInput, reason: string): Promise<InvoiceEmailLog> {
    const file = await this.readFile();
    const timestamp = now();
    const existing = file.logs.find((log) => sameDeliveryOrOrder(log, input.shop, input.webhookId, input.orderId));

    if (existing) {
      existing.orderName = input.orderName ?? existing.orderName;
      existing.webhookId = input.webhookId;
      existing.recipientEmail = input.recipientEmail ?? existing.recipientEmail;
      existing.status = "skipped";
      existing.errorMessage = normalizeErrorMessage(reason);
      existing.updatedAt = timestamp;
      await this.writeFile(file);
      return existing;
    }

    const created: InvoiceEmailLog = {
      id: crypto.randomUUID(),
      shop: input.shop,
      orderId: input.orderId,
      orderName: input.orderName,
      webhookId: input.webhookId,
      recipientEmail: input.recipientEmail,
      status: "skipped",
      errorMessage: normalizeErrorMessage(reason),
      createdAt: timestamp,
      updatedAt: timestamp,
      attemptCount: 0
    };

    file.logs.push(created);
    await this.writeFile(file);
    return created;
  }

  private async updateById(id: string, update: (log: InvoiceEmailLog) => void): Promise<InvoiceEmailLog> {
    const file = await this.readFile();
    const log = file.logs.find((candidate) => candidate.id === id);
    if (!log) {
      throw new Error(`Invoice email log not found: ${id}`);
    }

    update(log);
    log.updatedAt = now();
    await this.writeFile(file);
    return log;
  }

  private async readFile(): Promise<LogFile> {
    try {
      const contents = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as LogFile;
      return {
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { logs: [] };
      }

      throw error;
    }
  }

  private async writeFile(file: LogFile): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}
