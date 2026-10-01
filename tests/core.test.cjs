const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEmulator}=require('./headless.cjs');
function rom(mapper=0,prg=2,chr=1,flags=0,submapper=null) {
 const bytes=new Uint8Array(16+prg*0x4000+chr*0x2000);
 bytes.set([0x4e,0x45,0x53,0x1a,prg,chr,((mapper&15)<<4)|flags,(mapper&0xf0)|(submapper===null?0:8),submapper===null?0:submapper<<4]);
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
test('controller strobe output samples one APU phase, rejecting a short pulse on the other',()=>{
 const e=emulator();
 e.evaluate('joypad1State=255;cpuCycles=1;joypadWrite(0x4016,1);cpuCycles=2;clockJoypadStrobe();joypadWrite(0x4016,0);cpuCycles=4;clockJoypadStrobe()');
 assert.equal(e.evaluate('joypad1State'),0);
 e.evaluate('joypad1State=255;cpuCycles=2;joypadWrite(0x4016,1);cpuCycles=3;clockJoypadStrobe();joypadWrite(0x4016,0);cpuCycles=4;clockJoypadStrobe()');
 assert.equal(e.evaluate('joypad1State'),255);
});
test('inhibited frame flag briefly sets without asserting CPU IRQ',()=>{
 const e=emulator();e.evaluate('apuResetTiming();apuTiming.inhibitIRQ=true;apuTiming.cycle=29827;apuClock()');
 assert.equal(e.evaluate('apuTiming.frameFlag'),true);assert.equal(e.evaluate('irqAssert.frame'),false);
 e.evaluate('apuClock();apuClock()');assert.equal(e.evaluate('apuTiming.frameFlag'),false);
});
test('DMC enable restarts exhausted samples without restarting a running sample',()=>{
 const e=emulator();
 e.evaluate('apuWrite(0x4012,0);apuWrite(0x4013,1);apuWrite(0x4015,0x10)');
 assert.equal(e.evaluate('DMC.bytesRemaining'),17);
 e.evaluate('DMC.bytesRemaining=8;apuWrite(0x4015,0x10)');assert.equal(e.evaluate('DMC.bytesRemaining'),8);
 e.evaluate('DMC.bytesRemaining=0;apuWrite(0x4015,0x10)');assert.equal(e.evaluate('DMC.bytesRemaining'),17);
});
test('DMC DAC steps saturate and disabling the reader retains DAC level',()=>{
 const e=emulator();e.evaluate('DMC.enabled=true;DMC.silence=false;DMC.shiftRegister=1;DMC.outputLevel=126;DMC.timer=0;clockDMC()');
 assert.equal(e.evaluate('DMC.outputLevel'),126);
 e.evaluate('DMC.shiftRegister=0;DMC.outputLevel=1;DMC.timer=0;clockDMC()');assert.equal(e.evaluate('DMC.outputLevel'),1);
 e.evaluate('DMC.sampleBufferFull=true;DMC.sampleBuffer=0xA5;apuWrite(0x4015,0)');assert.equal(e.evaluate('DMC.outputLevel'),1);
});
test('SHY corrupts write address high on page crossing and uses five cycles',()=>{
 const bytes=rom();bytes.set([0x9c,0xff,0x12],16);const e=emulator(bytes);
 e.evaluate('CPUregisters.PC=0x8000;CPUregisters.X=1;CPUregisters.Y=3;cpuRunning=true');
 assert.equal(e.evaluate('window.step()'),5);assert.equal(e.evaluate('systemMemory[0x300]'),3);
});
test('MMC3 PRG mode swaps R6 and the fixed second-last bank; reads drive CPU bus',()=>{
 const bytes=rom(4,8,1);for(let bank=0;bank<16;bank++)bytes.fill(bank,16+bank*8192,16+(bank+1)*8192);const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,6);checkWriteOffset(0x8001,3)');
 assert.deepEqual(e.evaluate('[0x8000,0xa000,0xc000,0xe000].map(checkReadOffset)'),[3,1,14,15]);
 e.evaluate('checkWriteOffset(0x9ffe,0x46)');assert.deepEqual(e.evaluate('[0x8000,0xc000,0xffff].map(checkReadOffset)'),[14,3,15]);assert.equal(e.evaluate('openBus.CPU'),15);
});
test('MMC3 CHR inversion maps all eight slots and CHR ROM ignores writes',()=>{
 const bytes=rom(4,2,4);for(let bank=0;bank<32;bank++)bytes.fill(bank,16+32768+bank*1024,16+32768+(bank+1)*1024);const e=emulator(bytes);
 e.evaluate('mapper4_write_8000(0);mapper4_write_8001(9);mapper4_write_8000(1);mapper4_write_8001(13)');
 assert.deepEqual(e.evaluate('Array.from({length:8},(_,i)=>ppuBusRead(i*1024))'),[8,9,12,13,4,5,6,7]);
 e.evaluate('mapper4_write_8000(0x80);mapper4_chr_write(0,99)');assert.deepEqual(e.evaluate('Array.from({length:8},(_,i)=>ppuBusRead(i*1024))'),[4,5,6,7,8,9,12,13]);
});
test('MMC3 allocates and banks CHR RAM',()=>{
 const e=emulator(rom(4,2,0));assert.equal(e.evaluate('FULL_CHR_ROM.length'),8192);
 e.evaluate('mapper4_write_8000(2);mapper4_write_8001(7);mapper4_chr_write(0x1000,0xa5);mapper4_write_8001(6)');assert.equal(e.evaluate('ppuBusRead(0x1000)'),0);
 e.evaluate('mapper4_write_8001(7)');assert.equal(e.evaluate('ppuBusRead(0x1000)'),0xa5);
});
test('MMC3 PRG RAM enable and write protection are independent',()=>{
 const e=emulator(rom(4));e.evaluate('mapper4_write_A001(0x80);checkWriteOffset(0x6000,42);mapper4_write_A001(0xc0);checkWriteOffset(0x6000,99)');assert.equal(e.evaluate('checkReadOffset(0x6000)'),42);
 e.evaluate('mapper4_write_A001(0);openBus.CPU=0x57');assert.equal(e.evaluate('checkReadOffset(0x6000)'),0x57);
 e.evaluate('mapper4_write_A001(0x80)');assert.equal(e.evaluate('checkReadOffset(0x6000)'),42);
});
test('MMC3 IRQ enable and zero latch do not assert until a filtered rising edge',()=>{
 const e=emulator(rom(4));e.evaluate('mapper4_write_C000(0);mapper4_write_C001();mapper4_write_E001()');assert.equal(e.evaluate('irqAssert.mmc3'),false);
 e.evaluate('ppuCycles+=9;mmc3Irq(0x1000)');assert.equal(e.evaluate('irqAssert.mmc3'),true);
 e.evaluate('mapper4_write_E000();mapper4_write_C000(2);mapper4_write_C001();mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');assert.equal(e.evaluate('mmc3_irq.scanlineCounter'),2);assert.equal(e.evaluate('irqAssert.mmc3'),false);
 e.evaluate('mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');assert.equal(e.evaluate('mmc3_irq.scanlineCounter'),1);
 e.evaluate('mapper4_write_E001();mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');assert.equal(e.evaluate('irqAssert.mmc3'),true);
});
test('MMC3 Sharp and NEC zero-reload IRQ variants follow their silicon rules',()=>{
 const sharp=emulator(rom(4));
 sharp.evaluate('mapper4_write_C000(0);mapper4_write_C001();mapper4_write_E001();ppuCycles+=9;mmc3Irq(0x1000)');
 assert.equal(sharp.evaluate('mmc3_irq.variant'),'sharp');
 assert.equal(sharp.evaluate('irqAssert.mmc3'),true);
 sharp.evaluate('mapper4_write_E000();mapper4_write_E001();mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');
 assert.equal(sharp.evaluate('irqAssert.mmc3'),true);

 const nec=emulator(rom(4,2,1,0,4));
 assert.equal(nec.evaluate('mmc3_irq.variant'),'nec');
 nec.evaluate('mapper4_write_C000(2);mapper4_write_C001();mapper4_write_E001()');
 nec.evaluate('ppuCycles+=9;mmc3Irq(0x1000);mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000);mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');
 assert.equal(nec.evaluate('irqAssert.mmc3'),true);
 nec.evaluate('mapper4_write_E000();mapper4_write_E001();mapper4_write_C000(0);mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');
 assert.equal(nec.evaluate('irqAssert.mmc3'),false);
 nec.evaluate('mapper4_write_C001();mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000)');
 assert.equal(nec.evaluate('irqAssert.mmc3'),true);
});

