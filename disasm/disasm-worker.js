var RING_U8, RING_U16;
var HTML_U32, HTML_U8, HTML_DATA_BYTES;
var _enc = new TextEncoder();

var htmlOff = 0;
var htmlEpoch = 0;

// local change detection + simple row counter
var lastPC  = -1;
var lastOPC = -1;
var rowCount = 0;

// --- config -------------------------------------------------------------
const PC_BASE = 0x0000;

// hex helpers: LOWERCASE
function h2(v){ return (v & 0xFF).toString(16).padStart(2,'0'); }
function h4(v){ return (v & 0xFFFF).toString(16).padStart(4,'0'); }

// addressing mode enum
const AM = {
  IMP:0, ACC:1, IMM:2, ZP:3, ZPX:4, ZPY:5, ABS:6, ABSX:7, ABSY:8,
  IND:9, INDX:10, INDY:11, REL:12
};

// one-time sizer row to lock widths
let didSizer = false;

onmessage = function (e) {
  if (!e.data || e.data.type !== "init") return;

  // RAW snapshot
  RING_U8  = new Uint8Array(e.data.sab.RING);
  RING_U16 = new Uint16Array(e.data.sab.RING);

  // HTML pipe
  var HTML_SAB     = e.data.sab.HTML;
  var headerBytes  = e.data.html.headerBytes;
  HTML_DATA_BYTES  = e.data.html.dataBytes;

  HTML_U32 = new Uint32Array(HTML_SAB, 0, 2);
  HTML_U8  = new Uint8Array(HTML_SAB, headerBytes);

  // reset header
  Atomics.store(HTML_U32, 0, 0);
  Atomics.store(HTML_U32, 1, 0);

  postMessage({ type: "ready" });

  // poll at ~60 Hz
  setInterval(tick, 16);
};

function tick() {
  var pcOff = RING_U16[0] | 0;
  var pc    = (pcOff + PC_BASE) & 0xFFFF;
  var opc   = RING_U8[2] | 0;

  if (pcOff === lastPC && opc === lastOPC) return;

  var op1  = RING_U8[3] | 0;
  var op2  = RING_U8[4] | 0;
  var A    = RING_U8[5] | 0;
  var X    = RING_U8[6] | 0;
  var Y    = RING_U8[7] | 0;
  var S    = RING_U8[8] | 0;

  // 6 flags only
  var Cf   = (RING_U8[9]  & 1) ? '1':'0';
  var Zf   = (RING_U8[10] & 1) ? '1':'0';
  var If   = (RING_U8[11] & 1) ? '1':'0';
  var Df   = (RING_U8[12] & 1) ? '1':'0';
  var Vf   = (RING_U8[13] & 1) ? '1':'0';
  var Nf   = (RING_U8[14] & 1) ? '1':'0';

  const d = (typeof OPINFO_6502 !== 'undefined' && OPINFO_6502[opc]) ||
            {m:'???', am:AM.IMP, len:1, cyc:2, pb:false};
  const { mnemonic, operandText, notes } = formatDisasm(pc, opc, op1, op2, X, Y, d);

  if (!didSizer){
    writeHTML(sizerRowHTML());
    didSizer = true;
  }

  var html = rowHTML(
    pc, opc, op1, op2,
    mnemonic + (operandText ? ' ' + operandText : ''),
    notes,
    A, X, Y,
    Cf, Zf, If, Df, Vf, Nf,
    S,
    d.len
  );

  writeHTML(html);

  lastPC  = pcOff;
  lastOPC = opc;
  rowCount++;
}

function writeHTML(str) {
  var bytes = _enc.encode(str);
  var n = bytes.length;

  if (htmlOff + n > HTML_DATA_BYTES) {
    htmlOff = 0;
    htmlEpoch++;
    Atomics.store(HTML_U32, 1, htmlEpoch);
    didSizer = false;
  }
  HTML_U8.set(bytes, htmlOff);
  htmlOff += n;
  Atomics.store(HTML_U32, 0, htmlOff);
}

// ---------- disasm formatting ------------------------------------------

function sign8(v){ v &= 0xFF; return (v & 0x80) ? v - 0x100 : v; }

function crossesPage(base, add){
  return (((base & 0xFF) + (add & 0xFF)) & 0x100) !== 0;
}

