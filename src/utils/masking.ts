export function maskEmail(email?: string): string {
  if (!email) {
    return "missing";
  }

  const [localPart, domain] = email.split("@");
  if (!domain) {
    return "***";
  }

  const visibleLocal = localPart.slice(0, 2);
  const [domainName, ...suffixParts] = domain.split(".");
  const suffix = suffixParts.length > 0 ? `.${suffixParts.join(".")}` : "";
  return `${visibleLocal}${"*".repeat(Math.max(3, localPart.length - 2))}@${domainName.slice(0, 1)}***${suffix}`;
}

export function safeOrderLabel(orderName?: string, orderId?: string): string {
  return orderName || (orderId ? `order:${orderId}` : "unknown-order");
}
