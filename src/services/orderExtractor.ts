import type { InvoiceLineItem, InvoiceOrder } from "../types/invoice.js";
import type { ShopifyAddressPayload, ShopifyOrderPayload, ShopifyShippingLinePayload } from "../types/shopify.js";
import { parseMoney } from "../utils/money.js";

function compactName(firstName?: string, lastName?: string): string | undefined {
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}

function addressName(address?: ShopifyAddressPayload): string | undefined {
  return address?.name || compactName(address?.first_name, address?.last_name);
}

function shippingLineAmount(line: ShopifyShippingLinePayload): number {
  return parseMoney(
    line.discounted_price_set?.shop_money?.amount ??
      line.discounted_price ??
      line.price_set?.shop_money?.amount ??
      line.price
  );
}

function totalShipping(payload: ShopifyOrderPayload): number {
  const totalShippingPriceSet = payload.total_shipping_price_set?.shop_money?.amount;
  if (totalShippingPriceSet !== undefined) {
    return parseMoney(totalShippingPriceSet);
  }

  return (payload.shipping_lines ?? []).reduce((sum, line) => sum + shippingLineAmount(line), 0);
}

function extractLineItems(payload: ShopifyOrderPayload): InvoiceLineItem[] {
  return (payload.line_items ?? []).map((line) => {
    const quantity = line.quantity ?? 0;
    const unitPrice = parseMoney(line.price);
    const discount = parseMoney(line.total_discount);

    return {
      title: line.title || line.name || "Untitled item",
      sku: line.sku || undefined,
      quantity,
      unitPrice,
      discount,
      subtotal: Math.max(0, unitPrice * quantity - discount)
    };
  });
}

export function extractInvoiceOrder(payload: ShopifyOrderPayload): InvoiceOrder {
  const billingAddress = payload.billing_address ?? payload.customer?.default_address;
  const shippingAddress = payload.shipping_address;
  const customerName =
    compactName(payload.customer?.first_name, payload.customer?.last_name) ?? addressName(billingAddress);

  return {
    orderId: String(payload.id ?? payload.admin_graphql_api_id ?? "unknown"),
    orderName: payload.name,
    createdAt: payload.created_at,
    processedAt: payload.processed_at,
    customerEmail: payload.email ?? payload.contact_email ?? payload.customer?.email,
    customerName,
    billingAddress,
    shippingAddress,
    lineItems: extractLineItems(payload),
    subtotalPrice: parseMoney(payload.subtotal_price),
    totalTax: parseMoney(payload.total_tax),
    totalShipping: totalShipping(payload),
    totalPrice: parseMoney(payload.total_price),
    currency: payload.currency ?? payload.total_shipping_price_set?.shop_money?.currency_code ?? "USD",
    financialStatus: payload.financial_status
  };
}