function operandString(am, op1, op2, X, Y){
  const abs = (op1 | (op2<<8)) & 0xFFFF;
  switch(am){
    case AM.IMP: return '';
    case AM.ACC: return 'a';
    case AM.IMM: return '#$' + h2(op1);
    case AM.ZP:  return '$' + h2(op1);
    case AM.ZPX: return '$' + h2(op1) + ',x';
    case AM.ZPY: return '$' + h2(op1) + ',y';
    case AM.ABS: return '$' + h4(abs);
    case AM.ABSX:return '$' + h4(abs) + ',x';
    case AM.ABSY:return '$' + h4(abs) + ',y';
    case AM.IND: return '($' + h4(abs) + ')';
    case AM.INDX:return '($' + h2(op1) + ',x)';
    case AM.INDY:return '($' + h2(op1) + '),y';
    case AM.REL: {
      const s = sign8(op1);
      if (s >= 0) return '$+' + s;
      return '$' + s;
    }
    default: return '';
  }
}

function computeNotes(pc, am, op1, op2, X, Y, addsPB){
  let notes = '';
  if (am === AM.REL){
    const s = sign8(op1);
    const tgt = (pc + 2 + s) & 0xFFFF;
    notes = '→ $' + h4(tgt);
    return notes;
  }
  if (addsPB){
    let crossed = false;
    switch(am){
      case AM.ABSX: crossed = crossesPage((op1 | (op2<<8)), X); break;
      case AM.ABSY: crossed = crossesPage((op1 | (op2<<8)), Y); break;
      case AM.INDY: crossed = crossesPage(op1, Y); break;
    }
    if (crossed) notes = '+pb';
  }
  return notes;
}

function formatDisasm(pc, opc, op1, op2, X, Y, d){
  const am = d.am|0;
  const operandText = operandString(am, op1, op2, X, Y);
  const pbApplies = !!d.pb;
  const notes = computeNotes(pc, am, op1, op2, X, Y, pbApplies);
  return { mnemonic: d.m, operandText, notes };
}

// ---------- row renderers ----------------------------------------------

function sizerRowHTML(){
  const PC   = '$ffff';
  const OPC  = 'ff';
  const OP   = 'ff ff';
  const MNE  = 'jmp ($ffff),y';
  const NOTE = '→ $ffff +pb';
  const AXYS = 'ff';
  const BIT  = '1';
  const S    = 'ff';

  return `<tr class="sizer" aria-hidden="true" style="visibility:hidden;height:0">
    <td>${PC}</td>
    <td>${OPC}</td>
    <td>${OP}</td>
    <td>${MNE}</td>
    <td style="max-width:12ch;white-space:nowrap;overflow:hidden;text-overflow:clip;">${NOTE}</td>
    <td>${AXYS}</td>
    <td>${AXYS}</td>
    <td>${AXYS}</td>
    <td>${BIT}</td><td>${BIT}</td><td>${BIT}</td><td>${BIT}</td><td>${BIT}</td><td>${BIT}</td>
    <td>${S}</td>
  </tr>`;
}

function rowHTML(
  pc, opc, op1, op2,
  mnemonicAndOp,
  notes,
  A, X, Y,
  Cb, Zb, Ib, Db, Vb, Nb,
  S,
  len
) {
  // format operand bytes based on instruction length
  let ops = '';
  if (len === 2) {
    ops = h2(op1);
  } else if (len === 3) {
    ops = h2(op1) + ' ' + h2(op2);
  }

  return `<tr>
    <td>$${h4(pc)}</td>
    <td>${h2(opc)}</td>
    <td>${ops}</td>
    <td>${mnemonicAndOp}</td>
    <td style="max-width:12ch;white-space:nowrap;overflow:hidden;text-overflow:clip;">${notes}</td>
    <td>${h2(A)}</td>
    <td>${h2(X)}</td>
    <td>${h2(Y)}</td>
    <td>${Cb}</td>
    <td>${Zb}</td>
    <td>${Ib}</td>
    <td>${Db}</td>
    <td>${Vb}</td>
    <td>${Nb}</td>
    <td>${h2(S)}</td>
  </tr>`;
}

// LUTS

const _ = (m,am,len,cyc,pb)=>({m,am,len,cyc,pb});

