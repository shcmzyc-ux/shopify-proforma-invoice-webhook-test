import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { InvoiceEmailPayload, InvoiceLineItem, InvoiceOrder } from "../types/invoice.js";
import type { ShopifyAddressPayload } from "../types/shopify.js";
import { formatMoney } from "../utils/money.js";

const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 48;
const PDF_TABLE_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const FONT_DIR = path.join(process.cwd(), "assets/fonts");

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

function latinPdfText(value: unknown): string {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function unicodePdfText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePdfText(value: unknown, mode: "latin" | "unicode"): string {
  return mode === "latin" ? latinPdfText(value) : unicodePdfText(value);
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function truncateText(font: PDFFont, text: string, size: number, maxWidth: number, mode: "latin" | "unicode"): string {
  const safeText = normalizePdfText(text, mode);
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

function tokenizeForWrap(text: string): string[] {
  return text.match(/[\u3400-\u9FFF]|[^\s\u3400-\u9FFF]+|\s+/g) ?? [];
}

function appendWrapToken(currentLine: string, token: string): string {
  if (/^\s+$/.test(token)) {
    return currentLine ? `${currentLine} ` : "";
  }

  return `${currentLine}${token}`;
}

function wrapText(font: PDFFont, text: string, size: number, maxWidth: number, mode: "latin" | "unicode"): string[] {
  const tokens = tokenizeForWrap(normalizePdfText(text, mode));
  const lines: string[] = [];
  let currentLine = "";

  for (const token of tokens) {
    const candidate = appendWrapToken(currentLine, token);
    if (!candidate) {
      continue;
    }

    if (textWidth(font, candidate, size) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    currentLine = truncateText(font, token, size, maxWidth, mode);
  }

  if (currentLine) {
    lines.push(currentLine.trimEnd());
  }

  return lines.length > 0 ? lines : ["-"];
}

function drawRightAlignedText(
  page: PDFPage,
  text: string,
  xRight: number,
  y: number,
  font: PDFFont,
  size: number,
  mode: "latin" | "unicode"
): void {
  const safeText = normalizePdfText(text, mode);
  page.drawText(safeText, {
    x: xRight - textWidth(font, safeText, size),
    y,
    size,
    font,
    color: rgb(0.12, 0.16, 0.22)
  });
}

type InvoicePdfFonts = {
  englishRegular: PDFFont;
  englishBold: PDFFont;
  chineseRegular: PDFFont;
  chineseBold: PDFFont;
};

async function embedInvoiceFonts(pdfDoc: PDFDocument): Promise<InvoicePdfFonts> {
  pdfDoc.registerFontkit(fontkit);

  const [englishRegular, englishBold, chineseRegular, chineseBold] = await Promise.all([
    readFile(path.join(FONT_DIR, "PolymathDisp-Regular.otf")),
    readFile(path.join(FONT_DIR, "PolymathDisp-Bold.otf")),
    readFile(path.join(FONT_DIR, "SourceHanSansCN-Regular.otf")),
    readFile(path.join(FONT_DIR, "SourceHanSansCN-Bold.otf"))
  ]);

  return {
    englishRegular: await pdfDoc.embedFont(englishRegular, { subset: true }),
    englishBold: await pdfDoc.embedFont(englishBold, { subset: true }),
    chineseRegular: await pdfDoc.embedFont(chineseRegular, { subset: false }),
    chineseBold: await pdfDoc.embedFont(chineseBold, { subset: false })
  };
}

function translateFinancialStatus(status?: string): string {
  if (!status) {
    return "已付款";
  }

  const normalized = status.toLowerCase();
  if (normalized === "paid") {
    return "已付款";
  }

  if (normalized === "pending") {
    return "待付款";
  }

  if (normalized === "refunded") {
    return "已退款";
  }

  return status;
}

function translateFinancialStatusTraditional(status?: string): string {
  if (!status) {
    return "已付款";
  }

  const normalized = status.toLowerCase();
  if (normalized === "paid") {
    return "已付款";
  }

  if (normalized === "pending") {
    return "待付款";
  }

  if (normalized === "refunded") {
    return "已退款";
  }

  return status;
}

function drawTextAt(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  mode: "latin" | "unicode",
  color: RGB = rgb(0.12, 0.16, 0.22),
  maxWidth?: number
): void {
  const normalized = maxWidth
    ? truncateText(font, text, size, maxWidth, mode)
    : normalizePdfText(text, mode);

  page.drawText(normalized, {
    x,
    y,
    size,
    font,
    color
  });
}

type PdfCanvas = {
  pdfDoc: PDFDocument;
  page: PDFPage;
  y: number;
  pageNumber: number;
};

type BilingualSection = "en" | "zh";

function addPdfPage(canvas: PdfCanvas): void {
  canvas.page = canvas.pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  canvas.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  canvas.pageNumber += 1;
}

function ensureSpace(canvas: PdfCanvas, requiredHeight: number): void {
  if (canvas.y - requiredHeight >= PDF_MARGIN) {
    return;
  }

  addPdfPage(canvas);
}

function drawSectionHeading(canvas: PdfCanvas, text: string, font: PDFFont, mode: "latin" | "unicode"): void {
  ensureSpace(canvas, 44);
  canvas.page.drawRectangle({
    x: PDF_MARGIN,
    y: canvas.y - 9,
    width: 4,
    height: 20,
    color: rgb(0.06, 0.16, 0.26)
  });
  drawTextAt(canvas.page, text, PDF_MARGIN + 12, canvas.y, font, 14, mode, rgb(0.06, 0.16, 0.26));
  canvas.y -= 32;
}

function drawParagraph(
  canvas: PdfCanvas,
  text: string,
  font: PDFFont,
  size: number,
  mode: "latin" | "unicode",
  color: RGB = rgb(0.12, 0.16, 0.22),
  maxWidth = PDF_TABLE_WIDTH,
  lineHeight = size + 6
): void {
  const lines = wrapText(font, text, size, maxWidth, mode);
  for (const line of lines) {
    ensureSpace(canvas, lineHeight);
    drawTextAt(canvas.page, line, PDF_MARGIN, canvas.y, font, size, mode, color, maxWidth);
    canvas.y -= lineHeight;
  }
}

function drawKeyValueGrid(
  canvas: PdfCanvas,
  leftTitle: string,
  rightTitle: string,
  leftLines: string[],
  rightLines: string[],
  fonts: {
    heading: PDFFont;
    body: PDFFont;
  },
  mode: "latin" | "unicode"
): void {
  const columnWidth = (PDF_TABLE_WIDTH - 24) / 2;
  const lineHeight = 15;
  const leftWrapped = leftLines.flatMap((line) => wrapText(fonts.body, line, 9.5, columnWidth - 24, mode));
  const rightWrapped = rightLines.flatMap((line) => wrapText(fonts.body, line, 9.5, columnWidth - 24, mode));
  const bodyRows = Math.max(leftWrapped.length, rightWrapped.length, 1);
  const boxHeight = 38 + bodyRows * lineHeight;

  ensureSpace(canvas, boxHeight + 20);

  const leftX = PDF_MARGIN;
  const rightX = PDF_MARGIN + columnWidth + 24;
  const topY = canvas.y;

  for (const x of [leftX, rightX]) {
    canvas.page.drawRectangle({
      x,
      y: topY - boxHeight,
      width: columnWidth,
      height: boxHeight,
      borderColor: rgb(0.84, 0.88, 0.92),
      borderWidth: 1,
      color: rgb(0.99, 1, 1)
    });
  }

  drawTextAt(canvas.page, leftTitle, leftX + 12, topY - 20, fonts.heading, 10.5, mode, rgb(0.2, 0.31, 0.41), columnWidth - 24);
  drawTextAt(canvas.page, rightTitle, rightX + 12, topY - 20, fonts.heading, 10.5, mode, rgb(0.2, 0.31, 0.41), columnWidth - 24);

  let leftY = topY - 40;
  for (const line of leftWrapped) {
    drawTextAt(canvas.page, line, leftX + 12, leftY, fonts.body, 9.5, mode, rgb(0.12, 0.16, 0.22), columnWidth - 24);
    leftY -= lineHeight;
  }

  let rightY = topY - 40;
  for (const line of rightWrapped) {
    drawTextAt(canvas.page, line, rightX + 12, rightY, fonts.body, 9.5, mode, rgb(0.12, 0.16, 0.22), columnWidth - 24);
    rightY -= lineHeight;
  }

  canvas.y -= boxHeight + 24;
}

function drawTotals(
  canvas: PdfCanvas,
  rows: Array<[string, string]>,
  fonts: {
    regular: PDFFont;
    bold: PDFFont;
  },
  mode: "latin" | "unicode"
): void {
  ensureSpace(canvas, 118);

  const totalsX = PDF_PAGE_WIDTH - PDF_MARGIN - 230;
  const totalValueRightX = PDF_PAGE_WIDTH - PDF_MARGIN;
  canvas.y -= 4;

  for (const [label, value] of rows) {
    const isGrandTotal = label === "Total" || label === "總計";
    if (isGrandTotal) {
      canvas.page.drawLine({
        start: { x: totalsX, y: canvas.y + 9 },
        end: { x: totalValueRightX, y: canvas.y + 9 },
        thickness: 1,
        color: rgb(0.12, 0.16, 0.22)
      });
    }

    drawTextAt(canvas.page, label, totalsX, canvas.y, isGrandTotal ? fonts.bold : fonts.regular, isGrandTotal ? 12 : 10, mode);
    drawRightAlignedText(
      canvas.page,
      value,
      totalValueRightX,
      canvas.y,
      isGrandTotal ? fonts.bold : fonts.regular,
      isGrandTotal ? 12 : 10,
      mode
    );
    canvas.y -= isGrandTotal ? 24 : 19;
  }

  canvas.y -= 16;
}

function drawLineItemsTable(
  canvas: PdfCanvas,
  order: InvoiceOrder,
  labels: {
    item: string;
    sku: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    subtotal: string;
  },
  fonts: {
    header: PDFFont;
    body: PDFFont;
  },
  mode: "latin" | "unicode"
): void {
  const currency = order.currency;
  const columns = [
    { label: labels.item, x: PDF_MARGIN + 8, width: 178 },
    { label: labels.sku, x: PDF_MARGIN + 192, width: 64 },
    { label: labels.quantity, x: PDF_MARGIN + 264, width: 32, right: PDF_MARGIN + 296 },
    { label: labels.unitPrice, x: PDF_MARGIN + 312, width: 54, right: PDF_MARGIN + 366 },
    { label: labels.discount, x: PDF_MARGIN + 380, width: 54, right: PDF_MARGIN + 434 },
    { label: labels.subtotal, x: PDF_MARGIN + 448, width: 50, right: PDF_MARGIN + 498 }
  ];

  const drawHeader = (): void => {
    ensureSpace(canvas, 42);
    canvas.page.drawRectangle({
      x: PDF_MARGIN,
      y: canvas.y - 24,
      width: PDF_TABLE_WIDTH,
      height: 30,
      color: rgb(0.94, 0.96, 0.98)
    });

    for (const column of columns) {
      drawTextAt(canvas.page, column.label, column.x, canvas.y - 13, fonts.header, 8.5, mode, rgb(0.2, 0.31, 0.41), column.width);
    }

    canvas.y -= 36;
  };

  drawHeader();

  for (const item of order.lineItems) {
    const titleLines = wrapText(fonts.body, item.title, 9, columns[0].width, mode);
    const rowHeight = Math.max(34, titleLines.length * 13 + 18);
    if (canvas.y - rowHeight < PDF_MARGIN + 132) {
      addPdfPage(canvas);
      drawHeader();
    }

    canvas.page.drawLine({
      start: { x: PDF_MARGIN, y: canvas.y + 8 },
      end: { x: PDF_PAGE_WIDTH - PDF_MARGIN, y: canvas.y + 8 },
      thickness: 0.5,
      color: rgb(0.85, 0.89, 0.93)
    });

    titleLines.forEach((line, index) => {
      drawTextAt(canvas.page, line, columns[0].x, canvas.y - index * 13, fonts.body, 9, mode);
    });

    drawTextAt(canvas.page, item.sku || "-", columns[1].x, canvas.y, fonts.body, 9, mode, rgb(0.12, 0.16, 0.22), columns[1].width);
    drawRightAlignedText(canvas.page, String(item.quantity), columns[2].right as number, canvas.y, fonts.body, 9, mode);
    drawRightAlignedText(canvas.page, formatMoney(item.unitPrice, currency), columns[3].right as number, canvas.y, fonts.body, 9, mode);
    drawRightAlignedText(canvas.page, formatMoney(item.discount, currency), columns[4].right as number, canvas.y, fonts.body, 9, mode);
    drawRightAlignedText(canvas.page, formatMoney(item.subtotal, currency), columns[5].right as number, canvas.y, fonts.body, 9, mode);

    canvas.y -= rowHeight;
  }

  canvas.y -= 18;
}

function drawInvoiceHeader(canvas: PdfCanvas, invoiceNo: string, fonts: InvoicePdfFonts): void {
  drawTextAt(canvas.page, "PROFORMA INVOICE", PDF_MARGIN, canvas.y, fonts.englishBold, 23, "latin", rgb(0.06, 0.16, 0.26));
  drawTextAt(canvas.page, "形式發票", PDF_MARGIN, canvas.y - 28, fonts.chineseBold, 18, "unicode", rgb(0.06, 0.16, 0.26));
  drawRightAlignedText(canvas.page, invoiceNo, PDF_PAGE_WIDTH - PDF_MARGIN, canvas.y + 5, fonts.englishBold, 11, "latin");
  canvas.y -= 56;

  canvas.page.drawRectangle({
    x: PDF_MARGIN,
    y: canvas.y - 42,
    width: PDF_TABLE_WIDTH,
    height: 38,
    color: rgb(1, 0.95, 0.94),
    borderColor: rgb(0.7, 0.15, 0.1),
    borderWidth: 1
  });
  drawTextAt(
    canvas.page,
    "This is a test proforma invoice, not a tax invoice.",
    PDF_MARGIN + 14,
    canvas.y - 18,
    fonts.englishBold,
    10.5,
    "latin",
    rgb(0.48, 0.15, 0.1),
    PDF_TABLE_WIDTH - 28
  );
  drawTextAt(
    canvas.page,
    "這是一份測試形式發票，並非稅務發票。",
    PDF_MARGIN + 14,
    canvas.y - 34,
    fonts.chineseBold,
    10.5,
    "unicode",
    rgb(0.48, 0.15, 0.1),
    PDF_TABLE_WIDTH - 28
  );
  canvas.y -= 68;
}

function drawEnglishSection(canvas: PdfCanvas, order: InvoiceOrder, fonts: InvoicePdfFonts): void {
  drawSectionHeading(canvas, "English Version", fonts.englishBold, "latin");
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

  drawKeyValueGrid(
    canvas,
    "Customer",
    "Order Details",
    customerLines,
    orderLines,
    { heading: fonts.englishBold, body: fonts.chineseRegular },
    "unicode"
  );

  drawLineItemsTable(
    canvas,
    order,
    {
      item: "Item",
      sku: "SKU",
      quantity: "Qty",
      unitPrice: "Unit",
      discount: "Discount",
      subtotal: "Subtotal"
    },
    { header: fonts.englishBold, body: fonts.chineseRegular },
    "unicode"
  );

  drawTotals(
    canvas,
    [
      ["Subtotal", formatMoney(order.subtotalPrice, order.currency)],
      ["Shipping", formatMoney(order.totalShipping, order.currency)],
      ["Tax", formatMoney(order.totalTax, order.currency)],
      ["Total", formatMoney(order.totalPrice, order.currency)]
    ],
    { regular: fonts.englishRegular, bold: fonts.englishBold },
    "latin"
  );
}

function drawTraditionalChineseSection(canvas: PdfCanvas, order: InvoiceOrder, fonts: InvoicePdfFonts): void {
  drawSectionHeading(canvas, "繁體中文版本", fonts.chineseBold, "unicode");
  const customerLines = [
    order.customerName || "客戶",
    order.customerEmail || "",
    ...addressLines(order.billingAddress)
  ].filter(Boolean);
  const orderLines = [
    `訂單：${order.orderName || order.orderId}`,
    `建立日期：${formatDate(order.createdAt)}`,
    `處理日期：${formatDate(order.processedAt)}`,
    `付款狀態：${translateFinancialStatusTraditional(order.financialStatus)}`
  ];

  drawKeyValueGrid(
    canvas,
    "客戶資訊",
    "訂單資訊",
    customerLines,
    orderLines,
    { heading: fonts.chineseBold, body: fonts.chineseRegular },
    "unicode"
  );

  drawLineItemsTable(
    canvas,
    order,
    {
      item: "商品",
      sku: "SKU",
      quantity: "數量",
      unitPrice: "單價",
      discount: "折扣",
      subtotal: "小計"
    },
    { header: fonts.chineseBold, body: fonts.chineseRegular },
    "unicode"
  );

  drawTotals(
    canvas,
    [
      ["商品小計", formatMoney(order.subtotalPrice, order.currency)],
      ["運費", formatMoney(order.totalShipping, order.currency)],
      ["稅費", formatMoney(order.totalTax, order.currency)],
      ["總計", formatMoney(order.totalPrice, order.currency)]
    ],
    { regular: fonts.chineseRegular, bold: fonts.chineseBold },
    "unicode"
  );
}

function drawFooterNumbers(pdfDoc: PDFDocument, fonts: InvoicePdfFonts): void {
  const pages = pdfDoc.getPages();
  pages.forEach((page, index) => {
    const pageLabel = `Page ${index + 1} / ${pages.length}`;
    const zhLabel = `第 ${index + 1} 頁 / 共 ${pages.length} 頁`;
    drawTextAt(
      page,
      "Generated automatically after Shopify order payment. / 訂單付款後自動生成。",
      PDF_MARGIN,
      28,
      fonts.chineseRegular,
      8,
      "unicode",
      rgb(0.4, 0.46, 0.53),
      330
    );
    drawRightAlignedText(page, `${pageLabel}  ${zhLabel}`, PDF_PAGE_WIDTH - PDF_MARGIN, 28, fonts.chineseRegular, 8, "unicode");
  });
}

export async function generateInvoicePdf(order: InvoiceOrder): Promise<Buffer | null> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await embedInvoiceFonts(pdfDoc);
  const invoiceNo = invoiceNumber(order);
  const canvas: PdfCanvas = {
    pdfDoc,
    page: pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]),
    y: PDF_PAGE_HEIGHT - PDF_MARGIN,
    pageNumber: 1
  };

  drawInvoiceHeader(canvas, invoiceNo, fonts);
  drawEnglishSection(canvas, order, fonts);
  ensureSpace(canvas, 70);
  drawTraditionalChineseSection(canvas, order, fonts);
  drawFooterNumbers(pdfDoc, fonts);

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