test('MMC3 rejects short/repeated A12 pulses and ignores activity on other mappers',()=>{
 const e=emulator(rom(4));e.evaluate('mmc3Reset();mapper4_write_C000(3);mapper4_write_C001();for(let i=0;i<100;i++)mmc3Irq(0);mmc3Irq(0x1000)');assert.equal(e.evaluate('mmc3_irq.scanlineCounter'),0);
 e.evaluate('mmc3Irq(0);ppuCycles+=9;mmc3Irq(0x1000);ppuCycles+=100;mmc3Irq(0x1000)');assert.equal(e.evaluate('mmc3_irq.scanlineCounter'),3);
 const nrom=emulator();nrom.evaluate('mapper4_write_E001();ppuCycles+=100;mmc3Irq(0x1000)');assert.equal(nrom.evaluate('irqAssert.mmc3'),false);
});
test('AxROM maps all 32 KiB including vectors; ignores upper register bits',()=>{
 const bytes=rom(7,16,0);const e=emulator(bytes);
 for(let bank=0;bank<8;bank++){
  e.evaluate(`checkWriteOffset(0xffff,${bank|0xe8})`);
  assert.equal(e.evaluate('checkReadOffset(0x8000)'),bank*2);
  assert.equal(e.evaluate('checkReadOffset(0xc000)'),bank*2+1);
 }
 assert.equal(e.evaluate('checkReadOffset(0xfffd)'),0x80);
 const small=emulator(rom(7,4,0));small.evaluate('checkWriteOffset(0x8000,7)');assert.equal(small.evaluate('checkReadOffset(0x8000)'),2);
});
test('AxROM one-screen switching preserves both CIRAM pages across CPU/renderer access',()=>{
 const e=emulator(rom(7,2,0,1));e.evaluate('cpuCycles=40000;VRAM_ADDR=0x2405;checkWriteOffset(0x2007,0x35);checkWriteOffset(0x8000,0x10);VRAM_ADDR=0x2c05;checkWriteOffset(0x2007,0x72)');
 assert.deepEqual(e.evaluate('[0x2005,0x2405,0x2805,0x2c05].map(ppuBusRead)'),[0x72,0x72,0x72,0x72]);
 e.evaluate('checkWriteOffset(0x9000,0);VRAM_ADDR=0x2805;checkReadOffset(0x2007)');assert.equal(e.evaluate('checkReadOffset(0x2007)'),0x35);
 assert.deepEqual(e.evaluate('[0x2005,0x2405,0x2805,0x2c05].map(ppuBusRead)'),[0x35,0x35,0x35,0x35]);
});
test('AxROM CHR RAM stays unbanked and has no cartridge PRG RAM',()=>{
 const e=emulator(rom(7,4,0));e.evaluate('cpuCycles=40000;VRAM_ADDR=0x1234;checkWriteOffset(0x2007,0xa5);checkWriteOffset(0x8000,0x11)');assert.equal(e.evaluate('ppuBusRead(0x1234)'),0xa5);
 e.evaluate('prgRam[0]=0x99;checkWriteOffset(0x6000,0x31);openBus.CPU=0x56');assert.equal(e.evaluate('checkReadOffset(0x6000)'),0x56);assert.equal(e.evaluate('prgRam[0]'),0x99);
});
test('AxROM legacy/no-conflict and explicit AND-conflict board variants',()=>{
 for(const sub of [null,0,1,2]){
  const bytes=rom(7,8,0,0,sub);bytes[16]=0x12;const e=emulator(bytes);
  e.evaluate('checkWriteOffset(0x8000,0x13)');assert.equal(e.evaluate('axromBank'),sub===2?2:3);assert.equal(e.evaluate('MIRRORING'),'single1');
 }
 const bytes=rom(7,8,0,0,2);bytes[16]=1;const e=emulator(bytes);e.evaluate('checkWriteOffset(0x8000,0x11)');assert.equal(e.evaluate('axromBank'),1);assert.equal(e.evaluate('MIRRORING'),'single0');
});
test('AxROM bank write changes the very next opcode fetch',()=>{
 const bytes=rom(7,4,0);bytes.set([0xa9,1,0x8d,0,0x80],16);bytes.set([0xa9,0x5a,0x85,0x20,0x4c,9,0x80],16+0x8000+5);bytes[16+0x7ffc]=0;bytes[16+0x7ffd]=0x80;
 const e=emulator(bytes);e.run(100);assert.equal(e.evaluate('systemMemory[0x20]'),0x5a);assert.equal(e.evaluate('axromBank'),1);
});
test('AxROM rejects unsupported images before replacing a running cartridge',()=>{
 const e=emulator(rom(7,4,0));e.evaluate('checkWriteOffset(0x8000,0x11)');
 for(const bytes of [rom(7,2,1),rom(7,3,0),rom(7,32,0),rom(7,2,0,0,3)])assert.throws(()=>e.load(bytes),/Unsupported AxROM/);
 assert.equal(e.evaluate('axromBank'),1);assert.equal(e.evaluate('MIRRORING'),'single1');
 e.load(rom(7,2,0));assert.equal(e.evaluate('axromBank'),0);assert.equal(e.evaluate('MIRRORING'),'single0');
 const previous=emulator(rom(4));previous.evaluate('irqAssert.mmc3=true');previous.load(rom(7,2,0));assert.equal(previous.evaluate('irqAssert.mmc3'),false);
});
test('PPUMASK rendering enable is delayed by four PPU dots',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;ppuCycles=100;ppuWriteMask(0x18)');
 assert.deepEqual(e.evaluate('[PPUMASK,renderingNow(),ppumaskRenderApplyAt]'),[0x18,false,104]);
 e.evaluate('ppuCycles=103');assert.equal(e.evaluate('renderingNow()'),false);
 e.evaluate('ppuCycles=104');assert.equal(e.evaluate('renderingNow()'),true);
});

