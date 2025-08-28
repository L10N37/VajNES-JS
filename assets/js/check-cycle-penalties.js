// Usage: node check-cycle-penalties.js /path/to/6502.js
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node check-cycle-penalties.js /path/to/6502.js');
  process.exit(1);
}

const src = fs.readFileSync(file, 'utf8');

// Simple function-body extractor
function extractFunction(name) {
  // matches: function NAME( ... ) { ... }
  const rx = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = rx.exec(src);
  return m ? m[1] : null;
}

// groups to check
const BRANCHES = [
  'BPL_REL','BMI_REL','BVC_REL','BVS_REL','BCC_REL','BCS_REL','BNE_REL','BEQ_REL','BRA_REL'
];

const ABSX_READS = [
  'ORA_ABSX','AND_ABSX','EOR_ABSX','ADC_ABSX','LDA_ABSX','CMP_ABSX','SBC_ABSX'//,'LAX_ABSX'
];

const ABSY_READS = [
  'ORA_ABSY','AND_ABSY','EOR_ABSY','ADC_ABSY','LDA_ABSY','CMP_ABSY','SBC_ABSY','LAX_ABSY','LAS_ABSY'
];

const INDY_READS = [
  'ORA_INDY','AND_INDY','EOR_INDY','ADC_INDY','LDA_INDY','CMP_INDY','SBC_INDY','LAX_INDY'
];

const SPECIALS = ['NOP_ABSX']; // illegal read-NOP

// heuristics
function hasAddExtra(body) {
  return body && body.includes('addExtraCycles(');
}
function hasPageCrossOnAddress(body) {
  // look for 0xFF00 in same function (coarse but works well)
  return body && body.includes('0xFF00');
}
function hasBranchPattern(body) {
  // branch usually compares old/new PC page or has a ternary 2:1, both acceptable heuristics
  if (!body) return false;
  if (body.includes('& 0xFF00') && (body.includes('old') || body.includes('PC')))
    return true;
  if (/\?\s*2\s*:\s*1/.test(body)) return true;
  return false;
}

function checkSet(title, names, checkFn) {
  const results = [];
  for (const n of names) {
    const body = extractFunction(n);
    if (!body) {
      results.push({ name: n, status: 'MISSING FUNCTION' });
      continue;
    }
    const res = checkFn(body);
    results.push({ name: n, status: res ? 'OK' : 'NEEDS PATCH' });
  }
  return { title, results };
}

const sections = [];

// Branches: must have addExtraCycles AND branch pattern (page cross on PC or +2:+1)
sections.push(checkSet('Branches (+1 if taken, +2 if page crossed)', BRANCHES, b => hasAddExtra(b) && hasBranchPattern(b)));

// ABS,X reads: must have addExtraCycles AND an address page-cross check
sections.push(checkSet('ABS,X reads (+1 on page cross)', ABSX_READS, b => hasAddExtra(b) && hasPageCrossOnAddress(b)));

// ABS,Y reads
sections.push(checkSet('ABS,Y reads (+1 on page cross)', ABSY_READS, b => hasAddExtra(b) && hasPageCrossOnAddress(b)));

// (zp),Y reads
sections.push(checkSet('(zp),Y reads (+1 on page cross)', INDY_READS, b => hasAddExtra(b) && hasPageCrossOnAddress(b)));

// NOP abs,X
sections.push(checkSet('NOP_ABSX behaves like read (+1 on page cross)', SPECIALS, b => hasAddExtra(b) && hasPageCrossOnAddress(b)));

for (const s of sections) {
  console.log('\n=== ' + s.title + ' ===');
  for (const r of s.results) {
    console.log(`${r.status.padEnd(14)} ${r.name}`);
  }
}

// Heads-up about where *not* to add dynamic penalties
console.log(`\nNotes:
- RMW (official + illegal) should be fixed in the LUT (ZP=5,ZPX=6,ABS=6,ABSX=7,INDX=8,INDY=8; ABS,Y=7 for illegals) with NO dynamic adds in handlers.
- Stores (STA_*, SAX_*, AXA_*, SHY_ABSX, SHX_ABSY, TAS_ABSY): no page-cross +1 on 6502.
- (zp,X) reads: no dynamic +1 on 6502.
`);