// Official 6502 opcodes table (256). Unofficial opcodes set to ??? (len=1,cyc=2).
// pb=true where ABS,X / ABS,Y / (ZP),Y can add +1 on page cross.
const OPINFO_6502 = new Array(256).fill(null).map(()=>_('???', AM.IMP, 1, 2, false));

// --- helper to set entries quickly
function S(op, m, am, len, cyc, pb=false){ OPINFO_6502[op]=_(m,am,len,cyc,pb); }

// ADC
S(0x69,'adc',AM.IMM,2,2);
S(0x65,'adc',AM.ZP, 2,3);
S(0x75,'adc',AM.ZPX,2,4);
S(0x6D,'adc',AM.ABS,3,4);
S(0x7D,'adc',AM.ABSX,3,4,true);
S(0x79,'adc',AM.ABSY,3,4,true);
S(0x61,'adc',AM.INDX,2,6);
S(0x71,'adc',AM.INDY,2,5,true);

// AND
S(0x29,'and',AM.IMM,2,2);
S(0x25,'and',AM.ZP, 2,3);
S(0x35,'and',AM.ZPX,2,4);
S(0x2D,'and',AM.ABS,3,4);
S(0x3D,'and',AM.ABSX,3,4,true);
S(0x39,'and',AM.ABSY,3,4,true);
S(0x21,'and',AM.INDX,2,6);
S(0x31,'and',AM.INDY,2,5,true);

// ASL
S(0x0A,'asl',AM.ACC,1,2);
S(0x06,'asl',AM.ZP, 2,5);
S(0x16,'asl',AM.ZPX,2,6);
S(0x0E,'asl',AM.ABS,3,6);
S(0x1E,'asl',AM.ABSX,3,7);

// BCC/BCS/BEQ/BMI/BNE/BPL/BVC/BVS (REL)
S(0x90,'bcc',AM.REL,2,2);
S(0xB0,'bcs',AM.REL,2,2);
S(0xF0,'beq',AM.REL,2,2);
S(0x30,'bmi',AM.REL,2,2);
S(0xD0,'bne',AM.REL,2,2);
S(0x10,'bpl',AM.REL,2,2);
S(0x50,'bvc',AM.REL,2,2);
S(0x70,'bvs',AM.REL,2,2);

// BIT
S(0x24,'bit',AM.ZP, 2,3);
S(0x2C,'bit',AM.ABS,3,4);

// BRK
S(0x00,'brk',AM.IMP,1,7);

// CMP
S(0xC9,'cmp',AM.IMM,2,2);
S(0xC5,'cmp',AM.ZP, 2,3);
S(0xD5,'cmp',AM.ZPX,2,4);
S(0xCD,'cmp',AM.ABS,3,4);
S(0xDD,'cmp',AM.ABSX,3,4,true);
S(0xD9,'cmp',AM.ABSY,3,4,true);
S(0xC1,'cmp',AM.INDX,2,6);
S(0xD1,'cmp',AM.INDY,2,5,true);

// CPX
S(0xE0,'cpx',AM.IMM,2,2);
S(0xE4,'cpx',AM.ZP, 2,3);
S(0xEC,'cpx',AM.ABS,3,4);

// CPY
S(0xC0,'cpy',AM.IMM,2,2);
S(0xC4,'cpy',AM.ZP, 2,3);
S(0xCC,'cpy',AM.ABS,3,4);

// DEC
S(0xC6,'dec',AM.ZP, 2,5);
S(0xD6,'dec',AM.ZPX,2,6);
S(0xCE,'dec',AM.ABS,3,6);
S(0xDE,'dec',AM.ABSX,3,7);

// DEX/DEY
S(0xCA,'dex',AM.IMP,1,2);
S(0x88,'dey',AM.IMP,1,2);

// EOR
S(0x49,'eor',AM.IMM,2,2);
S(0x45,'eor',AM.ZP, 2,3);
S(0x55,'eor',AM.ZPX,2,4);
S(0x4D,'eor',AM.ABS,3,4);
S(0x5D,'eor',AM.ABSX,3,4,true);
S(0x59,'eor',AM.ABSY,3,4,true);
S(0x41,'eor',AM.INDX,2,6);
S(0x51,'eor',AM.INDY,2,5,true);

