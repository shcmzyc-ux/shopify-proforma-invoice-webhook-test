import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateInvoiceHtml } from "../services/invoiceService.js";
import { extractInvoiceOrder } from "../services/orderExtractor.js";
import type { ShopifyOrderPayload } from "../types/shopify.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mockPath = path.join(rootDir, "src/mocks/orders-paid.json");
const outputPath = path.join(rootDir, "tmp/mock-proforma-invoice.html");

const payload = JSON.parse(await fs.readFile(mockPath, "utf8")) as ShopifyOrderPayload;
const order = extractInvoiceOrder(payload);
const html = generateInvoiceHtml(order);

if (!html.includes("This is a test proforma invoice, not a tax invoice.")) {
  throw new Error("Invoice HTML is missing the required test proforma notice");
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, html, "utf8");

console.info(`Invoice HTML generated: ${outputPath}`);
