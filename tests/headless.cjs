const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Run the unchanged browser core with only presentation/event APIs stubbed.
function createEmulator(audio) {
  const files = ['shared-assets.js','mapper.js','memory.js','6502.js',
    'mappers/uxrom.js','mappers/axrom.js','mappers/mmc1.js','mappers/mmc3.js','mappers/mmc5.js','mappers/banked.js','mappers/210.js','mappers/vrc6.js','mappers/fme7.js','mappers/rambo1.js','mappers/206.js','mappers/71.js','audio/expansion-audio.js','cheats/game-genie.js','readFile.js','disasm.js',
    'cpu-open-bus.js','dma/oam-dma.js','dma/dmc-dma.js','helpers.js',
    'interrupts.js','memoryMaps.js','offsetsHandler.js','APU.js','cpu-loop.js','ppu-loop.js'];
  const source = files.map(f => fs.readFileSync(path.join(root,'assets/js',f),'utf8')).join('\n;\n');
  return new Function('NESAudio', `
    const noop = () => {};
    const window = {addEventListener:noop, confirm:()=>false, alert:message=>{throw new Error(message)}};
    const button = {replaceWith:noop, cloneNode:()=>button, addEventListener:noop};
    const document = {getElementById:()=>button,addEventListener:noop};
    const console = {debug:noop,log:noop,warn:noop};
    const NoSignalAudio = {setEnabled:noop};
    const openDisasm = {}, resetButton = {};
    const requestAnimationFrame = noop, setInterval = noop;
    const blitNESFramePaletteIndex = noop;
    const wramPopulate=noop,vramPopulate=noop,prgRomPopulate=noop;
    const cpuRegisterBitsPopulate=noop,cpuStatusRegisterPopulate=noop,ppuRegisterBitsPopulate=noop;
    const pause=()=>window.pause();
    ${source}
    const flatTestRam=new Uint8Array(0x10000);
    let flatTouched=[];

    function singleStepFlat(test) {
      for(const addr of flatTouched) flatTestRam[addr]=0;
      flatTouched=[];

      for(const pair of test.initial.ram||[]) {
        const addr=pair[0]&0xFFFF;
        flatTestRam[addr]=pair[1]&0xFF;
        flatTouched.push(addr);
      }

      const bus=[];
      const originalRead=checkReadOffset;
      const originalWrite=checkWriteOffset;
      const originalCpuRead=cpuRead;
      const originalCpuWrite=cpuWrite;
      const originalConsumeCycle=consumeCycle;

      const flatRead=address=>{
        const addr=address&0xFFFF;
        const value=flatTestRam[addr]&0xFF;
        bus.push([addr,value,'read']);
        return value;
      };
      const flatWrite=(address,value)=>{
        const addr=address&0xFFFF, byte=value&0xFF;
        bus.push([addr,byte,'write']);
        flatTestRam[addr]=byte;
        flatTouched.push(addr);
      };

      checkReadOffset=flatRead;
      cpuRead=flatRead;
      checkWriteOffset=(address,value)=>flatWrite(address,value);
      cpuWrite=(address,value)=>flatWrite(address,value);
      // SingleStepTests exercise the CPU against a flat memory bus. Keep the
      // CPU core's cycle count but suppress PPU/APU/DMA/interrupt side effects.
      consumeCycle=()=>{cpuCycles++;};

      const initialP=test.initial.p&0xFF;
      CPUregisters.PC=test.initial.pc&0xFFFF;
      CPUregisters.S=test.initial.s&0xFF;
      CPUregisters.A=test.initial.a&0xFF;
      CPUregisters.X=test.initial.x&0xFF;
      CPUregisters.Y=test.initial.y&0xFF;
      CPUregisters.P={
        C:(initialP>>>0)&1,
        Z:(initialP>>>1)&1,
        I:(initialP>>>2)&1,
        D:(initialP>>>3)&1,
        V:(initialP>>>6)&1,
        N:(initialP>>>7)&1
      };

      cpuRunning=true;
      disasmRunning=false;
      DMA.active=false;
      DMC.dmaRequest=false;
      DMC.dmaBusy=false;
      DMC.dmaKind='';
      nmiPending=0;
      nmiPollCurrent=nmiPollPrevious=nmiSignalSeen=false;
      irqPollCurrent=irqPollPrevious=false;
      for(const key of Object.keys(irqAssert)) irqAssert[key]=false;

      const before=cpuCycles;
      let error=null;
      try {
        window.step();
      } catch(ex) {
        error=String(ex);
      }

      const p=(initialP&0x30) |
        ((CPUregisters.P.C&1)<<0) |
        ((CPUregisters.P.Z&1)<<1) |
        ((CPUregisters.P.I&1)<<2) |
        ((CPUregisters.P.D&1)<<3) |
        ((CPUregisters.P.V&1)<<6) |
        ((CPUregisters.P.N&1)<<7);

      const finalRam=(test.final.ram||[]).map(pair=>[
        pair[0]&0xFFFF,flatTestRam[pair[0]&0xFFFF]&0xFF
      ]);
      const result={
        pc:CPUregisters.PC&0xFFFF,
        s:CPUregisters.S&0xFF,
        a:CPUregisters.A&0xFF,
        x:CPUregisters.X&0xFF,
        y:CPUregisters.Y&0xFF,
        p:p&0xFF,
        ram:finalRam,
        cycles:(cpuCycles-before)|0,
        bus,
        error
      };

      checkReadOffset=originalRead;
      checkWriteOffset=originalWrite;
      cpuRead=originalCpuRead;
      cpuWrite=originalCpuWrite;
      consumeCycle=originalConsumeCycle;
      return result;
    }

    return {
      load:loadRom,
      run(cycles) {
        cpuRunning=true;
        const end=cpuCycles+cycles;
        let idleSteps=0;
        while(cpuRunning && cpuCycles<end) {
          const before=cpuCycles;
          window.step();
          if(cpuCycles===before) {
            if(!cpuRunning || ++idleSteps>2) throw new Error('CPU made no progress');
          } else idleSteps=0;
        }
      },
      buttons(value) {joypad1Buttons=value;},
      runFrames(count) {
        cpuRunning=true;
        const target=PPUclock.frame+count;
        let idleSteps=0;
        while(cpuRunning && PPUclock.frame<target) {
          const before=cpuCycles;
          window.step();
          if(cpuCycles===before) {
            if(!cpuRunning || ++idleSteps>2) throw new Error('CPU made no progress');
          } else idleSteps=0;
        }
      },
      frameIndices:()=>Uint8Array.from(paletteIndexFrame),
      frameEmphasis:()=>Uint8Array.from(paletteEmphasisFrame),
      state:()=>({cpuCycles,pc:CPUregisters.PC,frame:PPUclock.frame,ram:Array.from(systemMemory)}),
      singleStepFlat,
      detectExpansion(bytes,mapper,isNES2) {
        return detectExpansionAudio(bytes,bytes.subarray(0,16),mapper,isNES2);
      },
      evaluate:expression=>eval(expression)
    };
  `)(audio);
}
module.exports = {createEmulator};