test('late PPUMASK enable skips the dot-256 vertical increment used by Battletoads',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;ppuCycles=100;VRAM_ADDR=0;PPUclock.scanline=14;PPUclock.dot=256;ppuWriteMask(0x18);ppuCycles=103;visibleScanline(256)');
 assert.equal(e.evaluate('VRAM_ADDR'),0);
 e.evaluate('ppuCycles=104;visibleScanline(256)');
 assert.equal(e.evaluate('VRAM_ADDR'),0x1001);
});

test('odd-frame skip latch keeps its existing raw PPUMASK timing boundary',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;ppuCycles=100;ppuWriteMask(0x18);PPUclock.scanline=261;PPUclock.dot=338;PPUclock.oddFrame=false;oddSkipRendering=false;ppuTick()');
 assert.deepEqual(e.evaluate('[renderingNow(),oddSkipRendering]'),[false,true]);
 e.evaluate('PPUMASK=0x18;ppumaskRenderHoldBits=0x18;ppumaskRenderApplyAt=-1;ppuCycles=200;ppuWriteMask(0);PPUclock.scanline=261;PPUclock.dot=338;oddSkipRendering=true;ppuTick()');
 assert.deepEqual(e.evaluate('[renderingNow(),oddSkipRendering]'),[true,false]);
});

test('$2002 read on pre-render dot 1 latches vblank but sees cleared sprite flags',()=>{
 const e=emulator();
 e.evaluate('PPUSTATUS=0xe0;openBus.PPU=0;PPUclock.scanline=261;PPUclock.dot=1');
 assert.equal(e.evaluate('checkReadOffset(0x2002)&0xe0'),0x80);
 assert.equal(e.evaluate('PPUSTATUS&0xe0'),0x60);
});

test('$2002 read sees sprite overflow when the scheduled transition occurs on that dot',()=>{
 const e=emulator();
 e.evaluate('PPUSTATUS=0x40;openBus.PPU=0;spriteOverflowSetScanline=10;spriteOverflowSetDot=131;PPUclock.scanline=10;PPUclock.dot=131');
 assert.equal(e.evaluate('checkReadOffset(0x2002)&0x60'),0x60);
});

test('ninth consecutive in-range sprite schedules overflow at evaluation dot 131',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0x18;ppumaskRenderHoldBits=0x18;ppumaskRenderApplyAt=-1;PPUSTATUS=0;OAM.fill(0xff);for(let i=0;i<9;i++){OAM[i*4]=0;OAM[i*4+1]=1;OAM[i*4+2]=0;OAM[i*4+3]=0;}PPUclock.scanline=0;evalSpritesForScanline(spritesNext,1)');
 assert.deepEqual(e.evaluate('[spriteOverflowSetScanline,spriteOverflowSetDot,PPUSTATUS&0x20]'),[0,131,0]);
});

test('forced blank keeps sprite X counters counting while pattern shifters pause',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;spriteXForceZeroNextFrame=false;spritesCur.count=1;spritesCur.xcnt[0]=3;spritesCur.lo[0]=0x81;spritesCur.hi[0]=0x42;PPUclock.scanline=5;PPUclock.dot=10;visibleScanline(10)');
 assert.deepEqual(e.evaluate('[spritesCur.xcnt[0],spritesCur.lo[0],spritesCur.hi[0]]'),[2,0x81,0x42]);
});

