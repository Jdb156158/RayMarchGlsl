const canvas = document.querySelector('#canvas');
const stage = document.querySelector('#stage');
const slider = document.querySelector('#separation');
const amount = document.querySelector('#amount');
const explodeButton = document.querySelector('#explode');
const motionButton = document.querySelector('#motion');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Everything, including the metal wires, is an SDF. No models or image textures.
const fragment = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uRotation;
uniform float uTime;
uniform float uSpread;
const float PI = 3.14159265359;

mat2 rotate(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float hexagon(vec2 p, float r) {
  p=abs(p.yx);
  const vec3 k=vec3(-.8660254,.5,.57735027);
  p-=2.*min(dot(k.xy,p),0.)*k.xy;
  p-=vec2(clamp(p.x,-k.z*r,k.z*r),r);
  return length(p)*sign(p.y);
}
float extrude(float d,float z,float halfDepth,float bevel) {
  vec2 w=vec2(d,abs(z)-halfDepth);
  return min(max(w.x,w.y),0.)+length(max(w,0.))-bevel;
}
float circles(vec2 p) {
  float d=10.;
  for(int i=0;i<3;i++) {
    float a=float(i)*2.*PI/3.+PI;
    d=min(d,length(p-.35*vec2(cos(a),sin(a)))-.285);
  }
  return d;
}
float wires(vec2 p) {
  float d=abs(hexagon(p,.671))-.006;
  d=min(d,abs(hexagon(p,.849))-.017);
  for(int i=0;i<3;i++) {
    float a=float(i)*2.*PI/3.+PI;
    d=min(d,abs(length(p-.35*vec2(cos(a),sin(a)))-.285)-.006);
    a+=PI/3.;
    d=min(d,abs(length(p-.19*vec2(cos(a),sin(a)))-.232)-.006);
    vec2 q=rotate(a)*p;
    d=min(d,max(abs(q.y)-.005,max(-q.x,q.x-.672)));
  }
  return min(d,abs(length(p)-.087)-.005);
}
vec2 closer(vec2 a, vec2 b) { return a.x<b.x?a:b; }
// The guide planes share exactly the same depth as their material layers.
float layerZ(int layer) {
  if(layer==0) return .185+uSpread*.95;
  if(layer==1) return .126+uSpread*.47;
  if(layer==2) return .086;
  if(layer==3) return .006-uSpread*.46;
  return -.11-uSpread*.9;
}
float glassShell(vec3 p) {
  float center=layerZ(0);
  float radius=length(p.xy*vec2(.92,1.04));
  float dome=.092*pow(max(1.-radius/.86,0.),1.55);
  float top=p.z-(center+.022+dome);
  float bottom=(center-.026)-p.z;
  return max(hexagon(p.xy,.812),max(top,bottom))-.008;
}
vec2 scene(vec3 p,bool glass) {
  vec2 d=vec2(extrude(hexagon(p.xy,.851),p.z-layerZ(4),.052,.024),1.);
  d=closer(d,vec2(extrude(hexagon(p.xy,.811),p.z-layerZ(3),.049,.021),2.));
  float foil=circles(p.xy);
  // Alternating inlays leave the smaller intersecting petals blue.
  for(int i=0;i<3;i++) {
    float a=float(i)*2.*PI/3.;
    foil=max(foil,-(length(p.xy-.19*vec2(cos(a),sin(a)))-.217));
  }
  d=closer(d,vec2(extrude(foil,p.z-layerZ(2),.009,.006),3.));
  d=closer(d,vec2(extrude(wires(p.xy)+.004,p.z-layerZ(1),.004,.013),1.));
  if(glass) d=closer(d,vec2(glassShell(p),4.));
  return d;
}
vec3 normalAt(vec3 p,bool glass) {
  vec2 e=vec2(.0012,0.);
  return normalize(vec3(scene(p+e.xyy,glass).x-scene(p-e.xyy,glass).x,
    scene(p+e.yxy,glass).x-scene(p-e.yxy,glass).x,
    scene(p+e.yyx,glass).x-scene(p-e.yyx,glass).x));
}
vec2 trace(vec3 ro,vec3 rd,bool glass) {
  float t=0.; float id=0.;
  for(int i=0;i<112;i++) {
    vec2 h=scene(ro+rd*t,glass);
    if(h.x<.0008) {id=h.y;break;}
    t+=max(h.x*.8,.0004);
    if(t>9.)break;
  }
  return vec2(t,id);
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
vec3 spectrum(float x) {return .55+.45*cos(6.28318*(x+vec3(0.,.33,.67)));}
vec3 environment(vec3 r) {
  vec3 col=mix(vec3(.055,.07,.11),vec3(.42,.49,.63),smoothstep(-.5,.85,r.y));
  float key=pow(max(dot(r,normalize(vec3(-.6,.85,1.))),0.),24.);
  float strip=exp(-pow((r.x+.42*r.z-.24)*10.,2.))*smoothstep(-.3,.35,r.y);
  float rim=pow(max(dot(r,normalize(vec3(.8,-.25,.4))),0.),35.);
  col+=vec3(1.35,1.5,1.75)*key+vec3(2.8,2.6,2.2)*strip;
  col+=vec3(.25,.7,1.4)*rim;
  float panel=pow(max(r.z,0.),5.)*(1.-.94*exp(-pow((r.y+r.x*.35-.16)*13.,2.)));
  col+=vec3(2.7,2.65,2.5)*panel;
  return col;
}
float ggx(vec3 n,vec3 v,vec3 l,float rough) {
  vec3 h=normalize(v+l);
  float nh=max(dot(n,h),0.); float a2=pow(rough,4.);
  float den=nh*nh*(a2-1.)+1.;
  return a2/max(PI*den*den,.00001)*max(dot(n,l),0.);
}
vec3 shade(vec3 p,vec3 rd,float id) {
  vec3 n=normalAt(p,false),v=-rd;
  vec3 l=normalize(vec3(-.65,.8,1.5));
  vec3 reflection=environment(reflect(rd,n));
  float diff=max(dot(n,l),0.);
  float fres=pow(1.-max(dot(n,v),0.),5.);
  if(id<1.5) {
    float brushed=sin(p.y*1600.+noise(p.xy*90.)*2.)*.018;
    vec3 metal=vec3(.77,.82,.9);
    return metal*(reflection*.92+.08+brushed)+min(ggx(n,v,l,.22),9.)*.12;
  }
  if(id<2.5) {
    vec2 uv=p.xy;
    float swirl=sin(uv.x*9.+uv.y*5.+noise(uv*4.)*6.+uTime*.14);
    float wave=noise(uv*7.+vec2(swirl*.6,uTime*.025));
    vec3 blue=mix(vec3(.001,.006,.11),vec3(.003,.11,.77),smoothstep(.15,.82,wave));
    blue=mix(blue,vec3(.002,.48,1.),pow(wave,4.)*.9);
    vec2 lattice=vec2(uv.x*18.+uv.y*10.4,uv.y*20.8);
    vec2 tile=floor(lattice);
    float triangle=step(fract(lattice).x,fract(lattice).y);
    blue*=.8+.4*hash(tile+triangle*7.7);
    float edge=1.-smoothstep(0.,.07,abs(hexagon(uv,.811)));
    blue+=vec3(.0,.26,.5)*edge;
    return blue*(.5+.9*diff)+reflection*(.003+.35*fres)+min(ggx(n,v,l,.27),6.)*.025;
  }
  vec2 uv=p.xy;
  float angle=dot(n,v);
  float phase=uv.x*.8+uv.y*.58+v.x*.65-v.y*.45+uTime*.027;
  vec2 cell=floor(uv*17.), local=fract(uv*17.);
  float nearest=8., second=8., seed=0.;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) {
    vec2 offset=vec2(float(x),float(y));
    float random=hash(cell+offset);
    vec2 site=offset+.5+.34*sin(vec2(random,hash(cell+offset+13.))*6.28)-local;
    float distance=dot(site,site);
    if(distance<nearest){second=nearest;nearest=distance;seed=random;}
    else second=min(second,distance);
  }
  float lace=1.-smoothstep(.018,.065,second-nearest);
  vec3 holo=spectrum(phase+seed*.28)*.72;
  holo=mix(holo,vec3(.38,.93,.9),lace*.65);
  float flakes=hash(floor(uv*180.));
  holo+=pow(flakes,24.)*.4;
  return holo*(.5+diff*.45)+reflection*.07+spectrum(phase+.4)*pow(1.-angle,2.)*.4;
}
vec3 toLocal(vec3 p) {p.xz=rotate(uRotation.x)*p.xz;p.yz=rotate(uRotation.y)*p.yz;return p;}
float segmentDistance(vec2 p,vec2 a,vec2 b) {
  vec2 v=b-a;
  return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));
}
float digitDistance(vec2 p,int digit) {
  // Seven-segment numerals keep the annotations procedural and texture-free.
  int mask=63;
  if(digit==1) mask=6;
  if(digit==2) mask=91;
  if(digit==3) mask=79;
  if(digit==4) mask=102;
  if(digit==5) mask=109;
  float d=10.;
  if((mask&1)!=0) d=min(d,segmentDistance(p,vec2(-.23,.5),vec2(.23,.5)));
  if((mask&2)!=0) d=min(d,segmentDistance(p,vec2(.28,.44),vec2(.28,.06)));
  if((mask&4)!=0) d=min(d,segmentDistance(p,vec2(.28,-.06),vec2(.28,-.44)));
  if((mask&8)!=0) d=min(d,segmentDistance(p,vec2(-.23,-.5),vec2(.23,-.5)));
  if((mask&16)!=0) d=min(d,segmentDistance(p,vec2(-.28,-.06),vec2(-.28,-.44)));
  if((mask&32)!=0) d=min(d,segmentDistance(p,vec2(-.28,.44),vec2(-.28,.06)));
  if((mask&64)!=0) d=min(d,segmentDistance(p,vec2(-.23,0.),vec2(.23,0.)));
  return d-.035;
}
vec2 guideCoverage(vec2 p,int layer) {
  float edge=abs(hexagon(p,1.08));
  float angle=atan(p.y,p.x);
  float dash=abs(fract((angle+PI)*5.75)-.5)-.28;
  float lineAA=max(fwidth(edge),.001);
  float dashAA=max(fwidth(angle)*5.75,.001);
  float border=(1.-smoothstep(.002-lineAA,.002+lineAA,edge))
    *(1.-smoothstep(-dashAA,dashAA,dash));
  float digits=min(digitDistance((p-vec2(-.0525,1.17))/.13,0),
    digitDistance((p-vec2(.0525,1.17))/.13,layer+1))*.13;
  float textAA=max(fwidth(digits),.0008);
  return vec2(border,1.-smoothstep(-textAA,textAA,digits));
}
void main() {
  vec2 uv=(gl_FragCoord.xy-.5*uResolution)/min(uResolution.x,uResolution.y);
  float scale=mix(2.95,3.8,uSpread);
  vec3 ro=toLocal(vec3(0.,0.,4.6));
  vec3 rd=toLocal(normalize(vec3(uv*scale,-4.6)));
  vec2 hit=trace(ro,rd,true);
  float opaqueDepth=hit.y>0.&&hit.y<3.5?hit.x:1e4;
  vec3 col=vec3(0.); float alpha=0.;
  if(hit.y>0.) {
    alpha=1.; vec3 p=ro+rd*hit.x;
    if(hit.y<3.5) col=shade(p,rd,hit.y);
    else {
      vec3 n=normalAt(p,true);
      float facing=max(dot(-rd,n),0.);
      float fres=.018+.78*pow(1.-facing,4.5);
      // The first layer is a shallow crystal lens with view-dependent dispersion.
      vec3 bend=normalize(rd+vec3(-n.xy*.075,0.));
      vec2 under=trace(p+bend*.008,bend,false);
      if(under.y>0.) opaqueDepth=hit.x+.008+under.x;
      vec3 base=under.y>0.?shade(p+bend*(under.x+.008),bend,under.y):vec3(.17,.19,.22);
      vec3 reflection=environment(reflect(rd,n));
      float edge=1.-smoothstep(0.,.045,abs(hexagon(p.xy,.812)));
      float lens=length(p.xy*vec2(.92,1.04));
      float ring=exp(-pow((lens-.53)*17.,2.));
      float sweep=exp(-pow((p.x+.34*p.y-.08-.055*sin(uTime*.32))*12.,2.));
      float flare=pow(max(dot(reflect(rd,n),normalize(vec3(-.5,.72,1.))),0.),18.);
      float domeSheen=pow(max(dot(n,normalize(vec3(-.42,.35,1.))),0.),6.)
        *smoothstep(.9,.12,lens);
      float filmPhase=dot(p.xy,vec2(1.7,-1.1))+facing*2.4+uTime*.018;
      vec3 dispersion=spectrum(filmPhase);
      float pearlMask=smoothstep(.9,.08,lens)
        *(.18+.32*pow(max(dot(n,normalize(vec3(-.45,.7,1.))),0.),2.));
      vec3 pearl=mix(vec3(.18,.5,.92),vec3(1.,.7,.32),
        .5+.5*sin(filmPhase*3.1))*pearlMask;
      vec3 caustic=spectrum(filmPhase+.18)*ring*.58
        +spectrum(filmPhase-.12)*sweep*.34
        +vec3(1.,.86,.62)*flare*1.45
        +vec3(1.,.82,.58)*domeSheen*.5;
      float accent=under.y>0.?.22:1.;
      col=mix(base,reflection,fres)+(caustic+pearl)*accent;
      col+=dispersion*edge*(under.y>0.?.2:.5)+vec3(.28,.65,1.)*edge*.12;
      if(under.y==0.) alpha=clamp(.11+fres*.72+edge*.42+ring*.11+sweep*.08+pearlMask*.2+domeSheen*.12,0.,.82);
    }
    col=col/(col+vec3(.65));
    col=pow(col,vec3(1./2.2));
  }
  // Analytic intersections make the dashed frames rotate and occlude in 3D,
  // without adding small geometry to every raymarch step.
  float reveal=smoothstep(.035,.3,uSpread);
  if(reveal>0.&&abs(rd.z)>.0001) {
    for(int i=0;i<5;i++) {
      int layer=rd.z<0.?4-i:i;
      float t=(layerZ(layer)-ro.z)/rd.z;
      vec2 coverage=guideCoverage((ro+rd*t).xy,layer);
      float border=coverage.x*.65;
      if(t>opaqueDepth+.002) border=0.;
      if(hit.y==4.&&t>hit.x) border*=.7;
      // Numbers are annotations: keep them legible over foreground materials.
      float opacity=max(border,coverage.y*.95)*reveal;
      if(t<=0.) opacity=0.;
      vec3 ink=mix(vec3(.43,.55,.63),vec3(.79,.85,.88),coverage.y);
      float combined=opacity+alpha*(1.-opacity);
      col=(ink*opacity+col*alpha*(1.-opacity))/max(combined,.00001);
      alpha=combined;
    }
  }
  fragColor=vec4(col,alpha);
}`;

function start() {
  const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, premultipliedAlpha: false });
  if (!gl) throw new Error('浏览器暂不支持 WebGL 2。请使用开启硬件加速的新版 Chrome、Edge 或 Safari。');
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  const program = gl.createProgram();
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
  in vec2 position;
  void main(){gl_Position=vec4(position,0.,1.);}`);
  const pixel = compile(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertex);
  gl.attachShader(program, pixel);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vertex);
  gl.deleteShader(pixel);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['uResolution','uRotation','uTime','uSpread'].map(name => [name, gl.getUniformLocation(program, name)]));
  let spread = 0, pinned = 0, hovering = false, paused = reducedMotion;
  let pointer = { x: 0, y: 0 }, rotation = { x: -.07, y: .07 };
  let time = 0, previous = 0, frame = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // Cap pixel count: raymarching cost grows with both pixels and march steps.
    const ratio = Math.min(devicePixelRatio, 1.65, 1800 / Math.max(rect.width, rect.height));
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  function updateUI(target) {
    stage.classList.toggle('expanded', target > .1);
    explodeButton.setAttribute('aria-pressed', String(pinned > 0));
    explodeButton.innerHTML = `<span>▱</span> ${pinned > 0 ? '合拢图层' : '展开图层'}`;
    slider.value = Math.round(target * 100);
    amount.value = `${Math.round(target * 100)}%`;
  }
  function toggleLayers() {
    pinned = pinned > 0 ? 0 : 1;
    hovering = false;
    updateUI(pinned);
  }
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 2 - 1;
    pointer.y = (event.clientY - rect.top) / rect.height * 2 - 1;
    hovering = Math.abs(pointer.x) < .55 && Math.abs(pointer.y) < .7;
    updateUI(Math.max(pinned, hovering ? 1 : 0));
  });
  canvas.addEventListener('pointerleave', () => {
    hovering = false;
    pointer = { x: 0, y: 0 };
    updateUI(pinned);
  });
  canvas.addEventListener('pointerup', event => { if (event.pointerType === 'touch') toggleLayers(); });
  canvas.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggleLayers(); }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') pointer.x -= .15;
      if (event.key === 'ArrowRight') pointer.x += .15;
      if (event.key === 'ArrowUp') pointer.y -= .15;
      if (event.key === 'ArrowDown') pointer.y += .15;
    }
  });
  explodeButton.addEventListener('click', toggleLayers);
  slider.addEventListener('input', () => { pinned = Number(slider.value) / 100; hovering = false; updateUI(pinned); });
  function updateMotion() {
    motionButton.textContent = paused ? '▷' : 'Ⅱ';
    motionButton.title = paused ? '播放自动光效' : '暂停自动光效';
    motionButton.setAttribute('aria-label', motionButton.title);
    motionButton.setAttribute('aria-pressed', String(paused));
  }
  motionButton.addEventListener('click', () => { paused = !paused; updateMotion(); });
  document.querySelector('#reset').addEventListener('click', () => {
    pinned = 0; hovering = false; time = 0; pointer = { x: 0, y: 0 };
    updateUI(0);
  });
  updateMotion();
  function render(now) {
    const dt = Math.min((now - previous) / 1000, .05);
    previous = now;
    if (!paused) time += dt;
    const target = Math.max(pinned, hovering ? 1 : 0);
    const damping = reducedMotion ? 1 : 1 - Math.exp(-dt * 5.5);
    spread += (target - spread) * damping;
    const rx = -.07 + spread * .86 + pointer.x * .75 + (reducedMotion ? 0 : Math.sin(time * .32) * .04);
    const ry = .07 + spread * -.27 + pointer.y * .48;
    rotation.x += (rx - rotation.x) * damping;
    rotation.y += (ry - rotation.y) * damping;
    gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.uRotation, rotation.x, rotation.y);
    gl.uniform1f(uniforms.uTime, time);
    gl.uniform1f(uniforms.uSpread, spread);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.state = target > .1 ? 'expanded' : 'assembled';
    frame = requestAnimationFrame(render);
  }
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(frame);
    if (!document.hidden) { previous = performance.now(); frame = requestAnimationFrame(render); }
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); cancelAnimationFrame(frame);
    showError('图形上下文已中断，请刷新页面恢复。');
  });
  frame = requestAnimationFrame(render);
}
function showError(message) {
  const error = document.querySelector('#error');
  error.textContent = message;
  error.hidden = false;
}
try { start(); } catch (error) { console.error(error); showError(error.message); }
