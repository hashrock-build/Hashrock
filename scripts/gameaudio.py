import wave, struct, math, random
SR=44100
def osc(fr, kind="square", duty=0.5):
    f=fr-math.floor(fr)
    if kind=="square": return 1.0 if f<duty else -1.0
    if kind=="tri": return 2*abs(2*f-1)-1
    if kind=="saw": return 2*f-1
    return math.sin(2*math.pi*f)
def env(t,dur,atk,rel):
    if t<atk: return t/atk
    if dur-t<rel: return max(0.0,(dur-t)/rel)
    return 1.0
def write(name, buf, fades=0.003):
    n=len(buf); peak=max(1e-6,max(abs(x) for x in buf)); g=0.9/peak
    fa=int(fades*SR)
    out=bytearray()
    for i in range(n):
        x=math.tanh(buf[i]*g*1.1)*0.92
        if i<fa: x*=i/fa
        if n-i<fa: x*=(n-i)/fa
        out+=struct.pack("<h",int(max(-1,min(1,x))*31000))
    w=wave.open("public/assets/audio/"+name,"wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(bytes(out)); w.close(); print(name, round(n/SR,2),"s")

NT={"C2":65.41,"E2":82.41,"F2":87.31,"G2":98.0,"A2":110.0,
 "C3":130.81,"E3":164.81,"G3":196.0,"A3":220.0,"F3":174.61,"D3":146.83,"B2":123.47,
 "C4":261.63,"D4":293.66,"E4":329.63,"F4":349.23,"G4":392.0,"A4":440.0,"B4":493.88,
 "C5":523.25,"E5":659.25,"G5":783.99,"C6":1046.5}
def note(buf,start,dur,fr,vol,kind="square",duty=0.5,atk=0.01,rel=0.05,vib=0.0):
    s=int(start*SR); ln=int(dur*SR)
    for i in range(ln):
        idx=s+i
        if idx>=len(buf): break
        t=i/SR; ph=fr*(1+vib*math.sin(2*math.pi*5*t))*t
        buf[idx]+=osc(ph,kind,duty)*vol*env(t,dur,atk,rel)
def noise(buf,start,dur,vol,decay=80):
    s=int(start*SR); ln=int(dur*SR)
    for i in range(ln):
        idx=s+i
        if idx>=len(buf): break
        buf[idx]+=(random.random()*2-1)*vol*math.exp(-(i/SR)*decay)

# ---- BGM: calm loopable chiptune, 16s (8 bars @120bpm), prog Am F C G ----
random.seed(3)
DUR=16.0; bgm=[0.0]*int(SR*DUR); beat=0.5; BAR=2.0
prog=[("A2",["A3","C4","E4"]),("F2",["F3","A3","C4"]),("C2",["C4","E4","G4"]),("G2",["G3","B4","D4"])]
t=0.0; bar=0
while t<DUR-0.01:
    root,chord=prog[bar%4]
    # soft pad whole bar
    for n in chord: note(bgm,t,BAR,NT[n]*0.5 if False else NT[n],0.07,"tri",atk=0.08,rel=0.6)
    # soft bass on beats 1 & 3
    note(bgm,t,0.5,NT[root],0.16,"square",duty=0.3,rel=0.1)
    note(bgm,t+1.0,0.5,NT[root],0.14,"square",duty=0.3,rel=0.1)
    # gentle arp 8ths
    for k in range(8):
        nn=chord[k%3]
        note(bgm,t+k*0.25,0.18,NT[nn],0.06,"square",duty=0.5,rel=0.04)
    # very soft hat offbeats
    for k in range(4): noise(bgm,t+0.25+k*0.5,0.03,0.03)
    t+=BAR; bar+=1
write("bgm.wav",bgm,fades=0.012)

# ---- SFX mine: short pick "tik" ----
m=[0.0]*int(SR*0.11); note(m,0,0.07,520,0.5,"square",duty=0.5,atk=0.001,rel=0.05); noise(m,0,0.05,0.35,decay=110); write("sfx_mine.wav",m)
# ---- SFX ore collected: ascending bell C5 E5 G5 C6 ----
o=[0.0]*int(SR*0.5)
for i,nn in enumerate(["C5","E5","G5","C6"]): note(o,i*0.06,0.22,NT[nn],0.4,"tri",atk=0.005,rel=0.18)
write("sfx_ore.wav",o)
# ---- SFX click: tiny blip ----
c=[0.0]*int(SR*0.05); note(c,0,0.04,880,0.4,"square",duty=0.5,atk=0.001,rel=0.03); write("sfx_click.wav",c)
# ---- SFX buy: positive two-note up + chord ----
b=[0.0]*int(SR*0.55)
note(b,0,0.12,NT["G4"],0.35,"square",duty=0.5,rel=0.08)
note(b,0.1,0.4,NT["C5"],0.32,"tri",atk=0.005,rel=0.3)
note(b,0.1,0.4,NT["E5"],0.22,"tri",atk=0.005,rel=0.3)
note(b,0.1,0.4,NT["G5"],0.18,"tri",atk=0.005,rel=0.3)
write("sfx_buy.wav",b)
