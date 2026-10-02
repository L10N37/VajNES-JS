const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('screen preferences persist across refresh through stable localStorage keys',()=>{
  const palette=fs.readFileSync('assets/js/screen/palettes.js','utf8');
  const screen=fs.readFileSync('assets/js/screen/screen.js','utf8');
  const scanlines=fs.readFileSync('assets/js/screen/scanlines.js','utf8');
  const grille=fs.readFileSync('assets/js/screen/grille.js','utf8');

  for(const key of ['vajnesPalette']){
    assert.match(palette,new RegExp("getItem\\('"+key+"'\\)"));
    assert.match(palette,new RegExp("setItem\\('"+key+"'"));
  }

  for(const key of ['scaleFactor','pixelAspectMode','vajnesFpsEnabled','vajnesCompositeBlur']){
    assert.match(screen,new RegExp("getItem\\('"+key+"'\\)"));
    assert.match(screen,new RegExp("setItem\\('"+key+"'"));
  }

  assert.match(scanlines,/getItem\('vajnesScanlineImage'\)/);
  assert.match(scanlines,/setItem\('vajnesScanlineImage'/);

  for(const key of [
    'vajnesTransparency','vajnesGrilleIntensity','vajnesGrilleType',
    'vajnesScanlineIntensity','vajnesScanlineLineHeight','vajnesScanlineGap','vajnesScanlineOffset'
  ]){
    assert(grille.includes(key),key+' persistence key missing');
  }

  // UI chrome must remain unaffected by CRT opacity while the emulated picture
  // restores its saved transparency.
  assert.match(grille,/systemScreen\.style\.opacity\s*=\s*'1'/);
  assert.match(grille,/canvas\.style\.opacity/);
});

test('CRT tuning restores saved values before attaching live controls',()=>{
  const grille=fs.readFileSync('assets/js/screen/grille.js','utf8');
  assert(grille.indexOf("getItem('vajnesTransparency')") < grille.indexOf("setItem('vajnesTransparency'"));
  assert(grille.indexOf("getItem('vajnesGrilleIntensity')") < grille.indexOf("setItem('vajnesGrilleIntensity'"));
  assert(grille.indexOf("getItem('vajnesGrilleType')") < grille.indexOf("setItem('vajnesGrilleType'"));
  assert(grille.includes("restore(inten,'vajnesScanlineIntensity')"));
  assert(grille.includes("restore(lH,'vajnesScanlineLineHeight')"));
  assert(grille.includes("restore(gap,'vajnesScanlineGap')"));
  assert(grille.includes("off.checked = localStorage.getItem('vajnesScanlineOffset') === '1'"));
});
