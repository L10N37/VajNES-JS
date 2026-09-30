const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Run the unchanged browser core with only presentation/event APIs stubbed.
function createEmulator(audio) {
  const files = ['shared-assets.js','mapper.js','memory.js','6502.js',
    'mappers/uxrom.js','mappers/axrom.js','mappers/mmc1.js','mappers/mmc3.js','mappers/banked.js','mappers/vrc6.js','audio/expansion-audio.js','readFile.js','disasm.js',
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
      state:()=>({cpuCycles,pc:CPUregisters.PC,frame:PPUclock.frame,ram:Array.from(systemMemory)}),
      evaluate:expression=>eval(expression)
    };
  `)(audio);
}
module.exports = {createEmulator};
