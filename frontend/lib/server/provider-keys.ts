/**
 * lib/server/provider-keys.ts — SERVER-ONLY.
 *
 * Ключи провайдеров блокчейн-данных читаются только из server-side env
 * (без префикса NEXT_PUBLIC_, поэтому Next.js не встраивает их в клиентский
 * бандл). Импортировать только из pages/api/* и lib/server/*.
 *
 *   TONCENTER_API_KEY  → заголовок X-API-Key       (toncenter.com)
 *   TRONGRID_API_KEY   → заголовок TRON-PRO-API-KEY (api.trongrid.io)
 *   ETHERSCAN_API_KEY  → query-параметр apikey      (api.etherscan.io v2)
 *
 * Ключ не задан → пустые заголовки / undefined: поведение как раньше
 * (бесплатные лимиты провайдера).
 */

function readKey(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function toncenterApiKey(): string | undefined {
  return readKey('TONCENTER_API_KEY');
}

export function trongridApiKey(): string | undefined {
  return readKey('TRONGRID_API_KEY');
}

export function etherscanApiKey(): string | undefined {
  return readKey('ETHERSCAN_API_KEY');
}

export function toncenterHeaders(): Record<string, string> {
  const key = toncenterApiKey();
  return key ? { 'X-API-Key': key } : {};
}

export function trongridHeaders(): Record<string, string> {
  const key = trongridApiKey();
  return key ? { 'TRON-PRO-API-KEY': key } : {};
}
