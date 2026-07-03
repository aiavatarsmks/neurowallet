/**
 * wallet-diag.js — read-only localStorage diagnostic for the PIN / "wrong
 * wallet password" dead-end after the origin move to neurowallet.tech.
 *
 * HOW TO USE
 *   1. Copy this whole file to the clipboard:
 *        cat frontend/scripts/wallet-diag.js | pbcopy
 *   2. Open the wallet IN THE SAME CONTEXT it normally runs in. The Telegram
 *      Mini App webview has its OWN localStorage, separate from a standalone
 *      Chrome tab — running this in plain Chrome at neurowallet.tech shows a
 *      DIFFERENT (usually empty) store and will mislead you.
 *        • Telegram Desktop (Mac): right-click inside the Mini App → Inspect
 *          Element → Console. (If missing, enable webview inspecting in
 *          Settings → Advanced → Experimental settings — name varies by build.)
 *        • Or: chrome://inspect remote-debugging the Telegram webview on Android.
 *        • Only if you onboarded directly in Chrome (not via Telegram) is a
 *          normal Chrome DevTools console on neurowallet.tech valid.
 *   3. Paste into the Console, press Enter, read the VERDICT line.
 *
 * SAFE: prints only key presence + string length. No secret/ciphertext/key
 * material is ever output.
 */
(() => {
  const K = {
    eth_address: 'wallet_eth_address', sol_address: 'wallet_sol_address',
    btc_address: 'wallet_btc_address', tron_address: 'wallet_tron_address',
    ton_address: 'wallet_ton_address', keystore: 'wallet_keystore',
    sol_enc: 'wallet_sol_enc', btc_enc: 'wallet_btc_enc',
    tron_enc: 'wallet_tron_enc', ton_enc: 'wallet_ton_enc',
    pin_blob: 'wallet_pin_blob', demo: 'nw_demo',
  };
  const rows = {};
  for (const [l, k] of Object.entries(K)) {
    const v = localStorage.getItem(k);
    rows[l] = { present: v != null, length: v ? v.length : 0 };
  }
  console.log('%cNeuroWallet localStorage diagnostic', 'font-weight:bold;font-size:13px');
  console.log('origin:', location.origin);
  console.table(rows);

  const has = (k) => localStorage.getItem(K[k]) != null;
  const enc = ['sol_enc', 'btc_enc', 'tron_enc', 'ton_enc'].filter(has).length;
  let v;
  if (!has('eth_address') && !has('keystore') && enc === 0)
    v = 'ПУСТО — кошелька на этом origin нет. Путь: onboarding (create/import).';
  else if (enc === 4 && has('keystore'))
    v = 'ПОЛНЫЙ современный кошелёк (keystore + 4 per-chain блоба). Если пароль не подходит — пароль забыт, нужен re-import по seed.';
  else if (has('keystore') && enc === 0)
    v = 'LEGACY: только ETH-keystore, per-chain ключей НЕТ. SOL/BTC/TRX/TON неподписываемы. Нужен re-import по seed.';
  else
    v = 'ЧАСТИЧНОЕ/битое состояние (keystore=' + has('keystore') + ', enc-блобов=' + enc + '/4). Нужен re-import по seed.';
  console.log('%cВЕРДИКТ: ' + v, 'color:#00aa55;font-weight:bold');

  if (location.host !== 'neurowallet.tech')
    console.warn('⚠ origin не neurowallet.tech (' + location.host + '). У каждого домена свой localStorage — проверь, что открыт прод (и что это webview Telegram, а не отдельный Chrome).');
})();
