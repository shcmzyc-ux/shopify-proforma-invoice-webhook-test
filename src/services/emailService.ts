import { Resend } from "resend";
import type { InvoiceEmailPayload } from "../types/invoice.js";

export type SendInvoiceEmailInput = {
  to: string;
  orderName?: string;
  invoice: InvoiceEmailPayload;
};

export type SendInvoiceEmailResult = {
  providerMessageId: string;
  recipientEmail: string;
};

export type InvoiceEmailService = {
  sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult>;
};

export type ResendInvoiceEmailServiceConfig = {
  apiKey?: string;
  fromEmail?: string;
  replyToEmail?: string;
  testRecipientEmail?: string;
};

export class ResendInvoiceEmailService implements InvoiceEmailService {
  private readonly resend?: Resend;

  constructor(private readonly config: ResendInvoiceEmailServiceConfig) {
    this.resend = config.apiKey ? new Resend(config.apiKey) : undefined;
  }

  async sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> {
    if (!this.resend) {
      throw new Error("RESEND_API_KEY is required to send invoice emails");
    }

    if (!this.config.fromEmail) {
      throw new Error("INVOICE_FROM_EMAIL is required to send invoice emails");
    }

    const recipientEmail = this.config.testRecipientEmail || input.to;
    const subject = `Proforma Invoice for Order ${input.orderName || input.invoice.order.orderId}`;
    const attachments =
      input.invoice.pdf === null
        ? undefined
        : [
            {
              filename: `${input.invoice.invoiceNumber}.pdf`,
              content: input.invoice.pdf
            }
          ];

    const response = await this.resend.emails.send({
      from: this.config.fromEmail,
      to: recipientEmail,
      replyTo: this.config.replyToEmail,
      subject,
      html: input.invoice.html,
      attachments
    });

    if (response.error) {
      throw new Error(response.error.message);
    }

    const messageId = response.data?.id;
    if (!messageId) {
      throw new Error("Resend did not return a message id");
    }

    return {
      providerMessageId: messageId,
      recipientEmail
    };
  }
}
