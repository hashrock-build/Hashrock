// Thin networking layer: connect to the authoritative Colyseus server and join the
// shared "mine" room. A persistent playerId (localStorage) lets balances survive reloads.
import { Client, Room, getStateCallbacks } from "colyseus.js";

const SERVER_PORT = 2567;

export function getPlayerId(): string {
  let id = localStorage.getItem("hashrock_pid");
  if (!id) {
    id = (crypto as Crypto).randomUUID?.() ?? `p_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    localStorage.setItem("hashrock_pid", id);
  }
  return id;
}

export interface Net { room: Room; $: ReturnType<typeof getStateCallbacks>; }

export async function connect(name = "miner", playerId = getPlayerId()): Promise<Net> {
  const client = new Client(`ws://${location.hostname}:${SERVER_PORT}`);
  const room = await client.joinOrCreate("mine", { playerId, name });
  const $ = getStateCallbacks(room);
  return { room, $ };
}

/** Lightweight: live landing-page stats (miners online, active ore) via the server /stats route. */
export async function roomStats(): Promise<{ online: number; ore: number; mint: string }> {
  try {
    const res = await fetch(`http://${location.hostname}:${SERVER_PORT}/stats`);
    const j = await res.json();
    return { online: Number(j.online) || 0, ore: Number(j.ore) || 0, mint: String(j.mint || "") };
  } catch { return { online: 0, ore: 0, mint: "" }; }
}
