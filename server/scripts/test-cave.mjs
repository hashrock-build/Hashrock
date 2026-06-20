import { buildCave, MAP_W, MAP_H, T_WALL, idx } from "../../shared/mapgen.ts";
const c = buildCave();
let wall=0, floor=0; for (let i=0;i<MAP_W*MAP_H;i++){ if(c.terrain[i]===T_WALL) wall++; else floor++; }
console.log(`size ${MAP_W}x${MAP_H} | wall ${wall} | floor ${floor} | freeCells ${c.freeCells.length} | props ${c.props.length} | decor ${c.decor.length}`);
console.log(`spawn (${c.spawn.gx},${c.spawn.gy}) blocked=${!!c.blocked[idx(c.spawn.gx,c.spawn.gy)]}`);
// sanity: are all freeCells reachable from spawn? (re-flood and compare)
const W=MAP_W,H=MAP_H, reach=new Uint8Array(W*H), st=[idx(c.spawn.gx,c.spawn.gy)]; reach[st[0]]=1;
const isFloor=(i)=> c.terrain[i]!==T_WALL && !c.blocked[i];
while(st.length){const i=st.pop(),x=i%W,y=(i/W)|0; for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=W||ny>=H)continue;const ni=ny*W+nx;if(!reach[ni]&&isFloor(ni)){reach[ni]=1;st.push(ni);}}}
const unreachable = c.freeCells.filter(i=>!reach[i]).length;
console.log(`freeCells reachable from spawn: ${c.freeCells.length-unreachable}/${c.freeCells.length} (unreachable ${unreachable} — must be 0)`);
// ASCII preview: center 60x40 region, downsampled 1:1
console.log("--- preview (center 72x34) ---");
const x0=(W-72)>>1, y0=(H-34)>>1;
for(let y=y0;y<y0+34;y++){let s="";for(let x=x0;x<x0+72;x++){const i=idx(x,y); s+= c.terrain[i]===T_WALL?"#": (c.blocked[i]?"o": (x===c.spawn.gx&&y===c.spawn.gy?"@":"."));} console.log(s);}
