export type ShopifyAddressPayload = {
  name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  country?: string;
  country_code?: string;
  zip?: string;
  phone?: string;
};

export type ShopifyLineItemPayload = {
  id?: number | string;
  title?: string;
  name?: string;
  sku?: string;
  quantity?: number;
  price?: string;
  total_discount?: string;
};

export type ShopifyMoneySet = {
  shop_money?: {
    amount?: string;
    currency_code?: string;
  };
};

export type ShopifyShippingLinePayload = {
  title?: string;
  price?: string;
  discounted_price?: string;
  price_set?: ShopifyMoneySet;
  discounted_price_set?: ShopifyMoneySet;
};

export type ShopifyOrderPayload = {
  id?: number | string;
  admin_graphql_api_id?: string;
  name?: string;
  created_at?: string;
  processed_at?: string;
  email?: string;
  contact_email?: string;
  currency?: string;
  subtotal_price?: string;
  total_tax?: string;
  total_price?: string;
  financial_status?: string;
  customer?: {
    email?: string;
    first_name?: string;
    last_name?: string;
    default_address?: ShopifyAddressPayload;
  };
  billing_address?: ShopifyAddressPayload;
  line_items?: ShopifyLineItemPayload[];
  shipping_lines?: ShopifyShippingLinePayload[];
  total_shipping_price_set?: ShopifyMoneySet;
};

export type ShopifyWebhookContext = {
  topic: string;
  shop: string;
  webhookId: string;
  payload: ShopifyOrderPayload;
};
