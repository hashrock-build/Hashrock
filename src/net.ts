// Thin networking layer: connect to the authoritative Colyseus server and join the
// shared "mine" room. A persistent playerId (localStorage) lets balances survive reloads.
import { Client, Room, getStateCallbacks } from "colyseus.js";

// Production sets VITE_SERVER_URL (e.g. wss://api.playhashrock.com) at build time; dev falls
// back to the local Colyseus on :2567. httpBase derives the matching http(s) origin (for /stats).
const SERVER_URL = ((import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env?.VITE_SERVER_URL || "").replace(/\/$/, "");
const wsBase = (): string => SERVER_URL || `ws://${location.hostname}:2567`;
const httpBase = (): string => wsBase().replace(/^ws/, "http"); // ws→http, wss→https

export function getPlayerId(): string {
  let id = localStorage.getItem("hashrock_pid");
  if (!id) {
    id = (crypto as Crypto).randomUUID?.() ?? `p_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    localStorage.setItem("hashrock_pid", id);
  }
  return id;
}

export interface Net { room: Room; $: ReturnType<typeof getStateCallbacks>; }

/** Fetch a one-time login nonce from the server (for replay-safe wallet sign-in). */
export async function getNonce(): Promise<string | null> {
  try { return String((await (await fetch(`${httpBase()}/nonce`)).json()).nonce || "") || null; }
  catch { return null; }
}

export async function connect(name = "miner", playerId = getPlayerId(), auth?: { msg: string; sig: string }, zone = "village"): Promise<Net> {
  const client = new Client(wsBase());
  const roomName = zone === "cave" ? "cave" : zone === "forge" ? "forge" : zone === "garden" ? "garden" : "mine"; // zones: village=mine, cave, forge, garden
  const room = await client.joinOrCreate(roomName, { playerId, name, msg: auth?.msg, sig: auth?.sig });
  const $ = getStateCallbacks(room);
  return { room, $ };
}

/** Lightweight: live landing-page stats (miners online, active ore) via the server /stats route. */
export async function roomStats(): Promise<{ online: number; ore: number; mint: string }> {
  try {
    const res = await fetch(`${httpBase()}/stats`);
    const j = await res.json();
    return { online: Number(j.online) || 0, ore: Number(j.ore) || 0, mint: String(j.mint || "") };
  } catch { return { online: 0, ore: 0, mint: "" }; }
}