test('dot-339 forced-zero latch is retained through blank and applied when rendering resumes',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;spriteXForceZeroNextFrame=true;spritesCur.count=1;spritesCur.xcnt[0]=7;PPUclock.scanline=5;PPUclock.dot=10;visibleScanline(10)');
 assert.deepEqual(e.evaluate('[spritesCur.xcnt[0],spriteXForceZeroNextFrame]'),[6,true]);
 e.evaluate('PPUMASK=0x18;ppumaskRenderHoldBits=0x18;PPUclock.dot=11;visibleScanline(11)');
 assert.deepEqual(e.evaluate('[spritesCur.xcnt[0],spriteXForceZeroNextFrame]'),[0,false]);
});

test('$2007 overlap can feed external PPU data into the next pattern-low fetch',()=>{
 const e=emulator();
 e.evaluate('ppuExternalData=0xaa;ppuCpu2007ReadUntil=ppuCycles+8;CHR_ROM[0x1aa]=0x5a');
 assert.equal(e.evaluate("ppuBackgroundRead(0x0103,'patternLo')"),0x5a);
 assert.deepEqual(e.evaluate('[ppuExternalLatchLow,ppuCpu2007ReadUntil]'),[0xaa,-1]);
});

test('second $2006 write captures the external low-address latch during rendering',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0x18;ppumaskRenderHoldBits=0x18;ppumaskRenderApplyAt=-1;PPUclock.scanline=4;PPUclock.dot=180;VRAM_ADDR=0x2c18;writeToggle=1;t_hi=0x2f;t_lo=0;checkWriteOffset(0x2006,0)');
 assert.equal(e.evaluate('ppuCpu2006HybridLow'),0x19);
 assert.ok(e.evaluate('ppuCpu2006HybridUntil>=ppuCycles'));
});

test('forced blank preserves stale sprite evaluation data',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;spritesNext.count=1;spritesNext.sprite0ListIndex=0;spritesNext.tile[0]=0x55;evalSpritesForScanline(spritesNext,10)');
 assert.deepEqual(e.evaluate('[spritesNext.count,spritesNext.sprite0ListIndex,spritesNext.tile[0]]'),[1,0,0x55]);
});

test('dot 339 forced-zero latch applies on visible scanlines',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;spriteXForceZeroNextFrame=false;PPUclock.scanline=3;PPUclock.dot=339;ppuTick()');
 assert.equal(e.evaluate('spriteXForceZeroNextFrame'),true);
});

test('interrupted sprite-zero fetch keeps the previous active shifter buffer',()=>{
 const e=emulator();
 e.evaluate('PPUMASK=0;ppumaskRenderHoldBits=0;ppumaskRenderApplyAt=-1;spritesCur.count=1;spritesCur.tile[0]=0x11;spritesNext.count=1;spritesNext.tile[0]=0x22;sprite0FetchComplete=false;PPUclock.scanline=5;PPUclock.dot=1;visibleScanline(1)');
 assert.equal(e.evaluate('spritesCur.tile[0]'),0x11);
 e.evaluate('sprite0FetchComplete=true;PPUclock.dot=1;visibleScanline(1)');
 assert.equal(e.evaluate('spritesCur.tile[0]'),0x22);
});

