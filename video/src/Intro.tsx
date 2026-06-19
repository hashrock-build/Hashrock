import React from "react";
import {
  AbsoluteFill, Sequence, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring,
} from "remotion";
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { loadFont as loadPixel } from "@remotion/google-fonts/PressStart2P";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { S_TITLE, S_GAME, S_STATS, S_CTA, XFADE, GAMEPLAY_SPEED, C } from "./constants";

const pixel = loadPixel().fontFamily;
const inter = loadInter().fontFamily;

const Crystal: React.FC<{ size: number; glow?: number; rot?: number }> = ({ size, glow = 16, rot = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ filter: `drop-shadow(0 0 ${glow}px rgba(143,228,245,.85))`, transform: `rotate(${rot}deg)` }}>
    <polygon points="8,1 3,6 8,15" fill={C.cyan} />
    <polygon points="8,1 13,6 8,15" fill={C.blue} />
    <polygon points="3,6 8,7 8,15" fill="#bff2ff" opacity="0.5" />
  </svg>
);

// animated glow backdrop + drifting crystal particles + faint scanlines
const Backdrop: React.FC<{ tint?: string }> = ({ tint = C.bg2 }) => {
  const f = useCurrentFrame();
  const parts = Array.from({ length: 16 }, (_, i) => i);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1300px 760px at 50% 42%, ${tint} 0%, ${C.bg} 62%)` }}>
      {parts.map((i) => {
        const x = ((i * 137) % 100);
        const baseY = ((i * 53) % 100);
        const y = (baseY + (f * (0.15 + (i % 5) * 0.05))) % 110 - 5;
        const s = 6 + (i % 4) * 5;
        const op = 0.12 + 0.12 * Math.abs(Math.sin((f + i * 20) / 30));
        return <div key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, opacity: op }}><Crystal size={s} glow={6} rot={(f + i * 30) % 360} /></div>;
      })}
      <AbsoluteFill style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 2px, transparent 2px 4px)", opacity: 0.5 }} />
    </AbsoluteFill>
  );
};

const fadeIn = (f: number, len = 10) => interpolate(f, [0, len], [0, 1], { extrapolateRight: "clamp" });

// ---------- Scene 1: title build ----------
const TitleScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 12, stiffness: 130, mass: 0.8 } });
  const scale = interpolate(pop, [0, 1], [0.55, 1]);
  const glow = 24 + Math.sin(f / 5) * 16;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop />
      <div style={{ textAlign: "center", transform: `scale(${scale})` }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
          <Crystal size={104} glow={glow} rot={interpolate(pop, [0, 1], [-40, 0])} />
        </div>
        <div style={{ fontFamily: pixel, fontSize: 124, color: C.cyan, letterSpacing: 4, textShadow: `7px 7px 0 ${C.ink}, 0 0 ${glow}px rgba(143,228,245,.9)` }}>HASHROCK</div>
        <div style={{ fontFamily: inter, fontWeight: 700, fontSize: 36, color: C.white, letterSpacing: 16, marginTop: 28, opacity: interpolate(f, [12, 28], [0, 1], { extrapolateRight: "clamp" }), transform: `translateY(${interpolate(f, [12, 28], [16, 0], { extrapolateRight: "clamp" })}px)` }}>
          MINE-TO-EARN&nbsp;&nbsp;·&nbsp;&nbsp;ON SOLANA
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 2: gameplay showcase with kinetic callouts ----------
const Callout: React.FC<{ icon: string; text: string }> = ({ icon, text }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inS = spring({ frame: f, fps, config: { damping: 16, stiffness: 120 } });
  const x = interpolate(inS, [0, 1], [-520, 0]);
  const out = interpolate(f, [95, 108], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 56, bottom: 120, transform: `translateX(${x}px)`, opacity: out, display: "flex", alignItems: "center", gap: 18,
      background: "linear-gradient(90deg, rgba(10,8,22,.92), rgba(10,8,22,.55))", borderLeft: `6px solid ${C.cyan}`, borderRadius: 14, padding: "18px 30px 18px 24px", boxShadow: "0 10px 40px rgba(0,0,0,.5)" }}>
      <span style={{ fontSize: 46 }}>{icon}</span>
      <span style={{ fontFamily: inter, fontWeight: 700, fontSize: 44, color: C.white }}>{text}</span>
    </div>
  );
};

const GameScene: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo src={staticFile("gameplay.mp4")} playbackRate={GAMEPLAY_SPEED} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill style={{ boxShadow: "inset 0 0 260px rgba(0,0,0,.6)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,5,18,.65) 0%, transparent 18%, transparent 72%, rgba(7,5,18,.8) 100%)" }} />
      {/* persistent brand */}
      <div style={{ position: "absolute", top: 44, left: 50, display: "flex", alignItems: "center", gap: 16, opacity: fadeIn(f) }}>
        <Crystal size={42} glow={10} />
        <span style={{ fontFamily: pixel, fontSize: 32, color: "#fff", textShadow: `3px 3px 0 ${C.ink}` }}>HASHROCK</span>
      </div>
      <div style={{ position: "absolute", top: 50, right: 52, fontFamily: pixel, fontSize: 20, color: C.ink, background: C.gold, padding: "10px 16px", borderRadius: 10, opacity: fadeIn(f) }}>{GAMEPLAY_SPEED}× SPEED</div>
      <div style={{ position: "absolute", bottom: 46, right: 52, fontFamily: inter, fontWeight: 800, fontSize: 40, color: "#fff", textShadow: "0 2px 14px rgba(0,0,0,.7)", opacity: fadeIn(f) }}>hashrock.lol</div>
      {/* sequenced callouts */}
      <Sequence from={12} durationInFrames={110}><Callout icon="⛏" text="Ore spawns from the live blockhash" /></Sequence>
      <Sequence from={122} durationInFrames={110}><Callout icon="🪙" text="Mine it → earn in-game coins" /></Sequence>
      <Sequence from={232} durationInFrames={113}><Callout icon="💎" text="Redeem 1:1 for $HASHROCK" /></Sequence>
    </AbsoluteFill>
  );
};

// ---------- Scene 3: stats / value props ----------
const StatCard: React.FC<{ delay: number; value: string; label: string; accent: string }> = ({ delay, value, label, accent }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 14, stiffness: 130 } });
  const op = interpolate(f - delay, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ opacity: op, transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px) scale(${interpolate(s, [0, 1], [0.85, 1])})`,
      width: 380, padding: "40px 24px", borderRadius: 22, textAlign: "center",
      background: "linear-gradient(180deg, rgba(28,36,68,.85), rgba(12,16,34,.85))", border: `1px solid ${accent}55`,
      boxShadow: `0 0 0 1px ${accent}22, 0 20px 60px rgba(0,0,0,.5), inset 0 0 40px ${accent}14` }}>
      <div style={{ fontFamily: pixel, fontSize: 64, color: accent, textShadow: `4px 4px 0 ${C.ink}` }}>{value}</div>
      <div style={{ fontFamily: inter, fontWeight: 600, fontSize: 30, color: C.white, marginTop: 18, letterSpacing: 1 }}>{label}</div>
    </div>
  );
};

