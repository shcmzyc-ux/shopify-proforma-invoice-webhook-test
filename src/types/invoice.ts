import type { ShopifyAddressPayload } from "./shopify.js";

export type InvoiceLineItem = {
  title: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
};

export type InvoiceOrder = {
  orderId: string;
  orderName?: string;
  createdAt?: string;
  processedAt?: string;
  customerEmail?: string;
  customerName?: string;
  billingAddress?: ShopifyAddressPayload;
  lineItems: InvoiceLineItem[];
  subtotalPrice: number;
  totalTax: number;
  totalShipping: number;
  totalPrice: number;
  currency: string;
  financialStatus?: string;
};

export type InvoiceEmailPayload = {
  invoiceNumber: string;
  order: InvoiceOrder;
  html: string;
  pdf: Buffer | null;
};
