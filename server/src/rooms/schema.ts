// Colyseus synchronized state. The SERVER mutates these; clients receive patches and
// render. Anything economic (coins, pool) is authoritative here and mirrored to Postgres.
import { Schema, type, MapSchema } from "@colyseus/schema";

export class OreState extends Schema {
  @type("number") id = 0;
  @type("number") gx = 0;
  @type("number") gy = 0;
  @type("number") hp = 0;
  @type("number") maxHp = 0;
  @type("string") blockhash = "";
}

export class PlayerState extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("string") name = "";
  @type("number") coins = 0;       // off-chain balance (mirror of DB)
  @type("number") throughput = 1;  // mining-speed multiplier (derived from axe rarity)
  @type("number") miningOreId = 0; // 0 = not mining
  @type("number") body = 0;        // character body id (0=Rookie, 1=Hunter)
  @type("number") skin = 0;        // outfit/body tint id
  @type("number") hair = 0;        // hair cosmetic id
  @type("number") hat = 0;         // hat cosmetic id
  @type("number") axe = 0;         // equipped axe rarity id (drives throughput)
  @type("number") axeOwned = 0;    // highest axe tier owned (bought on-chain)
  @type("number") durability = 100; // axe durability; drops while mining, restored by repair
}

export class MineState extends Schema {
  @type({ map: OreState }) ores = new MapSchema<OreState>();
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("number") pool = 0;        // Reward Pool (coins) — authoritative
  @type("number") creator = 0;     // creator revenue (coins)
  @type("number") treasury = 0;    // $HASHROCK backing all coins (1:1)
  @type("number") cap = 150;       // FIFO cap
  @type("number") mapSeed = 0;     // village seed; client regenerates the same map
}
