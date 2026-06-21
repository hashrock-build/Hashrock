// VIP Club — on-chain holder tiers. A player's tier is derived from the $HASHROCK they HOLD in
// their wallet (server-authoritative, read from chain), NOT from anything they can grind.
//
// ⚠ ECONOMIC INVARIANT: VIP perks are STATUS + ACCESS only — visible badge, nameplate colour, and
// zone entry (Cave/Forge already gate on the same thresholds). VIP must NEVER grant an earning/
// throughput boost (that would be a whale drain on the fixed pie). The flex itself is the value:
// holding more shows a brighter badge to everyone, which drives token demand without minting a coin.
export interface VipTier {
  id: number;
  name: string;
  min: number;    // $HASHROCK held to reach this tier
  color: number;  // badge + nameplate colour
  badge: string;  // glyph shown above the player's head ("" = no badge)
  perk: string;   // human-readable perk summary (shown in the VIP Club panel)
}

export const VIP_TIERS: VipTier[] = [
  { id: 0, name: "None",    min: 0,       color: 0x9aa0a8, badge: "",  perk: "Hold $HASHROCK to join the VIP Club" },
  { id: 1, name: "Member",  min: 100,     color: 0x8fd0ff, badge: "★", perk: "Cave access · Member badge" },
  { id: 2, name: "Silver",  min: 500,     color: 0xd6dde6, badge: "✦", perk: "Forge access · Silver badge" },
  { id: 3, name: "Gold",    min: 2_000,   color: 0xffd23f, badge: "♛", perk: "Gold badge · golden nameplate" },
  { id: 4, name: "Diamond", min: 10_000,  color: 0x8fe4f5, badge: "♛", perk: "Diamond badge · prismatic nameplate · top-tier flex" },
];

/** Highest tier id a holder qualifies for, given their $HASHROCK balance. */
export const vipTier = (held: number): number => {
  let t = 0;
  for (const v of VIP_TIERS) if (held >= v.min) t = v.id;
  return t;
};

export const vipOf = (held: number): VipTier => VIP_TIERS[vipTier(held)] ?? VIP_TIERS[0];

/** $HASHROCK still needed to reach the next tier (0 if already at the top). */
export const vipToNext = (held: number): { next: VipTier | null; need: number } => {
  const t = vipTier(held);
  const next = VIP_TIERS[t + 1] ?? null;
  return { next, need: next ? Math.max(0, next.min - held) : 0 };
};
