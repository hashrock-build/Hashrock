import React from "react";
import {
  AbsoluteFill, Sequence, OffthreadVideo, staticFile,
  useCurrentFrame, useVideoConfig, interpolate, spring,
} from "remotion";
import { loadFont as loadPixel } from "@remotion/google-fonts/PressStart2P";
import { loadFont as loadMono } from "@remotion/google-fonts/VT323";
import { INTRO, OUTRO, GAMEPLAY, SPEED, C } from "./constants";

const pixel = loadPixel().fontFamily;
const mono = loadMono().fontFamily;

const Crystal: React.FC<{ size: number; glow?: number }> = ({ size, glow = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" style={{ filter: `drop-shadow(0 0 ${glow}px rgba(143,228,245,.8))` }}>
    <polygon points="8,1 3,6 8,15" fill={C.cyan} />
    <polygon points="8,1 13,6 8,15" fill={C.blue} />
  </svg>
);

// dark themed backdrop with a cyan glow + subtle scanlines (pixel vibe)
const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 38%, #1a2342 0%, ${C.bg} 60%)` }}>
    <AbsoluteFill style={{
      backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.03) 0 2px, transparent 2px 4px)",
      opacity: 0.6,
    }} />
  </AbsoluteFill>
);

const fadeIn = (frame: number, len = 8) => interpolate(frame, [0, len], [0, 1], { extrapolateRight: "clamp" });

// ---- title card ----
const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 120 } });
  const scale = interpolate(pop, [0, 1], [0.6, 1]);
  const glow = 22 + Math.sin(frame / 5) * 14;
  const out = interpolate(frame, [INTRO - 10, INTRO], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: out }}>
      <Backdrop />
      <div style={{ transform: `scale(${scale})`, textAlign: "center", opacity: fadeIn(frame) }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
          <Crystal size={92} glow={glow} />
        </div>
        <div style={{
          fontFamily: pixel, fontSize: 118, color: C.cyan, letterSpacing: 4,
          textShadow: `6px 6px 0 ${C.ink}, 0 0 ${glow}px rgba(143,228,245,.9)`,
        }}>HASHROCK</div>
        <div style={{
          fontFamily: mono, fontSize: 46, color: "#e6f6ff", marginTop: 26,
          opacity: interpolate(frame, [10, 26], [0, 1], { extrapolateRight: "clamp" }),
        }}>Mine the blockhash. Earn <span style={{ color: C.gold }}>$HASHROCK</span>.</div>
      </div>
    </AbsoluteFill>
  );
};

// ---- gameplay (sped up) with light corner overlays ----
const Gameplay: React.FC = () => {
  const frame = useCurrentFrame();
  const o = fadeIn(frame, 10);
  const inOut = Math.min(o, interpolate(frame, [GAMEPLAY - 10, GAMEPLAY], [1, 0], { extrapolateLeft: "clamp" }));
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", opacity: inOut }}>
      <OffthreadVideo
        src={staticFile("gameplay.mp4")}
        playbackRate={SPEED}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      {/* vignette + top/bottom gradient for legibility */}
      <AbsoluteFill style={{ boxShadow: "inset 0 0 240px rgba(0,0,0,.55)", pointerEvents: "none" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(8,6,18,.5) 0%, transparent 16%, transparent 80%, rgba(8,6,18,.6) 100%)" }} />
      {/* wordmark top-left */}
      <div style={{ position: "absolute", top: 40, left: 46, display: "flex", alignItems: "center", gap: 16 }}>
        <Crystal size={40} glow={10} />
        <span style={{ fontFamily: pixel, fontSize: 30, color: "#fff", textShadow: `3px 3px 0 ${C.ink}` }}>HASHROCK</span>
      </div>
      {/* speed badge top-right */}
      <div style={{
        position: "absolute", top: 46, right: 48, fontFamily: pixel, fontSize: 22, color: C.ink,
        background: C.gold, padding: "10px 16px", borderRadius: 10, boxShadow: "0 4px 0 rgba(0,0,0,.35)",
      }}>{SPEED}× SPEED</div>
      {/* domain bottom-left */}
      <div style={{
        position: "absolute", bottom: 44, left: 46, fontFamily: mono, fontSize: 40, color: "#fff",
        background: "rgba(10,8,20,.65)", border: `2px solid ${C.cyan}`, padding: "6px 20px", borderRadius: 12,
      }}>hashrock.lol</div>
    </AbsoluteFill>
  );
};

// ---- outro / CTA ----
const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 16, stiffness: 110 } });
  const glow = 20 + Math.sin(frame / 5) * 12;
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: fadeIn(frame, 10) }}>
      <Backdrop />
      <div style={{ textAlign: "center", transform: `translateY(${interpolate(pop, [0, 1], [40, 0])}px)` }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}><Crystal size={74} glow={glow} /></div>
        <div style={{ fontFamily: pixel, fontSize: 56, color: "#fff", letterSpacing: 2, textShadow: `5px 5px 0 ${C.ink}` }}>PLAY NOW</div>
        <div style={{
          fontFamily: pixel, fontSize: 78, color: C.gold, marginTop: 22,
          textShadow: `5px 5px 0 ${C.ink}, 0 0 ${glow}px rgba(255,210,63,.6)`,
        }}>hashrock.lol</div>
        <div style={{ fontFamily: mono, fontSize: 40, color: C.cyan, marginTop: 26, letterSpacing: 1 }}>
          mine-to-earn · on Solana
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Intro: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Sequence durationInFrames={INTRO} name="Title"><TitleCard /></Sequence>
      <Sequence from={INTRO} durationInFrames={GAMEPLAY} name="Gameplay"><Gameplay /></Sequence>
      <Sequence from={INTRO + GAMEPLAY} durationInFrames={OUTRO} name="Outro"><Outro /></Sequence>
    </AbsoluteFill>
  );
};
