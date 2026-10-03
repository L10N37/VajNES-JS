const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function genie(index={}) {
  const context=vm.createContext({
    console,
    VAJNES_GAME_GENIE_INDEX:index
  });
  const src=fs.readFileSync('assets/js/cheats/game-genie.js','utf8');
  vm.runInContext(src+';globalThis.__genie=VajNESGenie;',context);
  return context.__genie;
}

test('decodes canonical 6-character Game Genie code',()=>{
  const g=genie();
  const decoded=g.decode('SXIOPO');
  assert.equal(decoded.address,0x91d9);
  assert.equal(decoded.data,0xad);
  assert.equal(decoded.compare,null);
});

test('decodes canonical 8-character compare Game Genie code',()=>{
  const g=genie();
  const decoded=g.decode('SLXPLOVS');
  assert.equal(decoded.address,0x9123);
  assert.equal(decoded.data,0xbd);
  assert.equal(decoded.compare,0xde);
});

test('parses Libretro CHT descriptions, codes and multi-code chains',()=>{
  const g=genie();
  const parsed=JSON.parse(JSON.stringify(g.parseCht([
    'cheats = 2',
    'cheat0_desc = "Infinite Lives"',
    'cheat0_code = "SXIOPO"',
    'cheat0_enable = false',
    'cheat1_desc = "Two patches"',
    'cheat1_code = "SXIOPO+SLXPLOVS"',
    'cheat1_enable = false'
  ].join('\n'))));
  assert.deepEqual(parsed,[
    {description:'Infinite Lives',code:'SXIOPO'},
    {description:'Two patches',code:'SXIOPO+SLXPLOVS'}
  ]);
});

test('identifies exact whole-ROM CRC and known payload fallback',()=>{
  const exact={title:'Contra (USA)',path:'Contra (USA) (Game Genie).cht'};
  const g=genie({'52CD5CD8':exact});
  assert.equal(g.identify(0x52cd5cd8,0,'').entry.path,exact.path);
  assert.equal(
    g.identify(0,0xcbf4366f,'').entry.path,
    'Alien Syndrome (USA, Japan) (Game Genie).cht'
  );
});

test('filename fallback is accepted only when matching titles share one cheat set',()=>{
  const g=genie({
    AAAA0001:{title:'Example Game (USA)',path:'Example Game (World) (Game Genie).cht'},
    AAAA0002:{title:'Example Game (Europe)',path:'Example Game (World) (Game Genie).cht'}
  });
  assert.equal(
    g.identify(0,0,'Example Game (U).nes').entry.path,
    'Example Game (World) (Game Genie).cht'
  );

  const ambiguous=genie({
    AAAA0001:{title:'Example Game (USA)',path:'USA.cht'},
    AAAA0002:{title:'Example Game (Europe)',path:'Europe.cht'}
  });
  assert.equal(ambiguous.identify(0,0,'Example Game.nes').entry,null);
});

test('manual Game Genie patches honor compare values and disable-all',()=>{
  const g=genie();
  g.onRomLoaded({mapper:0,fullCrc:1,payloadCrc:2,fileName:'Test.nes'});
  g.addManual('SXIOPO');
  assert.equal(g.patchRomRead(0x91d9,0xce),0xad);
  g.addManual('SLXPLOVS');
  assert.equal(g.patchRomRead(0x9123,0xde),0xbd);
  assert.equal(g.patchRomRead(0x9123,0xdf),0xdf);
  g.disableAll();
  assert.equal(g.patchRomRead(0x91d9,0xce),0xce);
});


test('filters no-op public database codes such as Mach Rider AENIPPAA',()=>{
  const g=genie();
  const decoded=g.decode('AENIPPAA');
  assert.equal(decoded.address,0xd1f1);
  assert.equal(decoded.data,0x00);
  assert.equal(decoded.compare,0x00);

  const parsed=JSON.parse(JSON.stringify(g.parseCht([
    'cheats = 2',
    'cheat0_desc = "Start Any Game With 100,000 Points"',
    'cheat0_code = "AENIPPAA"',
    'cheat0_enable = false',
    'cheat1_desc = "Real code"',
    'cheat1_code = "SXIOPO"',
    'cheat1_enable = false'
  ].join('\n'))));

  assert.deepEqual(parsed,[{description:'Real code',code:'SXIOPO'}]);
  assert.throws(()=>g.addManual('AENIPPAA'),/no-op/);
});
