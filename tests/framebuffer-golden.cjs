// Independent framebuffer cross-check against NESd deterministic goldens.
// NESd source commit: c6a81d023e1808c5d16a7f6e0b6d020e53a21411
// Golden algorithm: FNV-1a 64-bit over 256x240 RGBA bytes after 360 frames.
const fs=require('node:fs'),path=require('node:path');
const {createEmulator}=require('./headless.cjs');
const root=process.argv[2];
if(!root)throw Error('Usage: node tests/framebuffer-golden.cjs <nes-test-roms-dir> [report.json]');

const palette=[
  0x626262,0x001fb2,0x2404c8,0x5200b2,0x730076,0x800024,0x730b00,0x522800,
  0x244400,0x005700,0x005c00,0x005324,0x003c76,0x000000,0x000000,0x000000,
  0xababab,0x0d57ff,0x4b30ff,0x8a13ff,0xbc08d6,0xd21269,0xc72e00,0x9d5400,
  0x607b00,0x209800,0x00a300,0x009942,0x007db4,0x000000,0x000000,0x000000,
  0xffffff,0x53aeff,0x9085ff,0xd365ff,0xff57ff,0xff5dcf,0xff7757,0xfa9e00,
  0xbdc700,0x7ae700,0x43f611,0x26ef7e,0x2cd5f6,0x4e4e4e,0x000000,0x000000,
  0xffffff,0xb6e1ff,0xced1ff,0xe9c3ff,0xffbcff,0xffbdf4,0xffc6c3,0xffd59a,
  0xe9e681,0xcef481,0xb6fb9a,0xa9fac3,0xa9f0f4,0xb8b8b8,0x000000,0x000000
];

const tests=[
  ['scanline/scanline.nes', '-5071674518877676179'],
  ['spritecans-2011/spritecans.nes', '6027694824722942956'],
  ['full_palette/full_palette.nes', '6387691627853472549']
];

function attenuate(v,dim){return dim?Math.round(v*0.746):v;}
function fnvRgba(indices,emphasis){
  let h=0xcbf29ce484222325n;
  const prime=0x100000001b3n, mask=0xffffffffffffffffn;
  for(let i=0;i<indices.length;i++){
    const rgb=palette[indices[i]&0x3f]>>>0;
    const e=emphasis[i]&7; // bit0 red, bit1 green, bit2 blue emphasis
    let r=(rgb>>>16)&255,g=(rgb>>>8)&255,b=rgb&255;
    // NESd's NTSC palette model attenuates the two channels not emphasized.
    r=attenuate(r,(e&0x06)!==0);
    g=attenuate(g,(e&0x05)!==0);
    b=attenuate(b,(e&0x03)!==0);
    for(const byte of [r,g,b,255]) h=((h^BigInt(byte))*prime)&mask;
  }
  if(h>=0x8000000000000000n)h-=0x10000000000000000n;
  return h.toString();
}

const phaseDiagnostics={};
const results=[];
for(const [rel,expected] of tests){
  const rom=fs.readFileSync(path.join(root,rel));
  const e=createEmulator();
  let error=null,actual=null,diagnostics={};
  try{
    e.load(new Uint8Array(rom));
    e.runFrames(360);
    const indices=e.frameIndices();
    const emphasis=e.frameEmphasis();
    actual=fnvRgba(indices,emphasis);

    if(rel==='scanline/scanline.nes'){
      // The ROM source places six '*' error markers in the rightmost six
      // character cells of each tested text row. Correct raster timing blanks
      // those markers. Count bright $30 pixels only inside those marker cells.
      const rows=[6,7,8,9,10,11,15,16,17,18,19,20,24,25,26,27];
      let starPixels=0;
      for(const tileY of rows) for(let y=tileY*8;y<tileY*8+8;y++)
        for(let x=26*8;x<32*8;x++)
          if((indices[y*256+x]&0x3f)===0x30) starPixels++;
      diagnostics.starPixels=starPixels;
    }

    if(rel==='full_palette/full_palette.nes'){
      const combos=new Set();
      for(let i=0;i<indices.length;i++)
        combos.add(((emphasis[i]&7)<<6)|(indices[i]&0x3f));
      diagnostics.uniquePaletteEmphasisPairs=combos.size;
      diagnostics.pairs=[...combos].sort((a,b)=>a-b);
    }
  }catch(ex){error=String(ex);}
  const pass=!error&&actual===expected;
  const result={rom:rel,frames:360,expected,actual,pass,error,diagnostics};
  results.push(result);
  console.log('FRAMEBUFFER_GOLDEN '+JSON.stringify(result));
}
// full_palette intentionally alternates frame timing. Record nearby frame
// hashes to distinguish a frame-phase mismatch from a rendering mismatch.
for(const frames of [359,360,361]){
  const rom=fs.readFileSync(path.join(root,'full_palette/full_palette.nes'));
  const e=createEmulator();
  e.load(new Uint8Array(rom));
  e.runFrames(frames);
  phaseDiagnostics[frames]=fnvRgba(e.frameIndices(),e.frameEmphasis());
}
console.log('FRAMEBUFFER_PHASE '+JSON.stringify(phaseDiagnostics));

const summary={total:results.length,pass:results.filter(r=>r.pass).length,fail:results.filter(r=>!r.pass).length};
console.log('FRAMEBUFFER_GOLDEN_SUMMARY '+JSON.stringify(summary));
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({source:'jpjonte/NESd@c6a81d023e1808c5d16a7f6e0b6d020e53a21411',summary,phaseDiagnostics,results},null,2)+'\n');
if(summary.fail)process.exitCode=1;
