// Smoke-test the REAL chain.ts money path against the live mainnet mint (read-only — no sends).
// Confirms initChain() resolves decimals from chain, the TOKEN_DECIMALS hard-check passes, the
// treasury secret loads, and treasuryBalance() converts raw→coins correctly.
//   SOLANA_RPC=<rpc> tsx scripts/verify-chain.ts
process.env.SOLANA_RPC ||= "https://api.mainnet-beta.solana.com";
process.env.HASHROCK_MINT ||= "B4z8tBZ7MmdQrGMuMx4wfKGSq1YLPwcfBixzUBLe9ory";
process.env.TOKEN_DECIMALS ||= "6";
process.env.SOLANA_CLUSTER ||= "mainnet-beta";
process.env.TREASURY_SECRET_PATH ||= "./.treasury.mainnet.json";

const chain = await import("../src/chain.ts");
await chain.initChain();
console.log("treasuryAddress :", chain.treasuryAddress());
console.log("mintAddress     :", chain.mintAddress());
console.log("treasuryBalance :", await chain.treasuryBalance(), "coins (expect ~23912)");
console.log("explorer sample :", chain.explorer("EXAMPLESIG"));
process.exit(0);