test('background shifter advances after pixel zero without duplicating it',()=>{
 const e=emulator();e.evaluate('spriteXForceZeroNextFrame=false;PPUMASK=0x0a;fineX=0;PPUclock.scanline=0;PPUclock.dot=1;nextLine.t0={lo:0x80,hi:0,at:0};nextLine.t1={lo:0,hi:0,at:0};PALETTE_RAM[0]=0;PALETTE_RAM[1]=0x21;visibleScanline(1);PPUclock.dot=2;visibleScanline(2)');
 assert.deepEqual(e.evaluate('Array.from(paletteIndexFrame.slice(0,2))'),[0x21,0]);
});
test('loading each ROM requests automatic audio startup',()=>{
 let requests=0;const e=createEmulator({reset(){},unlock(){requests++;}});e.load(rom());e.load(rom(7,2,0));assert.equal(requests,2);
});
test('PPUDATA clocks both scroll counters during rendering, including wrap boundaries',()=>{
 const e=emulator();e.evaluate('cpuCycles=40000');
 for(const write of [false,true])for(const mask of [8,16])for(const ctrl of [0,4]){
  for(const [sl,start,want] of [[0,0x2000,0x3001],[239,0x73bf,0xc00],[261,0x73ff,0x400],[240,0x2000,0x2000+(ctrl?32:1)],[241,0x7fff,ctrl?31:0]]){
   e.evaluate(`PPUMASK=${mask};PPUCTRL=${ctrl};PPUclock.scanline=${sl};VRAM_ADDR=${start};${write?'checkWriteOffset(0x2007,0)':'checkReadOffset(0x2007)'}`);
   assert.equal(e.evaluate('VRAM_ADDR'),want,`write=${write}, mask=${mask}, ctrl=${ctrl}, line=${sl}`);
  }
 }
 e.evaluate('PPUMASK=0;PPUCTRL=4;PPUclock.scanline=0;VRAM_ADDR=0x2000;checkReadOffset(0x2007)');assert.equal(e.evaluate('VRAM_ADDR'),0x2020);
});
test('sprite patterns use CHR and size control at fetch time on NROM, MMC3 and AxROM',()=>{
 for(const mapper of [0,4,7]){
  const e=emulator(rom(mapper,2,0));
  e.evaluate('PPUMASK=0x18;PPUCTRL=0x20;OAM.fill(255);OAM.set([0,2,0,0]);OAMADDR=0;evalSpritesForScanline(spritesNext,9);PPUCTRL=0;if(mapperNumber===4)mapper4_chr_write(0x20,0x81);else CHR_ROM[0x20]=0x81;PPUclock.scanline=8;PPUclock.dot=260;renderingBusTick()');
  assert.equal(e.evaluate('spritesNext.lo[0]'),0x81,`mapper ${mapper}`);
  e.evaluate('if(mapperNumber===4)mapper4_chr_write(0x28,0x42);else CHR_ROM[0x28]=0x42;PPUclock.dot=262;renderingBusTick()');assert.equal(e.evaluate('spritesNext.hi[0]'),0x42);
 }
});
function interruptROM() {
 const bytes=rom();bytes[16]=0x00;bytes[17]=0xea;
 bytes[16+0x1000]=0xea;bytes[16+0x2000]=0xea;
 bytes.set([0,0xa0,0,0x80,0,0x90],16+0x7ffa);
 return bytes;
}
test('BRK uses seven bus cycles, skips its padding byte and stacks B without setting decimal',()=>{
 const e=emulator(interruptROM());
 const result=e.evaluate(`(()=>{
  const start=cpuCycles,reads=[],writes=[],read=checkReadOffset,write=cpuWrite;
  checkReadOffset=a=>{reads.push([cpuCycles-start,a]);return read(a)};
  cpuWrite=(a,v)=>{writes.push([cpuCycles-start,a,v]);return write(a,v)};
  cpuRunning=true;const cycles=window.step();checkReadOffset=read;cpuWrite=write;
  return {cycles,reads,writes,pc:CPUregisters.PC,decimal:CPUregisters.P.D};
 })()`);
 assert.deepEqual(result,{cycles:7,reads:[[0,0x8000],[1,0x8001],[5,0xfffe],[6,0xffff]],writes:[[2,0x1fd,0x80],[3,0x1fc,2],[4,0x1fb,0x34]],pc:0x9000,decimal:0});
});
test('NMI takeover window preserves BRK stack and defers later edges until after a handler instruction',()=>{
 for(let edgeCycle=1;edgeCycle<=7;edgeCycle++){
  const e=emulator(interruptROM());
  const result=e.evaluate(`(()=>{
   const clock=consumeCycle;let cycles=0;
   consumeCycle=()=>{if(++cycles===${edgeCycle})PPU_FRAME_FLAGS|=4;clock()};
   cpuRunning=true;const used=window.step();consumeCycle=clock;
   return {used,pc:CPUregisters.PC,stack:Array.from(systemMemory.slice(0x1fb,0x1fe))};
  })()`);
  assert.equal(result.used,7);assert.equal(result.pc,edgeCycle<=4?0xa000:0x9000);
  assert.deepEqual(result.stack,[0x34,2,0x80]);
  if(edgeCycle>=5){
   assert.equal(e.evaluate('window.step()'),9);
   assert.equal(e.evaluate('CPUregisters.PC'),0xa000);
   assert.equal(e.evaluate('systemMemory[0x1f9]'),1); // Return after the handler's NOP.
  }else{
   assert.equal(e.evaluate('window.step()'),2); // Taken NMI is not serviced twice.
  }
 }
});
test('IRQ reads PC twice before stacking and permits NMI takeover without stacking B',()=>{
 for(const hijack of [false,true]){
  const e=emulator(interruptROM());
  const result=e.evaluate(`(()=>{
   const start=cpuCycles,reads=[],read=checkReadOffset,clock=consumeCycle;let clocks=0;
   CPUregisters.P.I=0;
   checkReadOffset=a=>{reads.push([cpuCycles-start,a]);return read(a)};
   consumeCycle=()=>{if(++clocks===4 && ${hijack})PPU_FRAME_FLAGS|=4;clock()};
   serviceIRQ();checkReadOffset=read;consumeCycle=clock;
   return {cycles:cpuCycles-start,reads,pc:CPUregisters.PC,stack:Array.from(systemMemory.slice(0x1fb,0x1fe))};
  })()`);
  assert.deepEqual(result,{cycles:7,reads:[[0,0x8000],[1,0x8000],[5,hijack?0xfffa:0xfffe],[6,hijack?0xfffb:0xffff]],pc:hijack?0xa000:0x9000,stack:[0x20,0,0x80]});
 }
});
test('DMC load requests wait for the next read and fetch on the get phase',()=>{
 for(const start of [100,101]){
  const bytes=rom();bytes[16+0x4000]=0xa5;const e=emulator(bytes);
  e.evaluate(`cpuCycles=${start};DMC.timer=100;dmcSetSampleAddressFrom4012(0);dmcSetSampleLengthFrom4013(0);dmcWrite4015(0x10)`);
  const ready=start+((start&1)?4:3);assert.equal(e.evaluate('DMC.dmaAt'),ready);
  e.evaluate(`while(cpuCycles<${ready})consumeCycle();checkWriteOffset(0,0x37);consumeCycle()`);
  assert.equal(e.evaluate('DMC.fetchCount'),0); // RDY cannot stop a write.
  const result=e.evaluate('(()=>{const before=cpuCycles;const value=checkReadOffset(0);return {value,stolen:cpuCycles-before,buffer:DMC.sampleBuffer,remaining:DMC.bytesRemaining,phase:cpuCycles&1}})()');
  assert.deepEqual(result,{value:0x37,stolen:4,buffer:0xa5,remaining:0,phase:0});
 }
});
test('DMC halt retries PPUDATA and leaves the sample byte on a floating CPU bus',()=>{
 const bytes=rom();bytes[16+0x4000]=0x5a;
 for(const start of [100,101]){
  const e=emulator(bytes);
  e.evaluate(`cpuCycles=${start};DMC.timer=100;DMC.currentAddress=0xc000;DMC.bytesRemaining=1;DMC.dmaRequest=true;DMC.dmaAt=0;PPUMASK=0;VRAM_ADDR=0x2000;VRAM_DATA=9;VRAM.set([10,11,12,13]);`);
  assert.equal(e.evaluate('checkReadOffset(0x2007)'),start&1?11:12);
  assert.equal(e.evaluate('VRAM_ADDR'),0x2000+(start&1?3:4));
  e.evaluate(`cpuCycles=${start};DMC.currentAddress=0xc000;DMC.bytesRemaining=1;DMC.dmaRequest=true;code=0xad;openBus.CPU=0x40;`);
  assert.equal(e.evaluate('checkReadOffset(0x5000)'),0x5a);
 }
});
test('DMC disable preserves buffered audio and timer phase; rate writes do not restart the divider',()=>{
 const e=emulator();e.evaluate('DMC.timer=20;DMC.bitsRemaining=3;DMC.sampleBuffer=0xa5;DMC.sampleBufferFull=true;DMC.shiftRegister=7;DMC.silence=false;dmcWrite4015(0);dmcSetControlFrom4010(15)');
 assert.deepEqual(e.evaluate('[DMC.timer,DMC.bitsRemaining,DMC.sampleBufferFull,DMC.shiftRegister,DMC.silence]'),[20,3,true,7,false]);
 e.evaluate('consumeCycle()');assert.equal(e.evaluate('DMC.timer'),19);
 e.evaluate('dmcSetSampleLengthFrom4013(1);dmcWrite4015(0x10)');assert.equal(e.evaluate('DMC.dmaRequest'),false);assert.equal(e.evaluate('DMC.bitsRemaining'),3);
});
test('overlapping DMC load and output reload cannot fetch past a one-byte sample',()=>{
 const e=emulator();e.evaluate('cpuCycles=101;DMC.timer=0;DMC.bitsRemaining=1;DMC.bytesRemaining=1;DMC.currentAddress=0xc000;DMC.sampleBufferFull=false;DMC.loop=false;DMC.dmaRequest=true;DMC.dmaAt=0;checkReadOffset(0)');
 assert.equal(e.evaluate('DMC.bytesRemaining'),0);assert.equal(e.evaluate('DMC.fetchCount'),1);assert.equal(e.evaluate('DMC.dmaRequest'),false);
 e.evaluate('checkReadOffset(1)');assert.equal(e.evaluate('DMC.fetchCount'),1);
});
test('implied instructions read the next address; stack pulls include both dummy reads',()=>{
 for(const opcode of [0xea,0x18,0x58,0xe8,0xaa,0x0a]){
  const bytes=rom();bytes[16]=opcode;const e=emulator(bytes);
  const trace=e.evaluate('(()=>{const read=checkReadOffset,reads=[];checkReadOffset=a=>{reads.push(a);return read(a)};cpuRunning=true;const cycles=window.step();checkReadOffset=read;return {reads,cycles}})()');
  assert.deepEqual(trace,{reads:[0x8000,0x8001],cycles:2});
 }
 const bytes=rom();bytes[16]=0x68;const e=emulator(bytes);
 const trace=e.evaluate('(()=>{systemMemory[0x1fe]=0x81;const read=checkReadOffset,reads=[];checkReadOffset=a=>{reads.push(a);return read(a)};cpuRunning=true;const cycles=window.step();checkReadOffset=read;return {reads,cycles,a:CPUregisters.A}})()');
 assert.deepEqual(trace,{reads:[0x8000,0x8001,0x1fd,0x1fe],cycles:4,a:0x81});
});
test('APU status bit 5 uses the internal latch while DMA only updates the external bus',()=>{
 for(const [internal,sample] of [[0,0x20],[0x20,0]]){
  const bytes=rom();bytes[16+0x4000]=sample;const e=emulator(bytes);
  e.evaluate(`cpuCycles=101;checkWriteOffset(0,${internal});DMC.timer=100;DMC.currentAddress=0xc000;DMC.bytesRemaining=1;DMC.dmaRequest=true;dmcDoDMA(0x4015)`);
  assert.equal(e.evaluate('openBus.CPU'),sample);assert.equal(e.evaluate('openBus.internal'),internal);
  assert.equal(e.evaluate('checkReadOffset(0x4015)&0x20'),internal);
  assert.equal(e.evaluate('openBus.CPU'),sample); // Status reads do not drive external pins.
 }
 const e=emulator();e.evaluate('PPUMASK=0;OAMADDR=0;OAM[0]=0x20;checkReadOffset(0x2004)');
 assert.deepEqual(e.evaluate('[openBus.internal,openBus.CPU,checkReadOffset(0x4015)&0x20]'),[0x20,0x20,0x20]);
});
test('all five unstable stores lose their high-byte mask only when DMA halts the dummy read',()=>{
 for(const opcode of [0x93,0x9f,0x9b,0x9c,0x9e])for(const haltAddress of [0,0x8001,0x500]){
  const bytes=rom();bytes.set(opcode===0x93?[opcode,0x20]:[opcode,0,5],16);const e=emulator(bytes);
  e.evaluate(`CPUregisters.A=0x8f;CPUregisters.X=${opcode===0x9c?0:opcode===0x9e?0x8f:255};CPUregisters.Y=${opcode===0x9c?0x8f:0};systemMemory[0x20]=0;systemMemory[0x21]=5;DMC.timer=100;DMC.currentAddress=0xc000;DMC.bytesRemaining=1;`);
  e.evaluate(`(()=>{const original=checkReadOffset;let armed=${haltAddress!==0};checkReadOffset=a=>{if(armed && a===${haltAddress}){armed=false;DMC.dmaRequest=true;DMC.dmaAt=0;}return original(a)};cpuRunning=true;window.step();checkReadOffset=original;})()`);
  assert.equal(e.evaluate('systemMemory[0x500]'),haltAddress===0x500?0x8f:6,`opcode ${opcode.toString(16)}, halt ${haltAddress.toString(16)}`);
  if(opcode===0x9b)assert.equal(e.evaluate('CPUregisters.S'),0x8f);
 }
});
test('DMC sample low bits decode APU registers only when the CPU is halted in $4000-$401F',()=>{
 for(const haltedAddress of [0x4000,0x4020,0x8000]){
  const bytes=rom();bytes[16+0x4015]=0xff;const e=emulator(bytes);
  e.evaluate(`cpuCycles=101;DMC.timer=100;DMC.currentAddress=0xc015;DMC.bytesRemaining=1;DMC.dmaRequest=true;apuTiming.frameFlag=true;irqAssert.frame=true;dmcDoDMA(${haltedAddress});consumeCycle();consumeCycle()`);
  assert.equal(e.evaluate('DMC.sampleBuffer'),0xff);
  assert.equal(e.evaluate('apuTiming.frameFlag'),haltedAddress!==0x4000);
 }
 for(const [sample,bit] of [[0,1],[255,0]])for(const address of [0xc016,0xc036,0xc017]){
  const bytes=rom();bytes[16+address-0x8000]=sample;const e=emulator(bytes);
  e.evaluate(`cpuCycles=101;DMC.timer=100;DMC.currentAddress=${address};DMC.bytesRemaining=1;DMC.dmaRequest=true;joypad1State=joypad2State=${bit};dmcDoDMA(0x4000)`);
  assert.equal(e.evaluate('DMC.sampleBuffer'),(sample&254)|bit);
  assert.equal(e.evaluate('openBus.CPU'),(sample&254)|bit);
 }
});


