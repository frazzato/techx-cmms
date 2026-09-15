/* ============================================================
   qr.js — self-contained QR code generator (byte mode, ECC M)
   Written in-house so tags still print if the plant network
   blocks outside scripts. Versions 1–10.
   ============================================================ */
const QR = (() => {
  const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
  (function(){let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&0x100)x^=0x11d;}
    for(let i=255;i<512;i++)EXP[i]=EXP[i-255];})();
  const gMul=(a,b)=>(a===0||b===0)?0:EXP[LOG[a]+LOG[b]];
  function genPoly(n){let poly=[1];
    for(let i=0;i<n;i++){const next=new Array(poly.length+1).fill(0);
      for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=gMul(poly[j],EXP[i]);}poly=next;}
    return poly;}
  function ecCodewords(data,ecLen){const gen=genPoly(ecLen);
    const res=new Array(data.length+ecLen).fill(0);data.forEach((b,i)=>{res[i]=b;});
    for(let i=0;i<data.length;i++){const f=res[i];if(f===0)continue;
      for(let j=0;j<gen.length;j++)res[i+j]^=gMul(gen[j],f);}
    return res.slice(data.length);}
  const VER={1:[10,1,16,0,0],2:[16,1,28,0,0],3:[26,1,44,0,0],4:[18,2,32,0,0],5:[24,2,43,0,0],
    6:[16,4,27,0,0],7:[18,4,31,0,0],8:[22,2,38,2,39],9:[22,3,36,2,37],10:[26,4,43,1,44]};
  const ALIGN={1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
  const dataCapacity=v=>{const[,a,b,c,d]=VER[v];return a*b+c*d;};
  function utf8Bytes(text){const bytes=[];
    for(const ch of text){const cp=ch.codePointAt(0);
      if(cp<0x80)bytes.push(cp);
      else if(cp<0x800)bytes.push(0xc0|(cp>>6),0x80|(cp&0x3f));
      else if(cp<0x10000)bytes.push(0xe0|(cp>>12),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));
      else bytes.push(0xf0|(cp>>18),0x80|((cp>>12)&0x3f),0x80|((cp>>6)&0x3f),0x80|(cp&0x3f));}
    return bytes;}
  function encodeData(text,version){const bytes=utf8Bytes(text);
    const cap=dataCapacity(version);const lenBits=version<=9?8:16;const bits=[];
    const put=(v,l)=>{for(let i=l-1;i>=0;i--)bits.push((v>>>i)&1);};
    put(0b0100,4);put(bytes.length,lenBits);bytes.forEach(b=>put(b,8));
    const capBits=cap*8;
    for(let i=0;i<4&&bits.length<capBits;i++)bits.push(0);
    while(bits.length%8!==0)bits.push(0);
    const cw=[];
    for(let i=0;i<bits.length;i+=8){let b=0;for(let j=0;j<8;j++)b=(b<<1)|bits[i+j];cw.push(b);}
    const PAD=[0xec,0x11];let k=0;
    while(cw.length<cap)cw.push(PAD[k++%2]);
    return cw;}
  function buildCodewords(text,version){const[ecLen,g1b,g1d,g2b,g2d]=VER[version];
    const data=encodeData(text,version);const blocks=[];let pos=0;
    for(let i=0;i<g1b;i++){blocks.push(data.slice(pos,pos+g1d));pos+=g1d;}
    for(let i=0;i<g2b;i++){blocks.push(data.slice(pos,pos+g2d));pos+=g2d;}
    const ecs=blocks.map(b=>ecCodewords(b,ecLen));const out=[];
    const maxData=Math.max(...blocks.map(b=>b.length));
    for(let i=0;i<maxData;i++)blocks.forEach(b=>{if(i<b.length)out.push(b[i]);});
    for(let i=0;i<ecLen;i++)ecs.forEach(e=>out.push(e[i]));
    return out;}
  function newMatrix(size){const m=[];for(let i=0;i<size;i++)m.push(new Array(size).fill(null));return m;}
  function placeFinder(m,r,c){
    for(let i=-1;i<=7;i++)for(let j=-1;j<=7;j++){
      const rr=r+i,cc=c+j;if(rr<0||cc<0||rr>=m.length||cc>=m.length)continue;
      const ring=(i>=0&&i<=6&&(j===0||j===6))||(j>=0&&j<=6&&(i===0||i===6));
      const core=i>=2&&i<=4&&j>=2&&j<=4;
      m[rr][cc]=(ring||core)?1:0;}}
  function placeAlignment(m,version){const centers=ALIGN[version];const size=m.length;
    for(const r of centers)for(const c of centers){
      if((r<=8&&c<=8)||(r<=8&&c>=size-9)||(r>=size-9&&c<=8))continue;
      for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)
        m[r+i][c+j]=(Math.max(Math.abs(i),Math.abs(j))===1)?0:1;}}
  function placeTiming(m){const size=m.length;
    for(let i=8;i<size-8;i++){const v=i%2===0?1:0;
      if(m[6][i]===null)m[6][i]=v;if(m[i][6]===null)m[i][6]=v;}}
  function reserve(m,version){const size=m.length;
    for(let i=0;i<9;i++){if(m[8][i]===null)m[8][i]='R';if(m[i][8]===null)m[i][8]='R';}
    for(let i=0;i<8;i++){if(m[8][size-1-i]===null)m[8][size-1-i]='R';if(m[size-1-i][8]===null)m[size-1-i][8]='R';}
    m[size-8][8]=1;
    if(version>=7)for(let i=0;i<6;i++)for(let j=0;j<3;j++){m[i][size-11+j]='R';m[size-11+j][i]='R';}}
  function placeData(m,codewords){const size=m.length;const bits=[];
    codewords.forEach(cw=>{for(let i=7;i>=0;i--)bits.push((cw>>i)&1);});
    let idx=0,up=true;
    for(let col=size-1;col>0;col-=2){
      if(col===6)col--;
      for(let n=0;n<size;n++){const row=up?size-1-n:n;
        for(let k=0;k<2;k++){const c=col-k;
          if(m[row][c]===null)m[row][c]=idx<bits.length?bits[idx++]:0;}}
      up=!up;}}
  const MASKS=[(r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,
    (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>((r*c)%2)+((r*c)%3)===0,
    (r,c)=>(((r*c)%2)+((r*c)%3))%2===0,(r,c)=>(((r+c)%2)+((r*c)%3))%2===0];
  function functionMask(version){const size=version*4+17;const f=newMatrix(size);
    placeFinder(f,0,0);placeFinder(f,0,size-7);placeFinder(f,size-7,0);
    placeAlignment(f,version);placeTiming(f);reserve(f,version);
    return f.map(row=>row.map(v=>v!==null));}
  function applyMask(m,maskId,isFunc){const size=m.length;const out=m.map(r=>r.slice());
    for(let r=0;r<size;r++)for(let c=0;c<size;c++){
      if(isFunc[r][c])continue;if(MASKS[maskId](r,c))out[r][c]^=1;}
    return out;}
  function formatBits(maskId){const data=(0b00<<3)|maskId;let rem=data<<10;
    for(let i=14;i>=10;i--)if((rem>>i)&1)rem^=0b10100110111<<(i-10);
    return((data<<10)|rem)^0b101010000010010;}
  /* Two copies of the 15 format bits, covering exactly the cells
     reserve() marks so none is left holding a data bit. */
  function placeFormat(m,maskId){const size=m.length;const bits=formatBits(maskId);
    for(let i=0;i<15;i++){const bit=(bits>>i)&1;
      if(i<6)m[i][8]=bit;else if(i<8)m[i+1][8]=bit;else m[size-15+i][8]=bit;
      if(i<8)m[8][size-1-i]=bit;else if(i===8)m[8][7]=bit;else m[8][14-i]=bit;}
    m[size-8][8]=1;}
  function versionBits(version){let rem=version<<12;
    for(let i=17;i>=12;i--)if((rem>>i)&1)rem^=0b1111100100<<(i-12);
    return(version<<12)|rem;}
  function placeVersion(m,version){if(version<7)return;
    const size=m.length;const bits=versionBits(version);
    for(let i=0;i<18;i++){const bit=(bits>>i)&1;const r=Math.floor(i/3),c=i%3;
      m[r][size-11+c]=bit;m[size-11+c][r]=bit;}}
  function penalty(m){const size=m.length;let score=0;
    for(let r=0;r<size;r++){let run=1;
      for(let c=1;c<size;c++){if(m[r][c]===m[r][c-1])run++;else{if(run>=5)score+=3+(run-5);run=1;}}
      if(run>=5)score+=3+(run-5);}
    for(let c=0;c<size;c++){let run=1;
      for(let r=1;r<size;r++){if(m[r][c]===m[r-1][c])run++;else{if(run>=5)score+=3+(run-5);run=1;}}
      if(run>=5)score+=3+(run-5);}
    for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++){const v=m[r][c];
      if(v===m[r][c+1]&&v===m[r+1][c]&&v===m[r+1][c+1])score+=3;}
    const P1=[1,0,1,1,1,0,1,0,0,0,0],P2=[0,0,0,0,1,0,1,1,1,0,1];
    const match=(a,p)=>p.every((v,i)=>a[i]===v);
    for(let r=0;r<size;r++)for(let c=0;c<=size-11;c++){
      const row=m[r].slice(c,c+11);if(match(row,P1)||match(row,P2))score+=40;}
    for(let c=0;c<size;c++)for(let r=0;r<=size-11;r++){
      const col=[];for(let k=0;k<11;k++)col.push(m[r+k][c]);
      if(match(col,P1)||match(col,P2))score+=40;}
    let dark=0;for(let r=0;r<size;r++)for(let c=0;c<size;c++)dark+=m[r][c];
    score+=Math.floor(Math.abs((dark*100)/(size*size)-50)/5)*10;
    return score;}
  function encode(text){const byteLen=utf8Bytes(text).length;let version=0;
    for(let v=1;v<=10;v++){const lenBits=v<=9?8:16;
      if(Math.ceil((4+lenBits+byteLen*8)/8)<=dataCapacity(v)){version=v;break;}}
    if(!version)throw new Error('Text too long for QR version 10');
    const size=version*4+17;const cw=buildCodewords(text,version);
    const base=newMatrix(size);
    placeFinder(base,0,0);placeFinder(base,0,size-7);placeFinder(base,size-7,0);
    placeAlignment(base,version);placeTiming(base);reserve(base,version);
    /* Reserved cells stay marked through data placement so data bits skip
       them; overwritten with real format bits after masking. */
    const isFunc=functionMask(version);
    placeData(base,cw);
    let best=null,bestScore=Infinity;
    for(let mid=0;mid<8;mid++){const cand=applyMask(base,mid,isFunc);
      placeFormat(cand,mid);placeVersion(cand,version);
      const s=penalty(cand);if(s<bestScore){bestScore=s;best=cand;}}
    return best.map(row=>row.map(v=>v===1));}
  function toSVG(text,opts={}){const m=encode(text);const n=m.length;
    const quiet=opts.quiet??4;const total=n+quiet*2;const px=opts.size||160;
    let path='';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)
      if(m[r][c])path+=`M${c+quiet} ${r+quiet}h1v1h-1z`;
    return`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" `+
      `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`+
      `<rect width="${total}" height="${total}" fill="#fff"/>`+
      `<path d="${path}" fill="#000"/></svg>`;}
  return { encode, toSVG, dataCapacity };
})();
if (typeof module !== 'undefined') module.exports = QR;
