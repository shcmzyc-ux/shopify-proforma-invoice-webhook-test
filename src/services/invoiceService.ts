import type { InvoiceEmailPayload, InvoiceLineItem, InvoiceOrder } from "../types/invoice.js";
import type { ShopifyAddressPayload } from "../types/shopify.js";
import { formatMoney } from "../utils/money.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invoiceNumber(order: InvoiceOrder): string {
  const source = order.orderName || order.orderId;
  const safeSource = source.replace(/[^a-zA-Z0-9_-]/g, "");
  return `TEST-PROFORMA-${safeSource || order.orderId}`;
}

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 10);
}

function addressLines(address?: ShopifyAddressPayload): string[] {
  if (!address) {
    return [];
  }

  return [
    address.name,
    address.company,
    address.address1,
    address.address2,
    [address.city, address.province_code || address.province, address.zip].filter(Boolean).join(", "),
    address.country
  ].filter((line): line is string => Boolean(line));
}

function lineItemRow(item: InvoiceLineItem, currency: string): string {
  return `
    <tr>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(item.sku || "-")}</td>
      <td class="number">${item.quantity}</td>
      <td class="number">${escapeHtml(formatMoney(item.unitPrice, currency))}</td>
      <td class="number">${escapeHtml(formatMoney(item.discount, currency))}</td>
      <td class="number">${escapeHtml(formatMoney(item.subtotal, currency))}</td>
    </tr>`;
}

export async function generateInvoicePdf(_order: InvoiceOrder): Promise<Buffer | null> {
  // TODO: Generate a PDF attachment after choosing a production-ready renderer.
  return null;
}

export function generateInvoiceHtml(order: InvoiceOrder): string {
  const number = invoiceNumber(order);
  const currency = order.currency;
  const billingLines = addressLines(order.billingAddress);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(number)}</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #f5f7fa;
        color: #1f2933;
        font-family: Arial, Helvetica, sans-serif;
        line-height: 1.5;
      }
      .container {
        max-width: 760px;
        margin: 0 auto;
        padding: 32px 20px;
      }
      .document {
        background: #ffffff;
        border: 1px solid #d9e2ec;
        border-radius: 6px;
        padding: 28px;
      }
      .eyebrow {
        color: #52606d;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0 4px;
        font-size: 28px;
        line-height: 1.2;
      }
      .notice {
        margin: 20px 0;
        padding: 12px 14px;
        border-left: 4px solid #b42318;
        background: #fff4f2;
        color: #7a271a;
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
        margin: 22px 0;
      }
      .panel {
        border: 1px solid #d9e2ec;
        border-radius: 6px;
        padding: 14px;
      }
      .label {
        color: #52606d;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
      }
      th,
      td {
        border-bottom: 1px solid #d9e2ec;
        padding: 10px 8px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f0f4f8;
        color: #334e68;
        font-size: 12px;
        text-transform: uppercase;
      }
      .number {
        text-align: right;
        white-space: nowrap;
      }
      .totals {
        margin-left: auto;
        margin-top: 20px;
        max-width: 320px;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        border-bottom: 1px solid #d9e2ec;
        padding: 8px 0;
      }
      .grand-total {
        color: #102a43;
        font-size: 18px;
        font-weight: 700;
      }
      @media (max-width: 640px) {
        .document {
          padding: 18px;
        }
        .grid {
          grid-template-columns: 1fr;
        }
        table {
          font-size: 13px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="document">
        <div class="eyebrow">Proforma Invoice</div>
        <h1>${escapeHtml(number)}</h1>
        <div>Order ${escapeHtml(order.orderName || order.orderId)}</div>

        <div class="notice">This is a test proforma invoice, not a tax invoice.</div>

        <div class="grid">
          <div class="panel">
            <div class="label">Customer</div>
            <div>${escapeHtml(order.customerName || "Customer")}</div>
            <div>${escapeHtml(order.customerEmail || "")}</div>
          </div>
          <div class="panel">
            <div class="label">Order Details</div>
            <div>Created: ${escapeHtml(formatDate(order.createdAt))}</div>
            <div>Processed: ${escapeHtml(formatDate(order.processedAt))}</div>
            <div>Payment status: ${escapeHtml(order.financialStatus || "paid")}</div>
          </div>
          <div class="panel">
            <div class="label">Billing Address</div>
            ${
              billingLines.length > 0
                ? billingLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")
                : "<div>-</div>"
            }
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>SKU</th>
              <th class="number">Qty</th>
              <th class="number">Unit price</th>
              <th class="number">Discount</th>
              <th class="number">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${order.lineItems.map((item) => lineItemRow(item, currency)).join("")}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-row">
            <span>Subtotal</span>
            <span>${escapeHtml(formatMoney(order.subtotalPrice, currency))}</span>
          </div>
          <div class="total-row">
            <span>Shipping</span>
            <span>${escapeHtml(formatMoney(order.totalShipping, currency))}</span>
          </div>
          <div class="total-row">
            <span>Tax</span>
            <span>${escapeHtml(formatMoney(order.totalTax, currency))}</span>
          </div>
          <div class="total-row grand-total">
            <span>Total</span>
            <span>${escapeHtml(formatMoney(order.totalPrice, currency))}</span>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

export async function buildInvoiceEmail(order: InvoiceOrder): Promise<InvoiceEmailPayload> {
  return {
    invoiceNumber: invoiceNumber(order),
    order,
    html: generateInvoiceHtml(order),
    pdf: await generateInvoicePdf(order)
  };
}
