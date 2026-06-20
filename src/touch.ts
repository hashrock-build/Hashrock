// Mobile touch controls: a left virtual joystick (move) + a right mine button. Shown only on
// touch devices. Feeds the same World.setMove / World.mine the keyboard path uses.
import type { World } from "./world";

const isTouch = () =>
  matchMedia("(pointer: coarse)").matches || "ontouchstart" in window || navigator.maxTouchPoints > 0;

export function initTouchControls(world: World): void {
  if (!isTouch() || document.getElementById("touchPad")) return;
  document.body.classList.add("touch"); // drives the mobile HUD CSS (menu, hidden feed, rotate hint)

  const css = (el: HTMLElement, s: Partial<CSSStyleDeclaration>) => Object.assign(el.style, s);

  // ── joystick (bottom-left) ──
  const pad = document.createElement("div");
  pad.id = "touchPad"; pad.className = "touch-controls";
  css(pad, {
    position: "fixed", left: "18px", bottom: "20px", width: "130px", height: "130px",
    borderRadius: "50%", background: "rgba(20,18,30,.38)", border: "2px solid rgba(255,255,255,.22)",
    touchAction: "none", zIndex: "60", userSelect: "none",
  });
  const knob = document.createElement("div");
  css(knob, {
    position: "absolute", left: "50%", top: "50%", width: "58px", height: "58px",
    marginLeft: "-29px", marginTop: "-29px", borderRadius: "50%",
    background: "rgba(255,210,63,.55)", border: "2px solid rgba(255,255,255,.5)", pointerEvents: "none",
  });
  pad.appendChild(knob);

  const R = 50; // max knob travel (px)
  let active = -1; // pointerId
  const reset = () => { active = -1; knob.style.transform = ""; world.setMove(0, 0); };
  pad.addEventListener("pointerdown", (e) => { active = e.pointerId; pad.setPointerCapture(e.pointerId); drive(e); });
  pad.addEventListener("pointermove", (e) => { if (e.pointerId === active) drive(e); });
  pad.addEventListener("pointerup", (e) => { if (e.pointerId === active) reset(); });
  pad.addEventListener("pointercancel", reset);
  function drive(e: PointerEvent) {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy) || 1, k = Math.min(1, len / R);
    const nx = (dx / len) * k, ny = (dy / len) * k;
    knob.style.transform = `translate(${nx * R}px, ${ny * R}px)`;
    world.setMove(Math.abs(nx) < 0.18 ? 0 : nx, Math.abs(ny) < 0.18 ? 0 : ny); // small dead-zone
  }

  // ── mine button (bottom-right) ──
  const btn = document.createElement("button");
  btn.id = "touchMine"; btn.className = "touch-controls"; btn.textContent = "⛏";
  css(btn, {
    position: "fixed", right: "22px", bottom: "30px", width: "84px", height: "84px",
    borderRadius: "50%", fontSize: "34px", lineHeight: "84px", padding: "0",
    background: "rgba(255,210,63,.9)", color: "#1a1330", border: "3px solid rgba(255,255,255,.6)",
    touchAction: "none", zIndex: "60", userSelect: "none",
  });
  btn.addEventListener("pointerdown", (e) => { e.preventDefault(); world.mine(); btn.style.transform = "scale(.9)"; });
  const up = () => (btn.style.transform = "");
  btn.addEventListener("pointerup", up); btn.addEventListener("pointercancel", up);

  document.body.append(pad, btn);
}
