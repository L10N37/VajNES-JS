const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('cloud save UI uses ten per-game local slots and Drive sync',()=>{
  const cloud=fs.readFileSync('assets/js/cloud-saves.js','utf8');
  assert.match(cloud,/const SLOT_COUNT = Number\(cfg\.slotCount\) \|\| 10/);
  assert.match(cloud,/indexedDB\.open\(DB_NAME,DB_VERSION\)/);
  assert.match(cloud,/selected:\$\{game\.key\}/);
  assert.match(cloud,/slot-\$\{String\(slot\)\.padStart\(2,'0'\)\}\.state/);
  assert.match(cloud,/Google Drive connected/);
  assert.match(cloud,/Alt\+1…9 \/ Alt\+0/);
});

test('cloud saves use Google drive.file scope and VajNES/game folders',()=>{
  const cfg=fs.readFileSync('assets/js/cloud-config.js','utf8');
  const cloud=fs.readFileSync('assets/js/cloud-saves.js','utf8');
  assert.match(cfg,/https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
  assert.match(cfg,/rootFolderName: "VajNES"/);
  assert.match(cloud,/application\/vnd\.google-apps\.folder/);
  assert.match(cloud,/safeGameFolder\(model\.game\)/);
  assert.match(cloud,/payloadCrcHex/);
});

test('save/load engine exposes in-memory state bytes for cloud slots',()=>{
  const sl=fs.readFileSync('assets/js/save-load.js','utf8');
  assert.match(sl,/window\.VajNESStateIO/);
  assert.match(sl,/buildStateBytes\(\)/);
  assert.match(sl,/applyStateBytes\(bytes\)/);
});

test('ROM loader publishes stable CRC-based game identity',()=>{
  const rf=fs.readFileSync('assets/js/readFile.js','utf8');
  assert.match(rf,/window\.VajNESCurrentGame/);
  assert.match(rf,/payloadCrcHex/);
  assert.match(rf,/vajnes-rom-loaded/);
});


test('cloud save slots expose direct Save and Load controls',()=>{
  const cloud=fs.readFileSync('assets/js/cloud-saves.js','utf8');
  const css=fs.readFileSync('assets/css/style.css','utf8');
  assert.match(cloud,/saveSlotDirect/);
  assert.match(cloud,/loadSlotDirect/);
  assert.match(cloud,/cloud-slot-save/);
  assert.match(cloud,/cloud-slot-load/);
  assert.match(cloud,/Overwrite Slot \$\{slot\}\?/);
  assert.match(css,/\.cloud-slot-actions/);
  assert.match(css,/\.cloud-slot-action/);
});
