const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('disassembler toggle prints to console even when global diagnostics are disabled',()=>{
  const logs=[];
  const context={
    openDisasm:{},
    window:{alert(){}},
    console:{log:(...args)=>logs.push(args.join(' '))},
    NES_DEBUG_LOGGING:false,
    code:0xea,
    OPCODES:Array.from({length:256},()=>({func:function NOP_HANDLER(){}})),
    CPUregisters:{
      PC:0x8123,A:0x12,X:0x34,Y:0x56,S:0xfd,
      P:{N:0,V:0,B:0,D:0,I:1,Z:0,C:1}
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/js/disasm.js','utf8'),context);
  context.openDisasm.onclick();
  vm.runInContext('disasm()',context);
  assert.equal(logs.length,1);
  assert.match(logs[0],/^8123\s+EA/);
  assert.match(logs[0],/A:12 X:34 Y:56 SP:FD/);
});