// INC
S(0xE6,'inc',AM.ZP, 2,5);
S(0xF6,'inc',AM.ZPX,2,6);
S(0xEE,'inc',AM.ABS,3,6);
S(0xFE,'inc',AM.ABSX,3,7);

// INX/INY
S(0xE8,'inx',AM.IMP,1,2);
S(0xC8,'iny',AM.IMP,1,2);

// JMP/JSR
S(0x4C,'jmp',AM.ABS,3,3);
S(0x6C,'jmp',AM.IND,3,5);
S(0x20,'jsr',AM.ABS,3,6);

// LDA
S(0xA9,'lda',AM.IMM,2,2);
S(0xA5,'lda',AM.ZP, 2,3);
S(0xB5,'lda',AM.ZPX,2,4);
S(0xAD,'lda',AM.ABS,3,4);
S(0xBD,'lda',AM.ABSX,3,4,true);
S(0xB9,'lda',AM.ABSY,3,4,true);
S(0xA1,'lda',AM.INDX,2,6);
S(0xB1,'lda',AM.INDY,2,5,true);

// LDX
S(0xA2,'ldx',AM.IMM,2,2);
S(0xA6,'ldx',AM.ZP, 2,3);
S(0xB6,'ldx',AM.ZPY,2,4);
S(0xAE,'ldx',AM.ABS,3,4);
S(0xBE,'ldx',AM.ABSY,3,4,true);

// LDY
S(0xA0,'ldy',AM.IMM,2,2);
S(0xA4,'ldy',AM.ZP, 2,3);
S(0xB4,'ldy',AM.ZPX,2,4);
S(0xAC,'ldy',AM.ABS,3,4);
S(0xBC,'ldy',AM.ABSX,3,4,true);

// LSR
S(0x4A,'lsr',AM.ACC,1,2);
S(0x46,'lsr',AM.ZP, 2,5);
S(0x56,'lsr',AM.ZPX,2,6);
S(0x4E,'lsr',AM.ABS,3,6);
S(0x5E,'lsr',AM.ABSX,3,7);

// NOP
S(0xEA,'nop',AM.IMP,1,2);

// ORA
S(0x09,'ora',AM.IMM,2,2);
S(0x05,'ora',AM.ZP, 2,3);
S(0x15,'ora',AM.ZPX,2,4);
S(0x0D,'ora',AM.ABS,3,4);
S(0x1D,'ora',AM.ABSX,3,4,true);
S(0x19,'ora',AM.ABSY,3,4,true);
S(0x01,'ora',AM.INDX,2,6);
S(0x11,'ora',AM.INDY,2,5,true);

// ROL
S(0x2A,'rol',AM.ACC,1,2);
S(0x26,'rol',AM.ZP, 2,5);
S(0x36,'rol',AM.ZPX,2,6);
S(0x2E,'rol',AM.ABS,3,6);
S(0x3E,'rol',AM.ABSX,3,7);

// ROR
S(0x6A,'ror',AM.ACC,1,2);
S(0x66,'ror',AM.ZP, 2,5);
S(0x76,'ror',AM.ZPX,2,6);
S(0x6E,'ror',AM.ABS,3,6);
S(0x7E,'ror',AM.ABSX,3,7);

// RTI/RTS
S(0x40,'rti',AM.IMP,1,6);
S(0x60,'rts',AM.IMP,1,6);

// SBC
S(0xE9,'sbc',AM.IMM,2,2);
S(0xE5,'sbc',AM.ZP, 2,3);
S(0xF5,'sbc',AM.ZPX,2,4);
S(0xED,'sbc',AM.ABS,3,4);
S(0xFD,'sbc',AM.ABSX,3,4,true);
S(0xF9,'sbc',AM.ABSY,3,4,true);
S(0xE1,'sbc',AM.INDX,2,6);
S(0xF1,'sbc',AM.INDY,2,5,true);

// STA (stores: no pb cycle)
S(0x85,'sta',AM.ZP, 2,3);
S(0x95,'sta',AM.ZPX,2,4);
S(0x8D,'sta',AM.ABS,3,4);
S(0x9D,'sta',AM.ABSX,3,5);
S(0x99,'sta',AM.ABSY,3,5);
S(0x81,'sta',AM.INDX,2,6);
S(0x91,'sta',AM.INDY,2,6);

