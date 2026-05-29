import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { InvoiceEmailPayload, InvoiceLineItem, InvoiceOrder } from "../types/invoice.js";
import type { ShopifyAddressPayload } from "../types/shopify.js";
import { formatMoney } from "../utils/money.js";

const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 48;
const PDF_TABLE_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

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

function safePdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function truncateText(font: PDFFont, text: string, size: number, maxWidth: number): string {
  const safeText = safePdfText(text);
  if (textWidth(font, safeText, size) <= maxWidth) {
    return safeText;
  }

  const ellipsis = "...";
  let truncated = safeText;
  while (truncated.length > 0 && textWidth(font, `${truncated}${ellipsis}`, size) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${ellipsis}`;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = safePdfText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (textWidth(font, candidate, size) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = truncateText(font, word, size, maxWidth);
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : ["-"];
}

function drawRightAlignedText(page: PDFPage, text: string, xRight: number, y: number, font: PDFFont, size: number): void {
  const safeText = safePdfText(text);
  page.drawText(safeText, {
    x: xRight - textWidth(font, safeText, size),
    y,
    size,
    font,
    color: rgb(0.12, 0.16, 0.22)
  });
}

export async function generateInvoicePdf(order: InvoiceOrder): Promise<Buffer | null> {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const invoiceNo = invoiceNumber(order);
  const currency = order.currency;
  let page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const addPageIfNeeded = (height: number): void => {
    if (y - height >= PDF_MARGIN) {
      return;
    }

    page = pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  };

  const drawText = (
    text: string,
    x: number,
    size = 10,
    font: PDFFont = regularFont,
    color = rgb(0.12, 0.16, 0.22)
  ): void => {
    page.drawText(safePdfText(text), {
      x,
      y,
      size,
      font,
      color
    });
  };

  page.drawText("PROFORMA INVOICE", {
    x: PDF_MARGIN,
    y,
    size: 22,
    font: boldFont,
    color: rgb(0.06, 0.16, 0.26)
  });
  drawRightAlignedText(page, invoiceNo, PDF_PAGE_WIDTH - PDF_MARGIN, y + 4, boldFont, 11);
  y -= 28;

  page.drawRectangle({
    x: PDF_MARGIN,
    y: y - 34,
    width: PDF_TABLE_WIDTH,
    height: 30,
    color: rgb(1, 0.95, 0.94),
    borderColor: rgb(0.7, 0.15, 0.1),
    borderWidth: 1
  });
  y -= 24;
  drawText("This is a test proforma invoice, not a tax invoice.", PDF_MARGIN + 12, 11, boldFont, rgb(0.48, 0.15, 0.1));
  y -= 28;

  const leftX = PDF_MARGIN;
  const rightX = PDF_MARGIN + PDF_TABLE_WIDTH / 2 + 18;
  const detailLineHeight = 14;

  drawText("Customer", leftX, 11, boldFont);
  drawText("Order Details", rightX, 11, boldFont);
  y -= 18;

  const customerLines = [
    order.customerName || "Customer",
    order.customerEmail || "",
    ...addressLines(order.billingAddress)
  ].filter(Boolean);
  const orderLines = [
    `Order: ${order.orderName || order.orderId}`,
    `Created: ${formatDate(order.createdAt)}`,
    `Processed: ${formatDate(order.processedAt)}`,
    `Payment status: ${order.financialStatus || "paid"}`
  ];
  const maxInfoLines = Math.max(customerLines.length, orderLines.length);

  for (let index = 0; index < maxInfoLines; index += 1) {
    if (customerLines[index]) {
      drawText(customerLines[index], leftX, 9);
    }
    if (orderLines[index]) {
      drawText(orderLines[index], rightX, 9);
    }
    y -= detailLineHeight;
  }

  y -= 20;

  const columns = [
    { label: "Item", x: PDF_MARGIN + 8, width: 180 },
    { label: "SKU", x: PDF_MARGIN + 196, width: 62 },
    { label: "Qty", x: PDF_MARGIN + 268, width: 30, right: PDF_MARGIN + 298 },
    { label: "Unit", x: PDF_MARGIN + 312, width: 54, right: PDF_MARGIN + 366 },
    { label: "Discount", x: PDF_MARGIN + 380, width: 54, right: PDF_MARGIN + 434 },
    { label: "Subtotal", x: PDF_MARGIN + 448, width: 50, right: PDF_MARGIN + 498 }
  ];

  const drawTableHeader = (): void => {
    addPageIfNeeded(52);
    page.drawRectangle({
      x: PDF_MARGIN,
      y: y - 18,
      width: PDF_TABLE_WIDTH,
      height: 24,
      color: rgb(0.94, 0.96, 0.98)
    });

    for (const column of columns) {
      page.drawText(column.label, {
        x: column.x,
        y: y - 10,
        size: 8,
        font: boldFont,
        color: rgb(0.2, 0.31, 0.41)
      });
    }

    y -= 28;
  };

  drawTableHeader();

  for (const item of order.lineItems) {
    addPageIfNeeded(42);
    const titleLines = wrapText(regularFont, item.title, 8.5, columns[0].width).slice(0, 2);
    const rowHeight = Math.max(24, titleLines.length * 11 + 12);

    page.drawLine({
      start: { x: PDF_MARGIN, y: y + 6 },
      end: { x: PDF_PAGE_WIDTH - PDF_MARGIN, y: y + 6 },
      thickness: 0.5,
      color: rgb(0.85, 0.89, 0.93)
    });

    titleLines.forEach((line, index) => {
      page.drawText(line, {
        x: columns[0].x,
        y: y - index * 11,
        size: 8.5,
        font: regularFont,
        color: rgb(0.12, 0.16, 0.22)
      });
    });

    page.drawText(truncateText(regularFont, item.sku || "-", 8.5, columns[1].width), {
      x: columns[1].x,
      y,
      size: 8.5,
      font: regularFont,
      color: rgb(0.12, 0.16, 0.22)
    });

    drawRightAlignedText(page, String(item.quantity), columns[2].right as number, y, regularFont, 8.5);
    drawRightAlignedText(page, formatMoney(item.unitPrice, currency), columns[3].right as number, y, regularFont, 8.5);
    drawRightAlignedText(page, formatMoney(item.discount, currency), columns[4].right as number, y, regularFont, 8.5);
    drawRightAlignedText(page, formatMoney(item.subtotal, currency), columns[5].right as number, y, regularFont, 8.5);

    y -= rowHeight;
  }

  y -= 14;
  addPageIfNeeded(110);

  const totalsX = PDF_PAGE_WIDTH - PDF_MARGIN - 210;
  const totalLabelX = totalsX;
  const totalValueRightX = PDF_PAGE_WIDTH - PDF_MARGIN;
  const totalRows = [
    ["Subtotal", formatMoney(order.subtotalPrice, currency)],
    ["Shipping", formatMoney(order.totalShipping, currency)],
    ["Tax", formatMoney(order.totalTax, currency)],
    ["Total", formatMoney(order.totalPrice, currency)]
  ];

  for (const [label, value] of totalRows) {
    const isGrandTotal = label === "Total";
    if (isGrandTotal) {
      page.drawLine({
        start: { x: totalsX, y: y + 8 },
        end: { x: totalValueRightX, y: y + 8 },
        thickness: 1,
        color: rgb(0.12, 0.16, 0.22)
      });
    }

    page.drawText(label, {
      x: totalLabelX,
      y,
      size: isGrandTotal ? 12 : 10,
      font: isGrandTotal ? boldFont : regularFont,
      color: rgb(0.12, 0.16, 0.22)
    });
    drawRightAlignedText(page, value, totalValueRightX, y, isGrandTotal ? boldFont : regularFont, isGrandTotal ? 12 : 10);
    y -= isGrandTotal ? 22 : 18;
  }

  y = Math.max(PDF_MARGIN, y - 18);
  page.drawText("Generated automatically after Shopify order payment.", {
    x: PDF_MARGIN,
    y,
    size: 8,
    font: regularFont,
    color: rgb(0.4, 0.46, 0.53)
  });

  return Buffer.from(await pdfDoc.save());
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
