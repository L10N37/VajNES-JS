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

  for(const key of ['scaleFactor','pixelAspectMode','vajnesFpsEnabled','vajnesCompositeBlur','vajnesFullscreenMode']){
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


test('application full screen offers fitted and stretched modes without binding F11',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const screen=fs.readFileSync('assets/js/screen/screen.js','utf8');
  const css=fs.readFileSync('assets/css/screen.css','utf8');

  assert.match(html,/data-fullscreen-mode="aspect"[^>]*>Maintain aspect ratio</);
  assert.match(html,/data-fullscreen-mode="stretch"[^>]*>Full screen stretched</);
  assert.match(screen,/requestFullscreen/);
  assert.match(screen,/fullscreenMode === 'aspect'/);
  assert.match(screen,/window\.innerWidth/);
  assert.match(screen,/window\.innerHeight/);
  assert.doesNotMatch(screen,/ev\.key\s*===?\s*['"]F11['"]/);
  assert.match(screen,/fullscreenShell\.clientWidth/);
  assert.match(screen,/fullscreenShell\.clientHeight/);
  assert.match(screen,/style\.setProperty\('width',width\+'px','important'\)/);
  assert.match(screen,/style\.setProperty\('height',height\+'px','important'\)/);
  assert.match(css,/border:\s*0/);
});


test('maintain-aspect fullscreen computes a fitted rectangle while stretch uses the whole surface',()=>{
  const screen=fs.readFileSync('assets/js/screen/screen.js','utf8');
  assert.match(screen,/if \(fullscreenMode === 'aspect'\)/);
  assert.match(screen,/\(viewportW \/ viewportH\) > pictureAspect/);
  assert.match(screen,/width = height \* pictureAspect/);
  assert.match(screen,/height = width \/ pictureAspect/);
  assert.match(screen,/let width = viewportW;\s*let height = viewportH;/);
});


test('fullscreen UI gives F11 exit guidance and stretched mode auto-hides toolbar after idle',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const screen=fs.readFileSync('assets/js/screen/screen.js','utf8');
  const css=fs.readFileSync('assets/css/screen.css','utf8');

  assert.match(html,/Press F11 to exit Full Screen\./);
  assert.match(screen,/ev\.key !== 'F11' \|\| !emulatorFullscreenActive\(\)/);
  assert.match(screen,/setTimeout\(\(\) => \{/);
  assert.match(screen,/\}, 5000\)/);
  assert.match(screen,/fullscreenMode === 'stretch'/);
  assert.match(screen,/addEventListener\('pointermove', armFullscreenUiIdleTimer/);
  assert.match(css,/fullscreen-ui-idle[^\{]*#system-screen-modal \.optionsBar/);
  assert.match(css,/display:\s*none !important/);
});