test('OAM DMA source $40xx does not activate APU registers when halted CPU bus is elsewhere',()=>{
 const e=emulator();
 e.evaluate("CPUregisters.PC=0x8000;openBus.CPU=0x40;apuTiming.frameFlag=true;irqAssert.frame=true;DMA.active=true;DMA.pad=0;DMA.addr=0x4015;DMA.index=0x15;DMA.phase='get';dmaMicroStep()");
 assert.equal(e.evaluate('DMA.tmp'),0x40);
 assert.equal(e.evaluate('apuTiming.frameFlag'),true);
});

test('OAM DMA aliases APU status through low five source bits when halted CPU bus activates decoder',()=>{
 const e=emulator();
 e.evaluate("CPUregisters.PC=0x4001;openBus.CPU=0x40;apuTiming.frameFlag=true;irqAssert.frame=true;apuTiming.length[2]=1;DMA.active=true;DMA.pad=0;DMA.addr=0x5015;DMA.index=0x15;DMA.phase='get';dmaMicroStep()");
 assert.equal(e.evaluate('DMA.tmp'),0x44);
});

test('OAM DMA put preserves external CPU bus only during active APU decode window',()=>{
 for(const [pc,wantBus] of [[0x4001,0x40],[0x8000,0x44]]){
  const e=emulator();
  e.evaluate(`CPUregisters.PC=${pc};openBus.CPU=0x40;OAMADDR=0;DMA.active=true;DMA.pad=0;DMA.addr=0x5000;DMA.index=0;DMA.tmp=0x44;DMA.phase='put';dmaMicroStep()`);
  assert.equal(e.evaluate('OAM[0]'),0x44);
  assert.equal(e.evaluate('openBus.CPU'),wantBus);
 }
});

