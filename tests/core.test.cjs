const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEmulator}=require('./headless.cjs');
function rom(mapper=0,prg=2,chr=1,flags=0,submapper=null) {
 const bytes=new Uint8Array(16+prg*0x4000+chr*0x2000);
 bytes.set([0x4e,0x45,0x53,0x1a,prg,chr,(mapper<<4)|flags,submapper===null?0:8,submapper===null?0:submapper<<4]);
 for(let b=0;b<prg;b++) bytes.fill(b,16+b*0x4000,16+(b+1)*0x4000);
 for(let b=0;b<chr*2;b++) bytes.fill(b,16+prg*0x4000+b*0x1000,16+prg*0x4000+(b+1)*0x1000);
 bytes[16+prg*0x4000-4]=0;bytes[16+prg*0x4000-3]=0x80;
 return bytes;
}
function emulator(bytes=rom()) {const e=createEmulator();e.load(bytes);return e;}
test('UxROM switches lower bank and fixes upper bank, including writes at FFFF',()=>{
 const e=emulator(rom(2,8,0,0,1));
 assert.equal(e.evaluate('checkReadOffset(0x8000)'),0);
 assert.equal(e.evaluate('checkReadOffset(0xC000)'),7);
 e.evaluate('checkWriteOffset(0xFFFF,3)');
 assert.equal(e.evaluate('checkReadOffset(0x8000)'),3);
 assert.equal(e.evaluate('checkReadOffset(0xC000)'),7);
});
test('UxROM bus conflict uses pre-switch ROM data',()=>{
 const bytes=rom(2,8,0,0,2);bytes[16]=2;
 const e=emulator(bytes);e.evaluate('checkWriteOffset(0x8000,7)');
 assert.equal(e.evaluate('checkReadOffset(0x8001)'),2);
});
test('MMC1 keeps all CHR banks and PPU paths agree',()=>{
 const e=emulator(rom(1,2,4));
 e.evaluate('mmc1Control=0x1C;mmc1CHR0=6;mmc1CHR1=7;mmc1ApplyControl()');
 assert.equal(e.evaluate('CHR_ROM.length'),0x8000);
 assert.equal(e.evaluate('ppuBusRead(0x0000)'),6);
 assert.equal(e.evaluate('ppuBusRead(0x1000)'),7);
 e.evaluate('VRAM_ADDR=0;checkReadOffset(0x2007)');
 assert.equal(e.evaluate('checkReadOffset(0x2007)'),6);
});
test('MMC1 8 KiB CHR ROM is not writable',()=>{
 const e=emulator(rom(1,2,1));e.evaluate('cpuCycles=30000;VRAM_ADDR=0;checkWriteOffset(0x2007,99)');
 assert.equal(e.evaluate('ppuBusRead(0)'),0);
});
test('MMC1 banked CHR RAM reads and writes agree',()=>{
 const e=emulator(rom(1,2,0));
 e.evaluate('cpuCycles=30000;mmc1Control=0x1C;mmc1CHR0=1;mmc1CHR1=0;mmc1ApplyControl();VRAM_ADDR=0;checkWriteOffset(0x2007,99)');
 assert.equal(e.evaluate('CHR_ROM[0x1000]'),99);
 assert.equal(e.evaluate('ppuBusRead(0)'),99);
});
test('MMC1 mirroring changes wiring without destroying CIRAM',()=>{
 const e=emulator(rom(1));
 e.evaluate('VRAM[0]=11;VRAM[0x400]=22;mmc1Control=0x0C;mmc1ApplyControl()');
 assert.equal(e.evaluate('ppuBusRead(0x2C00)'),11);
 e.evaluate('mmc1Control=0x0D;mmc1ApplyControl()');
 assert.equal(e.evaluate('ppuBusRead(0x2000)'),22);
 assert.deepEqual(e.evaluate('[VRAM[0],VRAM[0x400]]'),[11,22]);
});
test('four-screen CPU and PPU paths retain four distinct nametables',()=>{
 const e=emulator(rom(0,2,1,8));
 e.evaluate('cpuCycles=30000;for(let i=0;i<4;i++){VRAM_ADDR=0x2000+i*0x400;checkWriteOffset(0x2007,10+i)}');
 assert.deepEqual(e.evaluate('[0,1,2,3].map(i=>ppuBusRead(0x2000+i*0x400))'),[10,11,12,13]);
});
test('truncated CHR image is rejected before changing cartridge',()=>{
 const e=emulator();assert.throws(()=>e.load(rom(1,2,2).slice(0,-1)),/Truncated/);
 assert.equal(e.evaluate('mapperNumber'),0);
});
test('APU enable does not load length; disable clears it',()=>{
 const e=emulator();e.evaluate('apuWrite(0x4015,1)');
 assert.equal(e.evaluate('apuRead(0x4015)&15'),0);
 e.evaluate('apuWrite(0x4003,0x18)');assert.equal(e.evaluate('apuRead(0x4015)&15'),1);
 e.evaluate('apuWrite(0x4015,0);apuWrite(0x4015,1)');assert.equal(e.evaluate('apuRead(0x4015)&15'),0);
});
test('frame IRQ is delayed and inhibited through 4017',()=>{
 const e=emulator();e.evaluate('apuResetTiming();apuWrite(0x4017,0)');
 assert.equal(e.evaluate('irqAssert.frame'),false);
 e.evaluate('for(let i=0;i<30000;i++){cpuCycles++;apuClock()}');
 assert.equal(e.evaluate('apuRead(0x4015)&0x40'),0x40);
 e.evaluate('apuWrite(0x4017,0x40)');assert.equal(e.evaluate('irqAssert.frame'),false);
});
test('DMC fetch uses the cartridge bus, not mirrored internal RAM',()=>{
 const bytes=rom();bytes[16+0x4000]=0xa5;const e=emulator(bytes);
 e.evaluate('DMC.currentAddress=0xC000;DMC.bytesRemaining=1;DMC.dmaRequest=true;dmcDoDMA()');
 assert.equal(e.evaluate('DMC.sampleBuffer'),0xa5);
});
test('indexed SLO performs the wrong-page dummy read without an extra cycle',()=>{
 const bytes=rom();bytes.set([0x1f,0xff,0xbf],16);const e=emulator(bytes);
 const result=e.evaluate(`(()=>{
   CPUregisters.PC=0x8000;CPUregisters.X=1;cpuRunning=true;
   const reads=[],original=checkReadOffset;
   checkReadOffset=a=>{reads.push(a);return original(a)};
   const cycles=window.step();checkReadOffset=original;
   return {reads,cycles};
 })()`);
 assert.deepEqual(result.reads,[0x8000,0x8001,0x8002,0xbf00,0xc000]);
 assert.equal(result.cycles,7);
});