const StatsScene: React.FC = () => {
  const f = useCurrentFrame();
  const supply = Math.round(interpolate(f, [8, 46], [0, 500], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop tint="#16234a" />
      <div style={{ position: "absolute", top: "17%", width: "100%", textAlign: "center", fontFamily: inter, fontWeight: 800, fontSize: 44, color: C.cyan, letterSpacing: 10, opacity: fadeIn(f), textShadow: "0 0 26px rgba(143,228,245,.5)" }}>
        BUILT TO STAY SOLVENT
      </div>
      <div style={{ display: "flex", gap: 34 }}>
        <StatCard delay={6} value={`${supply}K`} label="fixed supply" accent={C.gold} />
        <StatCard delay={16} value="1:1" label="treasury-backed" accent={C.cyan} />
        <StatCard delay={26} value="0%" label="inflation" accent={C.green} />
      </div>
      <div style={{ position: "absolute", bottom: "15%", width: "100%", textAlign: "center", fontFamily: inter, fontWeight: 600, fontSize: 38, color: C.white, opacity: interpolate(f, [40, 58], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        Earning is <span style={{ color: C.cyan }}>redistribution</span>, not emission.
      </div>
    </AbsoluteFill>
  );
};

// ---------- Scene 4: CTA ----------
const CTAScene: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 15, stiffness: 110 } });
  const glow = 22 + Math.sin(f / 5) * 14;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <Backdrop tint="#1a2a52" />
      <div style={{ textAlign: "center", transform: `translateY(${interpolate(pop, [0, 1], [44, 0])}px)`, opacity: fadeIn(f, 8) }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}><Crystal size={86} glow={glow} /></div>
        <div style={{ fontFamily: inter, fontWeight: 800, fontSize: 40, color: C.white, letterSpacing: 14 }}>PLAY NOW</div>
        <div style={{ fontFamily: pixel, fontSize: 92, color: C.gold, marginTop: 22, textShadow: `6px 6px 0 ${C.ink}, 0 0 ${glow}px rgba(255,210,63,.6)` }}>hashrock.lol</div>
        <div style={{ fontFamily: inter, fontWeight: 600, fontSize: 38, color: C.cyan, marginTop: 30 }}>$HASHROCK · launching on Orynth</div>
        <div style={{ fontFamily: inter, fontWeight: 500, fontSize: 30, color: "#9fb0d8", marginTop: 14 }}>@playhashrock</div>
      </div>
    </AbsoluteFill>
  );
};

export const Intro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={S_TITLE}><TitleScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XFADE })} />
        <TransitionSeries.Sequence durationInFrames={S_GAME}><GameScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={slide({ direction: "from-bottom" })} timing={springTiming({ config: { damping: 200 }, durationInFrames: XFADE })} />
        <TransitionSeries.Sequence durationInFrames={S_STATS}><StatsScene /></TransitionSeries.Sequence>
        <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: XFADE })} />
        <TransitionSeries.Sequence durationInFrames={S_CTA}><CTAScene /></TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