// STX
S(0x86,'stx',AM.ZP, 2,3);
S(0x96,'stx',AM.ZPY,2,4);
S(0x8E,'stx',AM.ABS,3,4);

// STY
S(0x84,'sty',AM.ZP, 2,3);
S(0x94,'sty',AM.ZPX,2,4);
S(0x8C,'sty',AM.ABS,3,4);

// TAX/TAY/TSX/TXA/TXS/TYA
S(0xAA,'tax',AM.IMP,1,2);
S(0xA8,'tay',AM.IMP,1,2);
S(0xBA,'tsx',AM.IMP,1,2);
S(0x8A,'txa',AM.IMP,1,2);
S(0x9A,'txs',AM.IMP,1,2);
S(0x98,'tya',AM.IMP,1,2);

// CLC/CLD/CLI/CLV/SEC/SED/SEI
S(0x18,'clc',AM.IMP,1,2);
S(0xD8,'cld',AM.IMP,1,2);
S(0x58,'cli',AM.IMP,1,2);
S(0xB8,'clv',AM.IMP,1,2);
S(0x38,'sec',AM.IMP,1,2);
S(0xF8,'sed',AM.IMP,1,2);
S(0x78,'sei',AM.IMP,1,2);

// Stack operations
S(0x48,'pha',AM.IMP,1,3);  // Push Accumulator
S(0x68,'pla',AM.IMP,1,4);  // Pull Accumulator
S(0x08,'php',AM.IMP,1,3);  // Push Processor Status
S(0x28,'plp',AM.IMP,1,4);  // Pull Processor Status

// === Unofficial opcodes ===
// Reference: https://www.nesdev.org/wiki/CPU_unofficial_opcodes

// Helper alias (for readability)
const U = (op, m, am, len, cyc, pb=false)=>S(op,m,am,len,cyc,pb);

// --- NOP variants (multi-byte "skip" NOPs) ---
U(0x1A,'nop',AM.IMP,1,2);
U(0x3A,'nop',AM.IMP,1,2);
U(0x5A,'nop',AM.IMP,1,2);
U(0x7A,'nop',AM.IMP,1,2);
U(0xDA,'nop',AM.IMP,1,2);
U(0xFA,'nop',AM.IMP,1,2);

// NOP with operands (but ignore them)
U(0x80,'nop',AM.IMM,2,2);
U(0x82,'nop',AM.IMM,2,2);
U(0x89,'nop',AM.IMM,2,2);
U(0xC2,'nop',AM.IMM,2,2);
U(0xE2,'nop',AM.IMM,2,2);
U(0x04,'nop',AM.ZP, 2,3);
U(0x44,'nop',AM.ZP, 2,3);
U(0x64,'nop',AM.ZP, 2,3);
U(0x14,'nop',AM.ZPX,2,4);
U(0x34,'nop',AM.ZPX,2,4);
U(0x54,'nop',AM.ZPX,2,4);
U(0x74,'nop',AM.ZPX,2,4);
U(0xD4,'nop',AM.ZPX,2,4);
U(0xF4,'nop',AM.ZPX,2,4);
U(0x0C,'nop',AM.ABS,3,4);
U(0x1C,'nop',AM.ABSX,3,4,true);
U(0x3C,'nop',AM.ABSX,3,4,true);
U(0x5C,'nop',AM.ABSX,3,4,true);
U(0x7C,'nop',AM.ABSX,3,4,true);
U(0xDC,'nop',AM.ABSX,3,4,true);
U(0xFC,'nop',AM.ABSX,3,4,true);

// --- LAX (LDA+LDX) ---
U(0xA7,'lax',AM.ZP, 2,3);
U(0xB7,'lax',AM.ZPY,2,4);
U(0xAF,'lax',AM.ABS,3,4);
U(0xBF,'lax',AM.ABSY,3,4,true);
U(0xA3,'lax',AM.INDX,2,6);
U(0xB3,'lax',AM.INDY,2,5,true);

// --- SAX (STA & STX & (A&X)) ---
U(0x87,'sax',AM.ZP, 2,3);
U(0x97,'sax',AM.ZPY,2,4);
U(0x8F,'sax',AM.ABS,3,4);
U(0x83,'sax',AM.INDX,2,6);

