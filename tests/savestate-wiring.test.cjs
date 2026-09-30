const fs=require('node:fs');
const {test}=require('node:test');
const assert=require('node:assert/strict');

test('save-state file parses and wires AxROM, CHR RAM and PPU pipeline sections',()=>{
  const src=fs.readFileSync('assets/js/save-load.js','utf8');
  assert.doesNotThrow(()=>new Function(src));
  assert.match(src,/typeof mapperNumber !== "undefined"/);
  assert.match(src,/case 7:[\s\S]*axromSaveState/);
  assert.match(src,/buildSection\("CHRR", CHR_ROM\)/);
  assert.match(src,/buildSection\("PPIP", ppuSavePipelineState\(\)\)/);
  assert.match(src,/case "CHRR"/);
  assert.match(src,/case "PPIP"/);
  assert.match(src,/ppuLoadPipelineState\(ppuPipelineBytes\)/);
  assert.match(src,/num32LE\(\(typeof nmiPending/);
});
