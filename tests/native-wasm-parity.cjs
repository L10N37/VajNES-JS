const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const a=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync('assets/js/audio/apu.wasm')),{}).exports;
const native=execFileSync(process.argv[2]);const expected=new Float32Array(native.buffer,native.byteOffset,native.length/4);
a.audio_reset(48000);a.audio_lengths(15);
for(const [reg,val] of [[0x4000,0x82],[0x4002,253],[0x4003,0],[0x4004,0x5c],[0x4006,160],[0x4007,0],[0x4008,0x81],[0x400a,200],[0x400b,0],[0x400c,0x18],[0x400e,7],[0x400f,0]])a.audio_write(reg,val);
let index=0,maxError=0;
for(let i=0;i<120;i++){
 a.audio_quarter();if(i%2===0)a.audio_half();a.audio_dmc((i*7)&127);a.audio_advance(7457);
 while(a.audio_available()){const value=a.audio_pop();maxError=Math.max(maxError,Math.abs(value-expected[index++]));}
}
if(index!==expected.length || !Number.isFinite(maxError) || maxError>1e-6)throw new Error(`Native/WASM mismatch: ${index}/${expected.length}, error ${maxError}`);
console.log(`Native/WASM parity: ${index} samples, max absolute error ${maxError}`);