test('driven OAM DMA source keeps controller alias off external data while still clocking it',()=>{
 const e=emulator();
 e.evaluate("CPUregisters.PC=0x4001;systemMemory[0x216]=0xff;joypad1State=0;joypad1Shift=0x55;DMA.active=true;DMA.pad=0;DMA.addr=0x0216;DMA.index=0x16;DMA.phase='get';dmaMicroStep()");
 assert.equal(e.evaluate('DMA.tmp'),0xff);
});

test('CNROM selects 8 KiB CHR banks while PRG stays fixed',()=>{
 const e=emulator(rom(3,2,4,0,1));
 assert.deepEqual(e.evaluate('[ppuBusRead(0),ppuBusRead(0x1000),checkReadOffset(0x8000),checkReadOffset(0xc000)]'),[0,1,0,1]);
 e.evaluate('checkWriteOffset(0x8000,3)');
 assert.deepEqual(e.evaluate('[ppuBusRead(0),ppuBusRead(0x1000)]'),[6,7]);
});
test('CNROM legacy/submapper 2 applies AND bus conflicts',()=>{
 for(const sub of [null,0,2]){
  const bytes=rom(3,2,4,0,sub);bytes[16]=1;const e=emulator(bytes);
  e.evaluate('checkWriteOffset(0x8000,3)');
  assert.equal(e.evaluate('cnromChrBank'),1);
 }
});
test('CNROM submapper 1 disables bus conflicts',()=>{
 const bytes=rom(3,2,4,0,1);bytes[16]=1;const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,3)');
 assert.equal(e.evaluate('cnromChrBank'),3);
});
test('CNROM mirrors a 16 KiB PRG image into both CPU halves',()=>{
 const e=emulator(rom(3,1,2,0,1));
 assert.deepEqual(e.evaluate('[checkReadOffset(0x8000),checkReadOffset(0xc000),checkReadOffset(0xfffd)]'),[0,0,0x80]);
});
test('Color Dreams switches 32 KiB PRG and 8 KiB CHR from one register',()=>{
 const bytes=rom(11,8,8);for(let b=0;b<4;b++)bytes[16+b*0x8000]=0xff;const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,0x32)');
 assert.deepEqual(e.evaluate('[colorDreamsPrgBank,colorDreamsChrBank,checkReadOffset(0x8001),ppuBusRead(0)]'),[2,3,4,6]);
});
test('Color Dreams write value is ANDed with ROM bus data',()=>{
 const bytes=rom(11,8,8);bytes[16]=0x11;const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,0x32)');
 assert.deepEqual(e.evaluate('[colorDreamsPrgBank,colorDreamsChrBank]'),[0,1]);
});
test('Color Dreams exposes no cartridge RAM at $6000',()=>{
 const e=emulator(rom(11,2,1));e.evaluate('prgRam[0]=0x99;openBus.CPU=0x5a;checkWriteOffset(0x6000,1);openBus.CPU=0x5a');
 assert.deepEqual(e.evaluate('[checkReadOffset(0x6000),prgRam[0]]'),[0x5a,0x99]);
});
test('GxROM switches its 32 KiB PRG and 8 KiB CHR banks',()=>{
 const bytes=rom(66,8,4);for(let b=0;b<4;b++)bytes[16+b*0x8000]=0xff;const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,0x31)');
 assert.deepEqual(e.evaluate('[gxromPrgBank,gxromChrBank,checkReadOffset(0x8001),ppuBusRead(0)]'),[3,1,6,2]);
});
test('GxROM discrete write has ROM bus conflicts',()=>{
 const bytes=rom(66,8,4);bytes[16]=0x11;const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0x8000,0x32)');
 assert.deepEqual(e.evaluate('[gxromPrgBank,gxromChrBank]'),[1,0]);
});
test('GxROM has no PRG RAM window',()=>{
 const e=emulator(rom(66,2,1));e.evaluate('prgRam[0]=0x99;openBus.CPU=0x46;checkWriteOffset(0x6000,1);openBus.CPU=0x46');
 assert.deepEqual(e.evaluate('[checkReadOffset(0x6000),prgRam[0]]'),[0x46,0x99]);
});
test('MMC2 maps one selectable and three fixed 8 KiB PRG banks',()=>{
 const bytes=rom(9,8,4);for(let b=0;b<16;b++)bytes.fill(b,16+b*0x2000,16+(b+1)*0x2000);const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0xa000,5)');
 assert.deepEqual(e.evaluate('[0x8000,0xa000,0xc000,0xe000].map(checkReadOffset)'),[5,13,14,15]);
});
test('MMC2 CHR latch switches after the triggering pattern byte is read',()=>{
 const bytes=rom(9,8,8);for(let b=0;b<16;b++)bytes.fill(b,16+0x20000+b*0x1000,16+0x20000+(b+1)*0x1000);const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0xb000,2);checkWriteOffset(0xc000,3);checkWriteOffset(0xd000,4);checkWriteOffset(0xe000,5)');
 assert.equal(e.evaluate('ppuBusRead(0x0200)'),3);
 assert.equal(e.evaluate('ppuBusRead(0x0fd8)'),3);
 assert.equal(e.evaluate('ppuBusRead(0x0200)'),2);
 assert.equal(e.evaluate('ppuBusRead(0x1fd8)'),5);
 assert.equal(e.evaluate('ppuBusRead(0x1200)'),4);
});
test('MMC2 mirroring register preserves CIRAM contents',()=>{
 const e=emulator(rom(9,8,4));e.evaluate('VRAM[0]=11;VRAM[0x400]=22;checkWriteOffset(0xf000,1)');
 assert.deepEqual(e.evaluate('[MIRRORING,ppuBusRead(0x2000),ppuBusRead(0x2400)]'),['horizontal',11,11]);
 e.evaluate('checkWriteOffset(0xf000,0)');
 assert.deepEqual(e.evaluate('[MIRRORING,ppuBusRead(0x2000),ppuBusRead(0x2400)]'),['vertical',11,22]);
});
test('MMC2 has no PRG RAM window',()=>{
 const e=emulator(rom(9,8,4));e.evaluate('prgRam[0]=0x7c;openBus.CPU=0x33;checkWriteOffset(0x6000,9);openBus.CPU=0x33');
 assert.deepEqual(e.evaluate('[checkReadOffset(0x6000),prgRam[0]]'),[0x33,0x7c]);
});
test('MMC4 maps a selectable 16 KiB bank plus the fixed last bank',()=>{
 const bytes=rom(10,8,4);for(let b=0;b<8;b++)bytes.fill(b,16+b*0x4000,16+(b+1)*0x4000);const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0xa000,3)');
 assert.deepEqual(e.evaluate('[checkReadOffset(0x8000),checkReadOffset(0xc000)]'),[3,7]);
});
test('MMC4 latch reacts to the complete FD8-FDF and FE8-FEF ranges',()=>{
 const bytes=rom(10,8,8);for(let b=0;b<16;b++)bytes.fill(b,16+0x20000+b*0x1000,16+0x20000+(b+1)*0x1000);const e=emulator(bytes);
 e.evaluate('checkWriteOffset(0xb000,6);checkWriteOffset(0xc000,7)');
 assert.equal(e.evaluate('ppuBusRead(0x0fdf)'),7);
 assert.equal(e.evaluate('ppuBusRead(0x0100)'),6);
 assert.equal(e.evaluate('ppuBusRead(0x0fef)'),6);
 assert.equal(e.evaluate('ppuBusRead(0x0100)'),7);
});
test('MMC4 keeps an 8 KiB PRG RAM window',()=>{
 const e=emulator(rom(10,8,4));e.evaluate('checkWriteOffset(0x6000,0xa5)');
 assert.equal(e.evaluate('checkReadOffset(0x6000)'),0xa5);
});
test('loader accepts all newly supported mapper IDs and rejects CNROM CHR RAM',()=>{
 for(const [m,p,c] of [[3,2,1],[9,8,4],[10,8,4],[11,2,1],[66,2,1]]) {
  const e=emulator(rom(m,p,c,m===3?0:0,m===3?1:null));
  assert.equal(e.evaluate('mapperNumber'),m);
 }
 const e=emulator();assert.throws(()=>e.load(rom(3,2,0,0,1)),/Unsupported CNROM/);
});


