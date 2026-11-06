/* ═══════════════════════════════════════════════════════════════════
   STARS — every star you can fly to, built by the world engine from its
   data (radius, surface temperature):
     surface      boiling plasma: two layers of flow-warped waves (a
                  curl-like fluid drift, like the planets' cloud decks)
                  over moving granulation, coloured from the star's
                  blackbody ramp, limb-darkened. Far away it drops to a
                  plain glowing sphere (one cheap material).
     corona       a shell round the star, ray-marched in a few steps
                  through a falling-off, streamer-modulated glow.
     prominences  loops of glowing particles riding magnetic arcs off the
                  surface; now and then one erupts as a flare. Only near.
   No fluid sim, no marching cubes: all of it is a handful of sines per
   pixel and a few hundred points, so it holds up on a phone.
   The zero-gravity bubble (ui/dm-starbubble.js) compresses this same
   surface/corona/prominence light round its rim, and inside the star it
   shows interiorMaterial() — the same plasma, seen from within.
   TSL node materials: one source for WebGPU and the WebGL2 fallback.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  const live=new Set();
  const lowTier=()=>{ try{ return !!(GFX&&(GFX.preset==='low'||(GFX.isMobile&&GFX.preset!=='high'&&GFX.preset!=='ultra'))); /* a phone set to High/Ultra gets the full shaders */ }catch(e){ return false; } };

  // blackbody colour (sRGB 0..255) for a temperature in kelvin
  function kelvin(K){
    const t=Math.max(10,Math.min(400,K/100)); let r,g,b;
    if(t<=66){ r=255; g=99.4708025861*Math.log(t)-161.1195681661; b=t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307; }
    else { r=329.698727446*Math.pow(t-60,-0.1332047592); g=288.1221695283*Math.pow(t-60,-0.0755148492); b=255; }
    const c=v=>Math.max(0,Math.min(255,v))/255;
    return new THREE.Color().setRGB(c(r),c(g),c(b),THREE.SRGBColorSpace);
  }
  // spectral class / catalogue label → surface temperature
  function tempFor(type){
    const s=String(type||'G');
    if(/O\/B|O\b|blue giant/i.test(s)) return 22000;
    if(/^B|blue/i.test(s)) return 15000;
    if(/^A|white$/i.test(s)&&!/yellow/i.test(s)) return 9000;
    if(/^F\/G|yellow-white/i.test(s)) return 6200;
    if(/^F/i.test(s)) return 6800;
    if(/red giant/i.test(s)) return 3600;
    if(/^K|orange/i.test(s)) return 4500;
    if(/^M|red/i.test(s)) return 3200;
    return 5600;
  }
  // deep → mid → hot → core. The reference photosphere's golden ramp, tinted by
  // how far the star's blackbody sits from the Sun's: a red dwarf glows deep
  // orange-red, a hot star white-blue, with the same cell/vein texture.
  function palette(K){
    const ref=kelvin(5778), me=kelvin(K), tint=new THREE.Color(1,1,1);
    for(const ch of ['r','g','b']) tint[ch]=Math.max(0.12,Math.min(1.9,(me[ch]+1e-3)/(ref[ch]+1e-3)));
    const gold=(r,g,b)=>new THREE.Color().setRGB(r/255,g/255,b/255,THREE.SRGBColorSpace);
    const mk=(c,w)=>{ const o=c.clone(); o.r*=1+(tint.r-1)*w; o.g*=1+(tint.g-1)*w; o.b*=1+(tint.b-1)*w; return o; };
    const lum=Math.max(0.35,Math.min(1.6,Math.pow(K/5778,0.35)));
    const P={deep:mk(gold(128,66,10),1).multiplyScalar(lum),mid:mk(gold(226,148,34),1).multiplyScalar(lum),hot:mk(gold(252,196,84),1).multiplyScalar(lum),core:mk(gold(255,246,206),0.6).multiplyScalar(lum)};
    // hotter than the Sun: the same texture in the star's own blackbody blue-white
    const w=Math.max(0,Math.min(1,(K-6200)/5500));
    if(w>0){ const f={deep:0.12,mid:0.42,hot:0.7,core:1.0}; for(const k in P) P[k].lerp(me.clone().multiplyScalar(f[k]*lum),w); }
    return P;
  }

  /* the plasma: one function for the surface and the inside view.
     Reference look (SDO-style photosphere): golden cells laced with thin bright
     veins, dark orange pores between them, small white-hot plage patches.
     Veins are ridged gradient noise (1-|n|)^k over a flow-warped domain; finer
     octaves fade in as the star grows on screen. */
  function plasma(T,U,d,detail){
    const {sin,mix,smoothstep,time,vec3,float}=T;
    const t=time.mul(U.speed);
    const nz=x=>T.mx_noise_float?T.mx_noise_float(x)
      :sin(x.x.mul(3.1).add(x.y.mul(1.7))).mul(sin(x.y.mul(2.7).sub(x.z.mul(1.3)))).mul(sin(x.z.mul(3.3).add(x.x.mul(0.9))));
    const ridge=(x,k)=>float(1).sub(nz(x).abs()).pow(k);
    const p0=d.mul(U.scale).add(U.seed);
    // big slow warps so the network stretches and bunches from place to place
    const wp=p0.add(sin(p0.yzx.mul(0.17).add(1.3)).mul(1.3)).add(sin(p0.zxy.mul(0.29).add(0.7)).mul(0.8));
    // convective drift + slow boil
    const fl=wp.add(sin(wp.yzx.mul(0.9).add(t.mul(0.12))).mul(0.6));
    const boil=vec3(t.mul(0.05),0,t.mul(0.07));
    const mott=nz(fl.mul(0.55).add(3.1).add(boil)).mul(0.5).add(0.5);
    const mott2=nz(fl.mul(1.3).add(9.7).sub(boil)).mul(0.5).add(0.5);
    const v1=ridge(fl.add(boil),4.0);
    let g=float(0.08).add(mott.mul(0.2)).add(mott2.mul(0.12)).add(v1.mul(0.36));
    if(detail){
      const v2=ridge(fl.mul(2.1).add(7.3).add(boil.mul(1.6)),5.0);
      g=g.add(v2.mul(float(0.14).add(U.fine.mul(0.16))));
      if(detail!=='low'){
        const v3=ridge(fl.mul(4.4).add(13.1).sub(boil.mul(2.0)),6.0);
        g=g.add(v3.mul(U.fine.mul(0.2)));
        // close up: the finest threads and the molten micro-eddies
        const v4=ridge(fl.mul(9.5).add(2.9).add(boil.mul(2.6)),6.0);
        const v5=ridge(fl.mul(20.0).add(5.3).sub(boil.mul(3.0)),7.0);
        g=g.add(v4.mul(U.micro.mul(0.25))).add(v5.mul(U.micro2.mul(0.3)));
      }
    }
    // plage: a few white-hot active patches, veins flaring inside them
    const pn=nz(d.mul(3.6).add(U.seed.mul(0.7)).add(vec3(0,t.mul(0.004),0))).mul(0.5).add(0.5);
    const pl=smoothstep(0.62,0.82,pn);
    const pn2=nz(d.mul(11.0).add(U.seed).add(4.4)).mul(0.5).add(0.5);
    const pl2=smoothstep(0.72,0.9,pn2).mul(0.6);
    g=g.add(pl.add(pl2).mul(float(0.1).add(v1.mul(0.5))));
    g=g.clamp(0.0,1.0);
    let col=mix(U.deep,U.mid,smoothstep(0.18,0.5,g));
    col=mix(col,U.hot,smoothstep(0.5,0.76,g));
    col=mix(col,U.core,smoothstep(0.8,1.0,g));
    return col;
  }
  function uniforms(T,K,seed){
    const P=palette(K);
    return {deep:T.uniform(P.deep),mid:T.uniform(P.mid),hot:T.uniform(P.hot),core:T.uniform(P.core),
      seed:T.uniform(new THREE.Vector3(seed*1.7%9,seed*2.3%9,seed*3.1%9)),speed:T.uniform(1),fine:T.uniform(0),micro:T.uniform(0),micro2:T.uniform(0),scale:T.uniform(60.0),
      flareD:T.uniform(new THREE.Vector3(0,1,0)),flareK:T.uniform(0),fume:T.uniform(0.3)};
  }
  // the zero-g bubble (ui/dm-starbubble.js) parts the plasma round it
  let BU=null;
  function bubbleU(T){ return BU||(BU={c:T.uniform(new THREE.Vector3(0,0,0)),r:T.uniform(0)}); }
  function surfaceMat(T,U,near,low){
    const m=new THREE.MeshBasicNodeMaterial();
    const B=bubbleU(T);
    // cut along the line of sight: any surface between the camera and the
    // bubble, within its outline, is pushed aside (a rider just under the
    // photosphere is still seen in her window)
    const toP=T.positionWorld.sub(T.cameraPosition), D=T.normalize(toP), L=B.c.sub(T.cameraPosition);
    const tca=T.dot(L,D), d2=T.dot(L,L).sub(tca.mul(tca));
    const front=toP.length().lessThan(tca.add(B.r));
    // (v189) feathered window rim (last ~8% of the radius) instead of an alphaTest cut-out
    const edge=T.smoothstep(B.r.mul(0.92),B.r,d2.max(0.0).sqrt());
    m.opacityNode=front.select(edge,1.0);
    m.transparent=true; m.depthWrite=true; m.alphaTest=0.01; // discard window hole so #208 pass-through stays see-through in depth
    const d=T.normalize(T.positionLocal);
    const V=T.normalize(T.cameraPosition.sub(T.positionWorld));
    const ndv=T.normalWorld.dot(V).clamp(0.0,1.0);
    // limb darkening, redder toward the edge
    const limb=ndv.pow(0.3).mul(0.25).add(0.75);
    const base=near?plasma(T,U,d,low?'low':true):T.mix(U.mid,U.hot,ndv.pow(1.5).mul(0.5));
    const rim=T.float(1).sub(ndv).pow(3.0);   // the limb glows pale gold, as in the reference
    m.colorNode=base.mul(limb).add(U.core.mul(rim.mul(0.3)));
    m.toneMapped=false;
    return m;
  }
  function coronaMat(T,U,R,steps){
    const m=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.BackSide});
    const {float,vec3,sin,exp,dot,normalize,max,time}=T;
    const C=T.uniform(new THREE.Vector3());
    const Rc=R*2.4, H=R*0.22;
    const ro=T.cameraPosition.sub(C), rd=normalize(T.positionWorld.sub(T.cameraPosition));
    const b=dot(ro,rd), c=dot(ro,ro).sub(Rc*Rc);
    const disc=b.mul(b).sub(c).max(0.0).sqrt();
    const t0=b.negate().sub(disc).max(0.0), t1=b.negate().add(disc);
    const dt=t1.sub(t0).div(steps);
    let acc=float(0);
    for(let i=0;i<steps;i++){
      const p=ro.add(rd.mul(t0.add(dt.mul(i+0.5))));
      const r=p.length();
      const n=p.div(r);
      // streamers: brighter fans along slowly turning great circles
      const s=sin(n.x.mul(5.0).add(time.mul(0.05))).mul(sin(n.y.mul(4.0).sub(time.mul(0.04)))).mul(sin(n.z.mul(6.0))).mul(0.5).add(0.5);
      // gas swirling through the streamers, whipped up near a flare
      const flc=exp(float(1).sub(dot(n,U.flareD)).mul(-10.0)).mul(U.flareK);
      const sw=sin(n.x.mul(11.0).add(sin(n.y.mul(8.0).add(time.mul(0.35))).mul(float(1.6).add(flc.mul(2.0)))).add(time.mul(0.08))).mul(0.5).add(0.5);
      // fine radial hairs (spicules): high-frequency in direction only, so they stream straight out
      const hair=T.mx_noise_float?T.pow(T.mx_noise_float(n.mul(240.0).add(U.seed)).abs().oneMinus(),6.0).mul(exp(r.sub(R).div(R*0.09).negate())):float(0);
      acc=acc.add(exp(r.sub(R).div(H).negate()).mul(s.mul(0.5).add(sw.mul(0.3)).add(0.3).mul(flc.mul(2.5).add(1.0))).mul(r.greaterThan(R*0.99).select(1.0,0.0)).add(hair.mul(0.5)));
    }
    // soft-saturating so a long path through it glows, never whites out
    const k=float(1).sub(exp(acc.mul(dt).div(R*1.4).negate()));
    m.colorNode=T.mix(U.hot,U.core,k.mul(k)).mul(k.mul(0.38));
    m.toneMapped=false;
    m.userData.C=C;
    return m;
  }

  /* fumes: breezy gas lying just over the surface (the chromosphere), swirled by the loops and flares */
  function fumeMat(T,U,low){
    const m=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
    const {sin,mix,smoothstep,time,vec3,float,dot,normalize}=T;
    const d=normalize(T.positionLocal), V=normalize(T.cameraPosition.sub(T.positionWorld));
    const ndv=T.normalWorld.dot(V).clamp(0.0,1.0);
    const fl=T.exp(float(1).sub(dot(d,U.flareD)).mul(-14.0)).mul(U.flareK);          // a flare stirs the gas round its foot
    const t=time.mul(0.07);
    const p=d.mul(7.0).add(U.seed);
    const amp=float(0.55).add(fl.mul(1.6));
    const q=p.add(vec3(sin(p.y.mul(2.1).add(t.mul(3.0))),sin(p.z.mul(1.9).sub(t.mul(2.4))),sin(p.x.mul(2.3).add(t.mul(2.7)))).mul(amp));
    const nz=T.mx_fractal_noise_float?T.mx_fractal_noise_float(q.mul(1.6).add(vec3(0,t,0)),low?2:4,2.0,0.5).mul(0.5).add(0.5)
      :sin(q.x.mul(3.1)).mul(sin(q.y.mul(2.7).add(t))).mul(sin(q.z.mul(3.3))).mul(0.5).add(0.5);
    const wisps=smoothstep(0.38,0.82,nz);
    const edge=float(1).sub(ndv).pow(1.5).mul(0.8).add(0.2);
    m.colorNode=mix(U.mid,U.hot,wisps.add(fl.mul(0.5)).clamp(0,1)).mul(1.25);
    m.opacityNode=wisps.mul(edge).mul(U.fume).mul(0.3).add(fl.mul(0.35)).clamp(0.0,0.85);
    m.toneMapped=false;
    return m;
  }

  /* prominences: particles on magnetic arcs, now and then a flare */
  function prominences(R,col,low,seed,T,U){
    const A=low?5:10, N=low?22:44, tot=A*N;
    // camera-facing quads (WebGPU draws GL points one pixel wide, so no Points)
    let tex=null; try{ tex=makeCircleTex(32,'rgb(255,230,190)',1); }catch(e){}
    const m=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
    const pts=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),m,tot);
    pts.frustumCulled=false; pts.renderOrder=2; pts.name='JOTS_StarProminences';
    const pos=new Float32Array(tot*3), cols=new Float32Array(tot*3);
    const S=R*(low?0.034:0.026), M4=new THREE.Matrix4(), PV=new THREE.Vector3(), SC=new THREE.Vector3(), CL=new THREE.Color(), Q=new THREE.Quaternion();
    for(let i=0;i<tot;i++) pts.setColorAt(i,CL.setRGB(0,0,0));
    let rs=seed*9301+49297; const rnd=()=>{ rs=(rs*9301+49297)%233280; return rs/233280; };
    const V=THREE.Vector3;
    const arcs=[];
    function arc(a){
      const d0=new V(rnd()*2-1,rnd()*2-1,rnd()*2-1).normalize();
      const ax=new V().crossVectors(d0,new V(rnd()-0.5,rnd()-0.5,rnd()-0.5)).normalize();
      const d1=d0.clone().applyAxisAngle(ax,0.12+rnd()*0.18);
      a.d0=d0; a.d1=d1; a.h=R*(0.08+rnd()*0.2); a.life=6+rnd()*10; a.age=0; a.flare=rnd()<0.18; a.sp=0.12+rnd()*0.2;
      return a;
    }
    for(let i=0;i<A;i++){ const a=arc({}); a.age=rnd()*a.life; arcs.push(a); }
    const off=new Float32Array(tot); for(let i=0;i<tot;i++) off[i]=rnd();
    const jit=new Float32Array(tot*3); for(let i=0;i<tot*3;i++) jit[i]=(rnd()-0.5);
    /* ribbons: each magnetic loop is a glowing, camera-facing ribbon (a bright core fading to soft
       edges, with plasma streaming along it and hot feet) — the particles above ride inside as embers.
       Geometry is a few hundred vertices rebuilt per frame; all shading is on the GPU. */
    const SEG=low?14:24, NV=A*(SEG+1)*2;
    const rPos=new Float32Array(NV*3), rUV=new Float32Array(NV*2), rA=new Float32Array(NV), rIdx=[];
    for(let ai=0;ai<A;ai++) for(let j=0;j<=SEG;j++){ const v0=(ai*(SEG+1)+j)*2; rUV[v0*2]=j/SEG; rUV[v0*2+1]=-1; rUV[v0*2+2]=j/SEG; rUV[v0*2+3]=1;
      if(j<SEG){ rIdx.push(v0,v0+1,v0+2, v0+1,v0+3,v0+2); } }
    const rg=new THREE.BufferGeometry();
    rg.setAttribute('position',new THREE.BufferAttribute(rPos,3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('uv',new THREE.BufferAttribute(rUV,2));
    rg.setAttribute('ra',new THREE.BufferAttribute(rA,1).setUsage(THREE.DynamicDrawUsage));
    rg.setIndex(rIdx);
    let ribbon=null;
    if(T&&U&&T.attribute){
      const rm=new THREE.MeshBasicNodeMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
      const uvn=T.uv(), u=uvn.x, v=uvn.y, ra=T.attribute('ra','float');
      const f=T.sin(u.mul(Math.PI)), feet=T.float(1).sub(f).pow(3.0);
      const core=T.exp(v.mul(v).mul(-2.6));
      const streak=T.sin(u.mul(34.0).sub(T.time.mul(2.4)).add(T.sin(u.mul(9.0).add(T.time.mul(0.7))).mul(1.5))).mul(0.22).add(0.78);
      const I=core.mul(streak).mul(feet.mul(1.4).add(0.85)).mul(ra);
      rm.colorNode=T.mix(U.hot,U.core,core.mul(0.55).add(feet).clamp(0,1)).mul(I.mul(1.35));
      rm.toneMapped=false;
      ribbon=new THREE.Mesh(rg,rm); ribbon.frustumCulled=false; ribbon.renderOrder=2; ribbon.name='JOTS_StarFlareRibbons';
      pts.add(ribbon);
    }
    const camL=new V(), pA=new V(), pB=new V(), tg=new V(), sd=new V(), vw=new V();
    const tmp=new V(), c=col.mid.clone(), cHot=col.hot.clone();   // reddish loops, hotter at the feet
    pts.userData.tick=function(dt,cam){
      let bestK=0; const fo=pts.userData.flare||(pts.userData.flare={d:new V(0,1,0),k:0});
      for(let ai=0;ai<A;ai++){
        const a=arcs[ai]; a.age+=dt; if(a.age>a.life) arc(a);
        const env=Math.sin(Math.PI*Math.min(1,a.age/a.life));        // rises, holds, sinks back
        const er=a.flare?Math.max(0,(a.age/a.life-0.55)/0.45):0;      // flares tear loose late in life
        if(er>bestK){ bestK=er; fo.d.copy(a.d0).lerp(a.d1,0.5).normalize(); }
        for(let j=0;j<N;j++){
          const i=ai*N+j;
          let s=(off[i]+a.age*a.sp)%1;
          tmp.copy(a.d0).lerp(a.d1,s).normalize();
          let h=a.h*env*Math.sin(Math.PI*s)*(1+er*3);
          if(er>0) h+=R*er*er*0.9*(0.5+off[i]);                       // ejected material flying out
          const r=R*1.005+h, jj=R*0.012*(1+er*2);
          pos[i*3]=tmp.x*r+jit[i*3]*jj; pos[i*3+1]=tmp.y*r+jit[i*3+1]*jj; pos[i*3+2]=tmp.z*r+jit[i*3+2]*jj;
          const k=env*(0.55+0.45*Math.sin(Math.PI*s))*(1-er*0.7);
          const cc=s<0.15||s>0.85?cHot:c;
          cols[i*3]=cc.r*k*0.9; cols[i*3+1]=cc.g*k*0.9; cols[i*3+2]=cc.b*k*0.9;
        }
      }
      if(ribbon){
        if(cam) camL.copy(cam.position), pts.parent.worldToLocal(camL); else camL.set(0,0,R*6);
        for(let ai=0;ai<A;ai++){
          const a=arcs[ai], env=Math.sin(Math.PI*Math.min(1,a.age/a.life)), er=a.flare?Math.max(0,(a.age/a.life-0.55)/0.45):0;
          const kk=env*(1-er*0.7);
          for(let j=0;j<=SEG;j++){
            const s=j/SEG;
            tmp.copy(a.d0).lerp(a.d1,s).normalize();
            let h=a.h*env*Math.sin(Math.PI*s)*(1+er*3); if(er>0) h+=R*er*er*0.9*Math.sin(Math.PI*s);
            const rr=R*1.004+h; pA.copy(tmp).multiplyScalar(rr);
            // tangent by neighbours
            const s0=Math.max(0,(j-1)/SEG), s1=Math.min(1,(j+1)/SEG);
            tmp.copy(a.d0).lerp(a.d1,s0).normalize(); let h0=a.h*env*Math.sin(Math.PI*s0)*(1+er*3); if(er>0) h0+=R*er*er*0.9*Math.sin(Math.PI*s0); pB.copy(tmp).multiplyScalar(R*1.004+h0);
            tmp.copy(a.d0).lerp(a.d1,s1).normalize(); let h1=a.h*env*Math.sin(Math.PI*s1)*(1+er*3); if(er>0) h1+=R*er*er*0.9*Math.sin(Math.PI*s1); tg.copy(tmp).multiplyScalar(R*1.004+h1).sub(pB);
            vw.copy(camL).sub(pA); sd.crossVectors(tg,vw); const sl=sd.length(); if(sl>1e-9) sd.multiplyScalar(1/sl);
            const w=R*(low?0.03:0.024)*(0.45+0.95*Math.sin(Math.PI*s))*(0.35+env)*(1+er*1.6);
            const v0=(ai*(SEG+1)+j)*2;
            rPos[v0*3]=pA.x-sd.x*w; rPos[v0*3+1]=pA.y-sd.y*w; rPos[v0*3+2]=pA.z-sd.z*w;
            rPos[v0*3+3]=pA.x+sd.x*w; rPos[v0*3+4]=pA.y+sd.y*w; rPos[v0*3+5]=pA.z+sd.z*w;
            rA[v0]=rA[v0+1]=Math.max(0,kk);
          }
        }
        rg.attributes.position.needsUpdate=true; rg.attributes.ra.needsUpdate=true;
      }
      fo.k=bestK;
      // face the camera (in the star's frame)
      if(cam){ pts.parent.getWorldQuaternion(Q).invert().multiply(cam.quaternion); }
      for(let i=0;i<tot;i++){
        const k=Math.max(cols[i*3],cols[i*3+1],cols[i*3+2]);
        M4.compose(PV.set(pos[i*3],pos[i*3+1],pos[i*3+2]),Q,SC.setScalar(k>0.01?S*(0.6+k*0.6):1e-4));
        pts.setMatrixAt(i,M4); pts.setColorAt(i,CL.setRGB(cols[i*3],cols[i*3+1],cols[i*3+2]));
      }
      pts.instanceMatrix.needsUpdate=true; if(pts.instanceColor) pts.instanceColor.needsUpdate=true;
    };
    return pts;
  }

  function build(o){
    const T=THREE.TSL, R=o.radius, K=o.temp||5600, seed=o.seed||1, low=lowTier();
    const group=new THREE.Group(); group.name='JOTS_Star';
    const h={group,R,K,low,seed};
    if(!T||!THREE.MeshBasicNodeMaterial){
      // no node materials at all: a flat glowing sphere
      h.mesh=new THREE.Mesh(new THREE.SphereGeometry(R,32,24),new THREE.MeshBasicMaterial({color:kelvin(K*0.75)}));
      group.add(h.mesh); return h;
    }
    const U=uniforms(T,K,seed); h.U=U; h.T=T;
    h.matNear=surfaceMat(T,U,true,low); h.matFar=surfaceMat(T,U,false,low);
    h.mesh=new THREE.Mesh(new THREE.SphereGeometry(R,96,64),h.matFar);   // a smooth limb up close
    h.mesh.name='JOTS_StarSurface';
    group.add(h.mesh);
    try{
      // phones march 3 steps (was 4; 2 washed the surface out pale) — desktop 6
      h.corMat=coronaMat(T,U,R,low?3:6); h.corMatNear=h.corMat;
      h.corona=new THREE.Mesh(new THREE.SphereGeometry(R*2.4,32,20),h.corMat);
      h.corona.renderOrder=1; h.corona.frustumCulled=false; h.corona.name='JOTS_StarCorona';
      group.add(h.corona);
    }catch(e){ console.warn('[star] corona:',e); }
    try{
      h.fume=new THREE.Mesh(new THREE.SphereGeometry(R*1.015,low?48:96,low?32:64),fumeMat(T,U,low));
      h.fume.renderOrder=1; h.fume.frustumCulled=false; h.fume.name='JOTS_StarFume'; group.add(h.fume);
    }catch(e){ console.warn('[star] fume:',e); }
    try{
      h.prom=prominences(R,palette(K),low,seed,T,U); h.prom.visible=false; group.add(h.prom);
    }catch(e){ console.warn('[star] prominences:',e); }
    group.userData.dmStar=h;
    for(const o of live) if(!o.group.parent) live.delete(o);   // stars of systems we've left
    live.add(h);
    return h;
  }
  // the same plasma, seen from inside the star (the zero-g bubble's dive)
  function interiorMaterial(h){
    if(!h||!h.U) return null;
    if(h.matIn) return h.matIn;
    const T=h.T, m=new THREE.MeshBasicNodeMaterial({side:THREE.BackSide});
    m.colorNode=plasma(T,h.U,T.normalize(T.positionLocal),h.low?'low':true).mul(0.85);
    m.toneMapped=false;
    return (h.matIn=m);
  }

  /* Compile every pipeline this star can ever use (near surface, gas shell, prominences + ribbons)
     once, off the frame it first matters. Without this the phone stalls for a moment the first time each
     appears while you fly in, because the shader compiles synchronously right then. Same trick as the galaxy layer. */
  function precompile(h,cam){
    try{
      const r=(typeof flightRenderer!=='undefined'&&flightRenderer)||null; if(!r||!r.compileAsync||!h||!h.mesh) return false;
      const sc=(typeof flightScene!=='undefined'&&flightScene)||h.group.parent; if(!sc) return false;
      const m0=h.mesh.material, hid=[];
      h.group.traverse(o=>{ if(!o.visible){ hid.push(o); o.visible=true; } });
      // every variant the star switches to on approach: near surface, near corona, the interior plasma (built now,
      // drawn from within), so the first fly-through compiles nothing. Before v103 only matNear was swapped in, and the
      // near corona / interior / bubble programs compiled on the first 2-3 passes (stalls of up to ~30 s on Mali).
      if(h.matNear) h.mesh.material=h.matNear;
      const c0=h.corona?h.corona.material:null; if(h.corona&&h.corMatNear) h.corona.material=h.corMatNear;
      const pass=async()=>{
        await r.compileAsync(sc,cam);
        if(h.corona&&h.corMat&&h.corMatNear){ h.corona.material=h.corMat; await r.compileAsync(sc,cam); }
        if(h.matFar&&h.matFar!==h.matNear){ h.mesh.material=h.matFar; await r.compileAsync(sc,cam); }
        const mi=interiorMaterial(h);
        if(mi){ const mm=h.mesh.material; h.mesh.material=mi; try{ await r.compileAsync(sc,cam); } finally{ h.mesh.material=mm; } }
      };
      let p=null;
      try{ p=pass(); }catch(e){}
      const done=()=>{ h.mesh.material=m0; if(h.corona&&c0) h.corona.material=c0; for(const o of hid) o.visible=false; };
      if(p&&p.then){ p=p.catch(()=>{}).then(done); } else done();
      return p||true;
    }catch(e){ return false; }
  }
  const _v=()=>new THREE.Vector3();
  let V1=null;
  // per frame: level of detail by how big the star is on screen; corona centre;
  // prominences only up close
  function frame(cam,dt){
    if(!cam) return;
    if(!V1) V1=_v();
    for(const h of live){
      if(!h.group.parent||!h.group.visible) continue;
      h.group.getWorldPosition(V1);
      if(!h.pre&&h.T){ h.pre=true; precompile(h,cam); }
      const d=Math.max(1e-3,cam.position.distanceTo(V1));
      const ang=h.R/d;                                     // ~angular radius
      const near=ang>0.04;
      if(h.U) h.U.fine.value=Math.max(0,Math.min(1,(ang-0.3)/0.5));
      if(h.U){ h.U.micro.value=Math.max(0,Math.min(1,(ang-1.0)/6.0)); h.U.micro2.value=Math.max(0,Math.min(1,(ang-40)/400)); h.U.fume.value=0.35+0.65*Math.max(0,Math.min(1,(ang-0.1)/0.6));
        const fl=h.prom&&h.prom.visible&&h.prom.userData.flare; if(fl&&fl.k>0.01){ h.U.flareD.value.copy(fl.d); h.U.flareK.value=Math.min(1,fl.k); } else h.U.flareK.value*=0.92; }
      const m=near?h.matNear:h.matFar; if(h.mesh.material!==m) h.mesh.material=m;
      if(h.corona){ const cm=ang>0.6?h.corMatNear:h.corMat; if(h.corona.material!==cm) h.corona.material=cm;
        if(cm.userData.C) cm.userData.C.value.copy(V1); }
      if(h.prom){ h.prom.visible=ang>0.12; if(h.prom.visible) h.prom.userData.tick(Math.min(0.1,dt||1/60),cam); }
    }
  }
  // load-time warm-up: compile every star's pipelines now (resolves when the GPU has them)
  function warm(cam){
    const ps=[]; for(const h of live){ if(!h.group.parent||!h.T) continue; h.pre=true; const p=precompile(h,cam); if(p&&p.then) ps.push(p); }
    return Promise.all(ps);
  }
  function setBubble(c,r){ if(!BU) return; if(c) BU.c.value.copy(c); BU.r.value=r>0?r:0; }
  window.DMStar={build,frame,warm,interiorMaterial,setBubble,tempFor,kelvin,palette};
})();
