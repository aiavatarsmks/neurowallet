/** Response of /api/balances. null = not served (no server key / provider error) → client falls back. */
export interface BalancesResponse {
  ton:     number | null;
  usdtTon: number | null;
  trx:     number | null;
  usdtTrc: number | null;
}
