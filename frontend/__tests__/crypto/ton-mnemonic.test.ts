// @vitest-environment node
/**
 * Tonkeeper-compatible TON scheme (DECISION_TON_DERIVATION.md, variant B).
 * Node env: bip39/@ton/crypto break under the jsdom Uint8Array realm.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as bip39 from 'bip39';
import { mnemonicValidate } from '@ton/crypto';
import { derivePath } from 'ed25519-hd-key';
import { Address } from '@ton/ton';
import {
  generateDualValidMnemonic,
  isTonMnemonic,
  tonSchemeForPhrase,
  tonSeedFromMnemonic,
} from '@/lib/crypto/ton-mnemonic';
import { generateNewWalletMnemonic, importWalletFromMnemonic } from '@/lib/crypto/wallet';
import { tonAddressFromPrivKey, toNonBounceableTon } from '@/lib/crypto/ton-tx';
import { tonMnemonicEnabled } from '@/lib/ton-mnemonic-config';

const SLOW = 180_000;
const DUAL =
  'sword tattoo water unknown claw drill evoke circle cannon soccer defense agent ' +
  'vivid bulb awkward raise extend amount honey picnic flat deny ten awake';
// Valid 24-word BIP39 phrase that is NOT a TON mnemonic.
const BIP39_ONLY_24 =
  'poem allow term setup trip flag alarm bitter glow gas lobster wage topic net ' +
  'clown void wagon chuckle protect useful zone drastic chicken slim';
const TWELVE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

afterEach(() => {
  delete process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED;
});

describe('feature flag', () => {
  it('is OFF by default and ON only for the exact string "true"', () => {
    expect(tonMnemonicEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED = '1';
    expect(tonMnemonicEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED = 'true';
    expect(tonMnemonicEnabled()).toBe(true);
  });
});

describe('generation', () => {
  it('generateDualValidMnemonic → 24 words valid as BIP39 AND TON', async () => {
    for (let i = 0; i < 3; i++) {
      const p = await generateDualValidMnemonic();
      expect(p.split(' ')).toHaveLength(24);
      expect(bip39.validateMnemonic(p)).toBe(true);
      expect(await mnemonicValidate(p.split(' '))).toBe(true);
    }
  }, SLOW);

  it('new wallet phrase: flag OFF → 12-word BIP39 (unchanged), flag ON → 24-word dual-valid', async () => {
    const off = await generateNewWalletMnemonic();
    expect(off.split(' ')).toHaveLength(12);
    expect(bip39.validateMnemonic(off)).toBe(true);

    process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED = 'true';
    const on = await generateNewWalletMnemonic();
    expect(on.split(' ')).toHaveLength(24);
    expect(await isTonMnemonic(on)).toBe(true);
  }, SLOW);
});

describe('scheme selection is decided by the phrase, not the flag', () => {
  it('24-word TON-valid → native; 12-word and BIP39-only 24-word → legacy', async () => {
    expect(await tonSchemeForPhrase(DUAL)).toBe('ton-mnemonic-v4r2');
    expect(await tonSchemeForPhrase(TWELVE)).toBe('slip10-607-0-0');
    expect(await tonSchemeForPhrase(BIP39_ONLY_24)).toBe('slip10-607-0-0');
    process.env.NEXT_PUBLIC_TON_MNEMONIC_ENABLED = 'true';
    expect(await tonSchemeForPhrase(DUAL)).toBe('ton-mnemonic-v4r2');
    expect(await tonSchemeForPhrase(TWELVE)).toBe('slip10-607-0-0');
  });

  it('tolerates extra whitespace / case like the import form', async () => {
    expect(await isTonMnemonic(`  ${DUAL.toUpperCase().replace(/ /g, '   ')} `)).toBe(true);
  });

  it('TON seed is 32 bytes and deterministic', async () => {
    const a = await tonSeedFromMnemonic(DUAL);
    const b = await tonSeedFromMnemonic(DUAL);
    expect(a).toHaveLength(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('import', () => {
  it('BIP39-only 24-word phrase imports under the legacy SLIP-0010 TON path', async () => {
    const w = await importWalletFromMnemonic(BIP39_ONLY_24, 'pw-123456');
    const seed = await bip39.mnemonicToSeed(BIP39_ONLY_24);
    const { key } = derivePath("m/44'/607'/0'/0'", seed.toString('hex'));
    expect(w.tonScheme).toBe('slip10-607-0-0');
    expect(w.ton).toBe(tonAddressFromPrivKey(key as unknown as Uint8Array));
  }, SLOW);

  it('rejects phrase lengths other than 12 or 24', async () => {
    const fifteen = bip39.generateMnemonic(160);
    expect(bip39.validateMnemonic(fifteen)).toBe(true);
    await expect(importWalletFromMnemonic(fifteen, 'pw-123456')).rejects.toThrow();
  });
});

describe('display', () => {
  it('toNonBounceableTon converts EQ… to UQ… for the same account', () => {
    const eq = 'EQA2qqtv2MASYNxCAjSB740ly2JELsh56uWl1rBeH4jWIs5v';
    const uq = toNonBounceableTon(eq);
    expect(uq).toBe('UQA2qqtv2MASYNxCAjSB740ly2JELsh56uWl1rBeH4jWIpOq');
    expect(Address.parse(uq).equals(Address.parse(eq))).toBe(true);
    expect(toNonBounceableTon('not-an-address')).toBe('not-an-address');
  });
});
