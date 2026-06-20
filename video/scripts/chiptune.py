import wave, struct, math, random
SR=44100; DUR=20.2
N=int(SR*DUR)
buf=[0.0]*N
random.seed(7)

def add(start, dur, freq, vol, wave_type="square", duty=0.5, atk=0.005, dec=0.0, rel=0.05, detune=0.0):
    s=int(start*SR); ln=int(dur*SR)
    for i in range(ln):
        idx=s+i
        if idx>=N: break
        t=i/SR
        ph=(freq*(1+detune))*t
        fr=ph-math.floor(ph)
        if wave_type=="square": v=1.0 if fr<duty else -1.0
        elif wave_type=="tri": v=2*abs(2*fr-1)-1
        elif wave_type=="saw": v=2*fr-1
        else: v=math.sin(2*math.pi*fr)
        # AR envelope (+ optional decay to sustain 0.6)
        if t<atk: e=t/atk
        elif dur-t<rel: e=max(0.0,(dur-t)/rel)
        else: e=1.0
        if dec>0 and t>atk: e*= max(0.55, 1.0-(t-atk)/dec*0.45)
        buf[idx]+=v*vol*e

def kick(start):
    s=int(start*SR); ln=int(0.13*SR)
    for i in range(ln):
        idx=s+i
        if idx>=N: break
        t=i/SR; f=120*math.exp(-t*22)+45
        e=math.exp(-t*18)
        buf[idx]+=math.sin(2*math.pi*f*t)*0.55*e

def hat(start,vol=0.08):
    s=int(start*SR); ln=int(0.04*SR)
    for i in range(ln):
        idx=s+i
        if idx>=N: break
        e=math.exp(-(i/SR)*120)
        buf[idx]+=(random.random()*2-1)*vol*e

# note freqs
NT={"C2":65.41,"F2":87.31,"G2":98.00,"A2":110.0,
    "C4":261.63,"E4":329.63,"G4":392.0,"A4":440.0,"F4":349.23,"B3":246.94,"D4":293.66,
    "C5":523.25,"E5":659.25,"G5":783.99,"A5":880.0,"F5":698.46,"D5":587.33,"B4":493.88}
# progression C - G - Am - F (I V vi IV), 2s/bar
prog=[("C2",["C4","E4","G4"],["C5","E5","G5"]),
      ("G2",["G4","B3","D4"],["G5","D5","B4"]),
      ("A2",["A4","C4","E4"],["A5","E5","C5"]),
      ("F2",["F4","A4","C4"],["F5","C5","A5"])]
BAR=2.0; beat=0.5
bar=0; t=0.0
while t<DUR-0.05:
    root,pad,arp = prog[bar%4]
    groove = t>=2.4         # bass+drums kick in after the title
    ending = t>=17.6        # CTA: hold a bright C chord, no groove
    if ending:
        if abs(t-17.6)<0.01:
            for n in ["C4","E4","G4","C5"]: add(t,2.6,NT[n],0.16,"tri",rel=2.4,atk=0.04)
            add(t,2.6,NT["C2"],0.22,"square",duty=0.25,rel=2.4,atk=0.02)
            for i in range(60): hat(t+i*0.012, 0.05*math.exp(-i*0.05))  # cymbal swell
        t+=beat; continue
    # pad (soft triangle, whole bar) at bar starts
    if abs((t%BAR))<0.01:
        for n in pad: add(t,BAR,NT[n],0.10,"tri",rel=0.5,atk=0.05)
    # bass on each beat
    if groove:
        add(t,0.42,NT[root],0.30,"square",duty=0.25,dec=0.3,rel=0.06)
    # arp 16ths within this beat (4 steps)
    seq=arp
    for k in range(4):
        n=seq[(int(t/0.125)+k)%len(seq)]
        add(t+k*0.125,0.11,NT[n],0.15 if not groove else 0.13,"square",duty=0.5,rel=0.03)
    # drums
    if groove:
        bnum=int(round((t%BAR)/beat))
        if bnum in (0,2): kick(t)
        hat(t+0.25); hat(t)  # 8th hats
    t+=beat
    if abs((t%BAR))<0.01: bar+=1

# normalize + soft clip + global fades
peak=max(1e-6,max(abs(x) for x in buf))
g=0.85/peak
for i in range(N):
    x=buf[i]*g
    x=math.tanh(x*1.2)*0.9
    # fade in 0.4s, fade out last 0.5s
    tt=i/SR
    if tt<0.4: x*=tt/0.4
    if DUR-tt<0.5: x*=max(0.0,(DUR-tt)/0.5)
    buf[i]=x

w=wave.open("public/music.wav","wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(b"".join(struct.pack("<h",int(max(-1,min(1,s))*32000)) for s in buf)); w.close()
print("wrote public/music.wav", round(DUR,1),"s")
