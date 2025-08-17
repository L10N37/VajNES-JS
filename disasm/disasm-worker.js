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
const PC_BASE = 0x0000; //

// hex helpers: LOWERCASE as requested
function h2(v){ return (v & 0xFF).toString(16).padStart(2,'0'); }
function h4(v){ return (v & 0xFFFF).toString(16).padStart(4,'0'); }

// addressing mode enum (matches the LUT below)
const AM = {
  IMP:0, ACC:1, IMM:2, ZP:3, ZPX:4, ZPY:5, ABS:6, ABSX:7, ABSY:8,
  IND:9, INDX:10, INDY:11, REL:12
};

// -----------------------------------------------------------------------

onmessage = function (e) {
  if (!e.data || e.data.type !== "init") return;

  // RAW snapshot (single record at fixed offsets 0..16)
  RING_U8  = new Uint8Array(e.data.sab.RING);
  RING_U16 = new Uint16Array(e.data.sab.RING);

  // HTML pipe
  var HTML_SAB     = e.data.sab.HTML;
  var headerBytes  = e.data.html.headerBytes; // 8
  HTML_DATA_BYTES  = e.data.html.dataBytes;

  HTML_U32 = new Uint32Array(HTML_SAB, 0, 2);       // [commitOffset, epoch]
  HTML_U8  = new Uint8Array(HTML_SAB, headerBytes); // data region

  // reset header
  Atomics.store(HTML_U32, 0, 0);
  Atomics.store(HTML_U32, 1, 0);

  postMessage({ type: "ready" });

  // poll at ~60 Hz
  setInterval(tick, 16);
};

function tick() {
  // Fixed layout:
  // 0..1: PC16   (Uint16, CPUregisters.PC - 0x8000)
  // 2   : OPC
  // 3   : OP1
  // 4   : OP2
  // 5   : A
  // 6   : X
  // 7   : Y
  // 8   : S
  // 9..16 : flags C,Z,I,D,B,U,V,N (one byte each)

  // read snapshot
  var pcOff = RING_U16[0] | 0;
  var pc    = (pcOff + PC_BASE) & 0xFFFF;

  var opc  = RING_U8[2] | 0;

  // only work when something actually changed
  if (pcOff === lastPC && opc === lastOPC) return;

  var op1  = RING_U8[3] | 0;
  var op2  = RING_U8[4] | 0;
  var A    = RING_U8[5] | 0;
  var X    = RING_U8[6] | 0;
  var Y    = RING_U8[7] | 0;
  var S    = RING_U8[8] | 0;

  var Cf   = RING_U8[9]  & 1;
  var Zf   = RING_U8[10] & 1;
  var If   = RING_U8[11] & 1;
  var Df   = RING_U8[12] & 1;
  var Bf   = RING_U8[13] & 1;
  var Uf   = RING_U8[14] & 1;
  var Vf   = RING_U8[15] & 1;
  var Nf   = RING_U8[16] & 1;

  // build compact flag string for single 'P' column (e.g., "NVUBDIZC" using dots for clear)
  var Pstr = (Nf?'N':'•') + (Vf?'V':'•') + (Uf?'U':'•') + (Bf?'B':'•') +
             (Df?'D':'•') + (If?'I':'•') + (Zf?'Z':'•') + (Cf?'C':'•');

  // decode opcode to mnemonic + addressing text + notes
  const d = OPINFO_6502[opc] || {m:'???', am:AM.IMP, len:1, cyc:2, pb:false};
  const { mnemonic, operandText, notes } = formatDisasm(pc, opc, op1, op2, X, Y, d);

  // build and commit one row
  var html = rowHTML(pc, opc, op1, op2, mnemonic + (operandText ? ' ' + operandText : ''), notes, A, X, Y, S, Pstr);
  writeHTML(html);

  // update change detector + row counter
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
    Atomics.store(HTML_U32, 1, htmlEpoch); // bump epoch on wrap
  }
  HTML_U8.set(bytes, htmlOff);
  htmlOff += n;
  Atomics.store(HTML_U32, 0, htmlOff);     // commit
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
      // printed as absolute target in NOTES; here keep as $±off for the op field
      const s = sign8(op1);
      if (s >= 0) return '$+' + s;
      return '$' + s; // negative shows with minus
    }
    default: return '';
  }
}

function computeNotes(pc, am, op1, op2, X, Y, addsPB){
  let notes = '';

  // Branch target for REL (effective target uses PC of *this* opcode)
  if (am === AM.REL){
    const s = sign8(op1);
    const tgt = (pc + 2 + s) & 0xFFFF;
    notes = '→ $' + h4(tgt);
    return notes;
  }

  // Page boundary detection where it applies
  // (Emulation timing: ABS,X | ABS,Y | (ZP),Y can add a cycle on cross)
  if (addsPB){
    let crossed = false;
    switch(am){
      case AM.ABSX: crossed = crossesPage((op1 | (op2<<8)), X); break;
      case AM.ABSY: crossed = crossesPage((op1 | (op2<<8)), Y); break;
      case AM.INDY: crossed = crossesPage(op1, Y); break; // base: zp pointer low byte
      default: break;
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
  return {
    mnemonic: d.m,
    operandText,
    notes
  };
}

// Row renderer (now includes mnemonic & notes)
function rowHTML(pc, opc, op1, op2, mnemonicAndOp, notes, A, X, Y, S, Pstr) {
  return `<tr>
    <td>$${h4(pc)}</td>
    <td>${h2(opc)}</td>
    <td>${h2(op1)} ${h2(op2)}</td>
    <td>${mnemonicAndOp}</td>
    <td>${notes}</td>
    <td>${h2(A)}</td>
    <td>${h2(X)}</td>
    <td>${h2(Y)}</td>
    <td>${Pstr}</td>
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