test('DMC reload waits for a recent $4015 reader enable and then uses a 3-cycle DMA',()=>{
 const e=emulator();
 const result=e.evaluate(`(()=>{
   cpuCycles=100;
   DMC.timer=0;
   DMC.bitsRemaining=1;
   DMC.sampleBuffer=0x55;
   DMC.sampleBufferFull=true;
   DMC.silence=false;
   DMC.bytesRemaining=0;
   dmcSetSampleLengthFrom4013(0);
   dmcWrite4015(0x10);
   const enableAt=DMC.readerEnableAt;
   consumeCycle();
   const scheduled={at:DMC.dmaAt,kind:DMC.dmaKind,enableAt};
   const f0=DMC.fetchCount;
   checkReadOffset(0); consumeCycle();
   const f1=DMC.fetchCount;
   checkReadOffset(0); consumeCycle();
   const f2=DMC.fetchCount;
   const before=cpuCycles;
   checkReadOffset(0);
   return {scheduled,f0,f1,f2,fetches:DMC.fetchCount,stolen:cpuCycles-before};
 })()`);
 assert.equal(result.scheduled.kind,'reload');
 assert.equal(result.scheduled.enableAt,103);
 assert.equal(result.f0,0);
 assert.equal(result.f1,0);
 assert.equal(result.f2,0);
 assert.equal(result.fetches,1);
 assert.equal(result.stolen,3);
});
