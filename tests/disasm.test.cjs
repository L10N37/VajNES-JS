const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const assert=require('node:assert/strict');

function fixture(){
  const logs=[];
  const context={
    openDisasm:{},
    window:{alert(){}},
    console:{log:(...args)=>logs.push(args.join(' '))},
    NES_DEBUG_LOGGING:false,
    code:0xea,
    OPCODES:Array.from({length:256},()=>({pc:1,func:function NOP_HANDLER(){}})),
    CPUregisters:{
      PC:0x8123,A:0x12,X:0x34,Y:0x56,S:0xfd,
      P:{N:0,V:0,B:0,D:0,I:1,Z:0,C:1}
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/js/disasm.js','utf8'),context);
  return {context,logs};
}

test('disassembler buffers at instruction rate instead of flooding console',()=>{
  const {context,logs}=fixture();
  context.openDisasm.onclick();
  vm.runInContext('for(let i=0;i<100000;i++)disasm()',context);
  assert.ok(logs.length<=4,'unexpected console flood: '+logs.length+' writes');
  assert.equal(vm.runInContext('disasmTrace.count',context),4096);
  assert.equal(vm.runInContext('disasmTrace.instructions',context),100000);
});

test('buffered disassembly dump works with global diagnostics disabled',()=>{
  const {context,logs}=fixture();
  context.openDisasm.onclick();
  vm.runInContext('disasm()',context);
  assert.equal(logs.length,0);
  vm.runInContext('dumpDisasmTrace()',context);
  assert.equal(logs.length,1);
  assert.match(logs[0],/VajNES disassembly: last 1 instructions/);
  assert.match(logs[0],/8123\s+EA -- --/);
  assert.match(logs[0],/A:12 X:34 Y:56 SP:FD/);
});

test('disabling buffered disassembly dumps the retained recent trace once',()=>{
  const {context,logs}=fixture();
  context.openDisasm.onclick();
  vm.runInContext('for(let i=0;i<25;i++){CPUregisters.PC=0x8000+i;disasm()}',context);
  context.openDisasm.onclick();
  assert.equal(logs.length,1);
  assert.match(logs[0],/last 25 instructions/);
  assert.match(logs[0],/8018\s+EA/);
  assert.equal(vm.runInContext('disasmRunning',context),false);
});
