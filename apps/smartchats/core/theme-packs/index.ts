import type { PairedDesignPack } from '../types';
import { defaultPack } from './default';
import { midnightPack } from './midnight';
import { neonTerminalPack } from './neon_terminal';
import { zenPack } from './zen';
import { brutalistPack } from './brutalist';
import { auroraPack } from './aurora';
import { cryptoGoldPack } from './crypto_gold';
import { creativePack } from './creative';
import { oledBlackPack } from './oled_black';
import { devToolsPack } from './dev_tools';

/**
 * Design pack registry.
 * Add new packs here — they become available in the runtime pack switcher.
 */
export const designPacks: Record<string, PairedDesignPack> = {
  default: defaultPack,
  midnight: midnightPack,
  neon_terminal: neonTerminalPack,
  zen: zenPack,
  brutalist: brutalistPack,
  aurora: auroraPack,
  crypto_gold: cryptoGoldPack,
  creative: creativePack,
  oled_black: oledBlackPack,
  dev_tools: devToolsPack,
};

export function getDesignPack(id: string): PairedDesignPack | undefined {
  return designPacks[id];
}

export function listDesignPacks(): PairedDesignPack[] {
  return Object.values(designPacks);
}

export {
  defaultPack, midnightPack, neonTerminalPack, zenPack,
  brutalistPack, auroraPack, cryptoGoldPack, creativePack,
  oledBlackPack, devToolsPack,
};
