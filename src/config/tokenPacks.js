/**
 * All purchasable token / publishing-credit packs.
 * Each credit = one Vercel deploy ("Go Live").
 * Imported by both the payments controller and the public packs endpoint.
 */
export const TOKEN_PACKS = [
  {
    id: 'pack_1',
    credits: 1,
    amountUsd: 5,
    label: 'Starter',
    description: 'Perfect for trying out your first site.',
    popular: false,
  },
  {
    id: 'pack_5',
    credits: 5,
    amountUsd: 20,
    label: 'Builder',
    description: 'Launch five sites and save 20%.',
    popular: false,
  },
  {
    id: 'pack_10',
    credits: 10,
    amountUsd: 35,
    label: 'Growth',
    description: 'Best value for growing businesses.',
    popular: true,
  },
  {
    id: 'pack_20',
    credits: 20,
    amountUsd: 60,
    label: 'Studio',
    description: 'Ideal for agencies and freelancers.',
    popular: false,
  },
  {
    id: 'pack_40',
    credits: 40,
    amountUsd: 100,
    label: 'Agency',
    description: 'Maximum credits at the best per-site price.',
    popular: false,
  },
];

/** Map from pack id → pack object for O(1) look-ups */
export const TOKEN_PACK_MAP = Object.fromEntries(TOKEN_PACKS.map((p) => [p.id, p]));

/** All valid productType values (legacy + pack ids) */
export const VALID_PRODUCT_TYPES = ['go_live', ...TOKEN_PACKS.map((p) => p.id)];
