import { SHIP_CLASS_SCALE, type ShipSnapshot } from '../shared/protocol';
import { EMBLEM_COUNT } from './Textures';
import type { HullClass, ShipLivery } from './Ship';

/** Who owns which paint. Kept out of main.ts because it is purely an art
 * decision and main.ts is the file every other agent is also editing.
 *
 * Before this, EVERY hull in the game was `0x6b4a2c` — one flat brown — and
 * the only thing distinguishing a bot from another captain from you was the
 * sail tint on a sail too small and too flatly shaded to read. A ship's
 * identity now lives in its ACCENT: the painted band on the bulwark, the
 * caprail that traces the sheer, the gunport lids, the taffrail and the
 * masthead pennant all share it, so it's legible from behind at chase
 * distance where a sail tint isn't.
 */

/** Rival captains: a named, recurring antagonist gets a full colour scheme. */
const RIVAL_SCHEMES = [
  { accent: 0x8a3fd6, sail: 0x6d3aa8, plank: 0x2b1a3a, bulwark: 0x241531 },
  { accent: 0x3fb8d6, sail: 0x2f7f96, plank: 0x1a2f3a, bulwark: 0x152631 },
  { accent: 0xd68a3f, sail: 0x9c6a33, plank: 0x3a2a1a, bulwark: 0x312316 },
  { accent: 0x3fd66b, sail: 0x379c54, plank: 0x1a3a22, bulwark: 0x16311d },
  { accent: 0xd63f5a, sail: 0x9c3444, plank: 0x3a1a1a, bulwark: 0x311616 },
  { accent: 0xd6d63f, sail: 0x9c9c33, plank: 0x2a2a2a, bulwark: 0x232323 },
];

/** Human captains keep an honest wooden hull and are told apart by trim. */
const CAPTAIN_ACCENTS = [0x3f8fd6, 0x46b06a, 0xd6553f, 0x9a5fd6, 0x2fb5b0, 0xe08a2a, 0xc3ccd6, 0xc9962f];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface ShipVisualOptions {
  scale: number;
  masts: 1 | 2;
  hullClass: HullClass;
  livery: ShipLivery;
  seed: number;
}

export function shipVisualOptions(isYou: boolean, ship: ShipSnapshot): ShipVisualOptions {
  const seed = hashString(ship.name || ship.id);

  // Two masts and a galleon-shaped hull (stepped sterncastle, fuller beam) for
  // anything bigger than a sloop, so class reads structurally and not just as
  // "the same ship, larger."
  if (ship.isBoss) {
    return {
      scale: 1.5,
      masts: 2,
      hullClass: 2,
      seed,
      livery: {
        plank: 0x231c17,
        bottom: 0x3a1410,
        boot: 0x0b0908,
        wale: 0x0f0b09,
        bulwark: 0x1a1211,
        accent: 0xa8161b,
        deck: 0x50412f,
        sail: 0x7d1414,
        emblem: 0,
      },
    };
  }

  if (ship.isRival) {
    const s = RIVAL_SCHEMES[seed % RIVAL_SCHEMES.length];
    return {
      scale: 1.2,
      masts: 2,
      hullClass: 2,
      seed,
      livery: {
        plank: s.plank,
        bottom: 0x4a2018,
        boot: 0x0e0b09,
        wale: 0x140f0c,
        bulwark: s.bulwark,
        accent: s.accent,
        deck: 0x6c5636,
        sail: s.sail,
        emblem: 1 + (seed % (EMBLEM_COUNT - 1)),
      },
    };
  }

  // Bots read as drab, small and unpainted: no gold, weathered canvas, a dull
  // oxide stripe. A player should never squint at a shape and wonder whether
  // it's a person.
  if (ship.isBot) {
    return {
      scale: 0.9,
      masts: 1,
      hullClass: 0,
      seed,
      livery: {
        plank: 0x54402d,
        bottom: 0x5e3b2c,
        boot: 0x191309,
        wale: 0x2b1e13,
        bulwark: 0x46331f,
        accent: 0x8b3a2a,
        deck: 0x7e6340,
        sail: 0xc0b49b,
        emblem: 2 + (seed % 3),
      },
    };
  }

  const scale = SHIP_CLASS_SCALE[ship.shipClass];
  const masts: 1 | 2 = ship.shipClass === 'sloop' ? 1 : 2;
  const hullClass: HullClass = ship.shipClass === 'sloop' ? 0 : ship.shipClass === 'brigantine' ? 1 : 2;

  const base: ShipLivery = {
    plank: 0x7a5330,
    bottom: 0x8f4030,
    boot: 0x15110d,
    wale: 0x2e1d11,
    bulwark: 0x5a3220,
    accent: 0xd9a72c,
    deck: 0xa8814f,
    // Slightly off-white canvas rather than near-pure white — the brighter
    // value clipped to a flat highlight under the sun and lost the billow.
    sail: 0xe0d6bc,
    emblem: 0,
  };

  // Your own ship: gold trim and the skull. It is the one object the player
  // looks at for the whole session, so it gets the strongest scheme in the
  // game and nothing else is allowed to use gold-on-oak.
  if (isYou) return { scale, masts, hullClass, seed, livery: base };

  return {
    scale,
    masts,
    hullClass,
    seed,
    livery: {
      ...base,
      accent: CAPTAIN_ACCENTS[seed % CAPTAIN_ACCENTS.length],
      sail: 0xd7d2c4,
      emblem: 1 + (seed % (EMBLEM_COUNT - 1)),
    },
  };
}