// --- DCP (DEC + CMP) ---
U(0xC7,'dcp',AM.ZP, 2,5);
U(0xD7,'dcp',AM.ZPX,2,6);
U(0xCF,'dcp',AM.ABS,3,6);
U(0xDF,'dcp',AM.ABSX,3,7);
U(0xDB,'dcp',AM.ABSY,3,7);
U(0xC3,'dcp',AM.INDX,2,8);
U(0xD3,'dcp',AM.INDY,2,8);

// --- ISC/ISB (INC + SBC) ---
U(0xE7,'isc',AM.ZP, 2,5);
U(0xF7,'isc',AM.ZPX,2,6);
U(0xEF,'isc',AM.ABS,3,6);
U(0xFF,'isc',AM.ABSX,3,7);
U(0xFB,'isc',AM.ABSY,3,7);
U(0xE3,'isc',AM.INDX,2,8);
U(0xF3,'isc',AM.INDY,2,8);

// --- SLO (ASL + ORA) ---
U(0x07,'slo',AM.ZP, 2,5);
U(0x17,'slo',AM.ZPX,2,6);
U(0x0F,'slo',AM.ABS,3,6);
U(0x1F,'slo',AM.ABSX,3,7);
U(0x1B,'slo',AM.ABSY,3,7);
U(0x03,'slo',AM.INDX,2,8);
U(0x13,'slo',AM.INDY,2,8);

// --- RLA (ROL + AND) ---
U(0x27,'rla',AM.ZP, 2,5);
U(0x37,'rla',AM.ZPX,2,6);
U(0x2F,'rla',AM.ABS,3,6);
U(0x3F,'rla',AM.ABSX,3,7);
U(0x3B,'rla',AM.ABSY,3,7);
U(0x23,'rla',AM.INDX,2,8);
U(0x33,'rla',AM.INDY,2,8);

// --- RRA (ROR + ADC) ---
U(0x67,'rra',AM.ZP, 2,5);
U(0x77,'rra',AM.ZPX,2,6);
U(0x6F,'rra',AM.ABS,3,6);
U(0x7F,'rra',AM.ABSX,3,7);
U(0x7B,'rra',AM.ABSY,3,7);
U(0x63,'rra',AM.INDX,2,8);
U(0x73,'rra',AM.INDY,2,8);

// --- SRE (LSR + EOR) ---
U(0x47,'sre',AM.ZP, 2,5);
U(0x57,'sre',AM.ZPX,2,6);
U(0x4F,'sre',AM.ABS,3,6);
U(0x5F,'sre',AM.ABSX,3,7);
U(0x5B,'sre',AM.ABSY,3,7);
U(0x43,'sre',AM.INDX,2,8);
U(0x53,'sre',AM.INDY,2,8);

// --- ANC (AND + set carry from bit7 of A) ---
U(0x0B,'anc',AM.IMM,2,2);
U(0x2B,'anc',AM.IMM,2,2);

// --- ALR (AND + LSR) ---
U(0x4B,'alr',AM.IMM,2,2);

// --- ARR (AND + ROR + special flags) ---
U(0x6B,'arr',AM.IMM,2,2);

// --- XAA (unstable, TXA + AND imm) ---
U(0x8B,'xaa',AM.IMM,2,2);

// --- LAS (LDA+TSX, limited) ---
U(0xBB,'las',AM.ABSY,3,4,true);

// --- AXS (SAX with subtraction) ---
U(0xCB,'axs',AM.IMM,2,2);

// --- SHY/SHX/TAS (unstable store hacks) ---
U(0x9C,'shy',AM.ABSX,3,5);
U(0x9E,'shx',AM.ABSY,3,5);
U(0x9B,'tas',AM.ABSY,3,5);

// --- Remaining unofficial 6502 opcodes ---

// SHA (also called AHX, unstable: stores A & X & (addr>>8)+1)
U(0x93,'sha',AM.INDY,2,6);
U(0x9F,'sha',AM.ABSY,3,5);

// SHS (a.k.a. TAS, sometimes duplicates SHA)
U(0x9B,'shs',AM.ABSY,3,5);

// ANE (a.k.a. XAA variant, unstable TXA+AND)
U(0x8B,'ane',AM.IMM,2,2);

// LXA (LAX variant, unstable)
U(0xAB,'lxa',AM.IMM,2,2);

