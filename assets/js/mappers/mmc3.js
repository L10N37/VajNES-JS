/*

 _____ ______   _____ ______   ________ ________
|\   _ \  _   \|\   _ \  _   \|\   ____\\_____  \
\ \  \\\__\ \  \ \  \\\__\ \  \ \  \___\|____|\ /_
 \ \  \\|__| \  \ \  \\|__| \  \ \  \        \|\  \
  \ \  \    \ \  \ \  \    \ \  \ \  \____  __\_\  \
   \ \__\    \ \__\ \__\    \ \__\ \_______\\_______\ - mapper 4 (MMC3)
    \|__|     \|__|\|__|     \|__|\|_______\|_______|


*/

// because I decided not to copy banks into the 'viewable' window and pull it directly from the source
// this kinda renders the GUI useless for this mapper at this stage

// -----------------------------------------------------
// MMC3 internal state
// -----------------------------------------------------

let MMC3 = {

    control: {
        prgMode: "PRG_SWAP_8000",     // PRG banking mode
        chrMode: "CHR_NORMAL",        // CHR inversion mode
        selectedRegister: null,       // register selected by $8000 write
        prgRamEnabled: true,          // Deterministic power-on choice; $A001 overrides
        prgRamWriteProtect: false     // PRG-RAM write protect flag from $A001
    },

    registers: {

        CHR_BANK_0: 0,
        CHR_BANK_1: 2,
        CHR_BANK_2: 4,
        CHR_BANK_3: 5,
        CHR_BANK_4: 6,
        CHR_BANK_5: 7,

        PRG_BANK_0: 0,
        PRG_BANK_1: 1
    }

};

// Mapper 4/118/119 share the MMC3 ASIC. TxSROM (118) reroutes CIRAM A10
// through CHR A17; TQROM (119) adds a dedicated 8 KiB CHR RAM selected by
// CHR bank bit 6.
const tqromChrRam = new Uint8Array(0x2000);
function mmc3FamilyActive() {
  return mapperNumber===4 || mapperNumber===118 || mapperNumber===119;
}
function mmc3FamilyInit(nesHeader) {
  chrIsRAM = mapperNumber===4 && nesHeader[5]===0;
  if(mapperNumber===119)tqromChrRam.fill(0);
  mmc3ConfigureFromHeader(nesHeader);
}


// -----------------------------------------------------
// MMC3 $A000 write
// Nametable mirroring control
//
// Bit 0
// 0 = vertical
// 1 = horizontal
//
// Ignored if cartridge uses four-screen mirroring
// -----------------------------------------------------

function mapper4_write_A000(value)
{
    if(mapperNumber===118)return;
    const mirrorBit = value & 1;

    // Do not override four-screen boards
    if (MIRRORING !== "four")
    {
        MIRRORING = mirrorBit ? "horizontal" : "vertical";
    }

}


// -----------------------------------------------------
// MMC3 $A001 write
// PRG-RAM enable / write protection
//
// Bit 7 = PRG-RAM enable
// Bit 6 = write protect
// -----------------------------------------------------

function mapper4_write_A001(value)
{
    const ramEnable = (value >> 7) & 1;
    const writeProtect = (value >> 6) & 1;

    // these -can- be used to gate off SRAM writes in offsetsHandler
    MMC3.control.prgRamEnabled = !!ramEnable;
    MMC3.control.prgRamWriteProtect = !!writeProtect;

}


// -----------------------------------------------------
// MMC3 $8000 write
// Bank select register
//
// Bit layout
//
// 7  CHR A12 inversion
// 6  PRG banking mode
// 5-3 unused
// 2-0 register select
// -----------------------------------------------------

function mapper4_write_8000(value)
{
    const registerSelect = value & 0x07;
    const prgModeBit = (value >> 6) & 1;
    const chrModeBit = (value >> 7) & 1;

    // Decode PRG banking mode
    MMC3.control.prgMode = prgModeBit ? "PRG_SWAP_C000" : "PRG_SWAP_8000";

    // Decode CHR inversion mode
    MMC3.control.chrMode = chrModeBit ? "CHR_INVERTED" : "CHR_NORMAL";

    // Select register that $8001 will modify
    switch (registerSelect)
    {
        case 0: MMC3.control.selectedRegister = "CHR_BANK_0"; break;
        case 1: MMC3.control.selectedRegister = "CHR_BANK_1"; break;
        case 2: MMC3.control.selectedRegister = "CHR_BANK_2"; break;
        case 3: MMC3.control.selectedRegister = "CHR_BANK_3"; break;
        case 4: MMC3.control.selectedRegister = "CHR_BANK_4"; break;
        case 5: MMC3.control.selectedRegister = "CHR_BANK_5"; break;

        case 6: MMC3.control.selectedRegister = "PRG_BANK_0"; break;
        case 7: MMC3.control.selectedRegister = "PRG_BANK_1"; break;
    }

}


// -----------------------------------------------------
// MMC3 $8001 write
// Bank data register
// -----------------------------------------------------

function mapper4_write_8001(value)
{
    const target = MMC3.control.selectedRegister;
    if (!target) return;

    if (target === "CHR_BANK_0" || target === "CHR_BANK_1")
        value &= 0xFE;

    if (target === "PRG_BANK_0" || target === "PRG_BANK_1")
        MMC3.registers[target] = value & 0x3F;
    else
        MMC3.registers[target] = value;

}

// -----------------------------------------------------
// MMC3 PRG read handler
//
// Handles CPU reads $8000-$FFFF
// Returns data directly from FULL_PRG_ROM
// -----------------------------------------------------

function mapper4_prg_read(address)
{
    const bankSize  = 8 * 1024; // 8KB
    const bankCount = FULL_PRG_ROM_SIZE / bankSize;

    const lastBank   = bankCount - 1;
    const secondLast = bankCount - 2;

    const bank0 = MMC3.registers.PRG_BANK_0 & (bankCount - 1);
    const bank1 = MMC3.registers.PRG_BANK_1 & (bankCount - 1);

    let bank;
    let offset;

    if (address < 0xA000)
    {
        bank = (MMC3.control.prgMode === "PRG_SWAP_8000")
            ? bank0
            : secondLast;

        offset = address - 0x8000;
    }
    else if (address < 0xC000)
    {
        bank = bank1;
        offset = address - 0xA000;
    }
    else if (address < 0xE000)
    {
        bank = (MMC3.control.prgMode === "PRG_SWAP_8000")
            ? secondLast
            : bank0;

        offset = address - 0xC000;
    }
    else
    {
        bank = lastBank;
        offset = address - 0xE000;
    }

    const romIndex = (bank * bankSize) + offset;

    if (romIndex < 0 || romIndex >= FULL_PRG_ROM.length)
    {
        globalThis.NES_DEBUG_LOGGING && console.error(
            `[MMC3][PRG-READ OOB] cpu=$${address.toString(16).padStart(4, '0')} ` +
            `bank=${bank} offset=$${offset.toString(16).padStart(4, '0')} ` +
            `romIndex=$${romIndex.toString(16)} length=$${FULL_PRG_ROM.length.toString(16)}`
        );
        return 0xFF;
    }

    return FULL_PRG_ROM[romIndex] & 0xFF;
}

// -----------------------------------------------------
// MMC3 CHR read handler
//
// Handles PPU reads $0000-$1FFF
// Returns data directly from FULL_CHR_ROM
// -----------------------------------------------------

function mmc3ChrBankForAddress(address) {
  address &= 0x1FFF;
  const r=MMC3.registers;

  if(MMC3.control.chrMode==="CHR_NORMAL") {
    if(address<0x0800)return (r.CHR_BANK_0&0xFE)+((address>>>10)&1);
    if(address<0x1000)return (r.CHR_BANK_1&0xFE)+(((address-0x0800)>>>10)&1);
    if(address<0x1400)return r.CHR_BANK_2&0xFF;
    if(address<0x1800)return r.CHR_BANK_3&0xFF;
    if(address<0x1C00)return r.CHR_BANK_4&0xFF;
    return r.CHR_BANK_5&0xFF;
  }

  if(address<0x0400)return r.CHR_BANK_2&0xFF;
  if(address<0x0800)return r.CHR_BANK_3&0xFF;
  if(address<0x0C00)return r.CHR_BANK_4&0xFF;
  if(address<0x1000)return r.CHR_BANK_5&0xFF;
  if(address<0x1800)return (r.CHR_BANK_0&0xFE)+(((address-0x1000)>>>10)&1);
  return (r.CHR_BANK_1&0xFE)+(((address-0x1800)>>>10)&1);
}

// TxSROM feeds MMC3 CHR A17 directly to CIRAM A10. The MMC3 CHR banking
// circuit ignores PPU A13, so nametable $2000-$2FFF behaves like $0000-$0FFF
// for choosing the CHR register whose bit 7 selects CIRAM page 0/1.
function mapper118NametableAddress(addr) {
  const bank=mmc3ChrBankForAddress(addr&0x0FFF);
  return (addr&0x03FF)|((bank&0x80)?0x0400:0);
}

function mapper4_chr_read(address)
{
  address &= 0x1FFF;
  const bank=mmc3ChrBankForAddress(address);
  const offset=address&0x03FF;

  if(mapperNumber===119 && (bank&0x40))
    return tqromChrRam[((bank&7)<<10)|offset]&0xFF;

  const chrBankCount=Math.max(1,FULL_CHR_ROM_SIZE>>>10);
  // TQROM CHR A16 (bank bit 6) is chip select rather than a ROM address bit.
  // Bit 7 may still address a second 64 KiB ROM half on compatible boards.
  const romBank=mapperNumber===119?(bank&0xBF):bank;
  const normalized=((romBank%chrBankCount)+chrBankCount)%chrBankCount;
  return FULL_CHR_ROM[(normalized<<10)|offset]&0xFF;
}

function mapper4_chr_write(address, value)
{
  address &= 0x1FFF;
  value &= 0xFF;
  const bank=mmc3ChrBankForAddress(address);
  const offset=address&0x03FF;

  if(mapperNumber===119) {
    if(bank&0x40)tqromChrRam[((bank&7)<<10)|offset]=value;
    return;
  }

  if(!chrIsRAM)return;
  const chrBankCount=Math.max(1,FULL_CHR_ROM_SIZE>>>10);
  const normalized=((bank%chrBankCount)+chrBankCount)%chrBankCount;
  FULL_CHR_ROM[(normalized<<10)|offset]=value;
}

// ============================ //
//   A12 EDGE DETECTOR          //
// ============================ //
// Sharp MMC3B/C behaviour. The IRQ output is a latch, separate from enable.
const mmc3_irq = {scanlineCounter:0,latch:0,reload:false,enabled:false,
  prevA12:0,lowSince:0,variant:"sharp"};

function mmc3SetIrqVariant(variant) {
  mmc3_irq.variant = variant === "nec" ? "nec" : "sharp";
}

function mmc3ConfigureFromHeader(header) {
  const nes2 = ((header[7] >> 2) & 3) === 2;
  const submapper = nes2 ? (header[8] >>> 4) : 0;
  // NES 2.0 mapper 4 submapper 4 is the NEC/old IRQ behaviour.
  // Submapper 0 and MMC6-style configurations use Sharp zero-reload IRQs.
  mmc3SetIrqVariant(nes2 && submapper === 4 ? "nec" : "sharp");
}
function mmc3Reset() {
  Object.assign(MMC3.control,{prgMode:"PRG_SWAP_8000",chrMode:"CHR_NORMAL",
    selectedRegister:"CHR_BANK_0",prgRamEnabled:true,prgRamWriteProtect:false});
  Object.assign(MMC3.registers,{CHR_BANK_0:0,CHR_BANK_1:2,CHR_BANK_2:4,
    CHR_BANK_3:5,CHR_BANK_4:6,CHR_BANK_5:7,PRG_BANK_0:0,PRG_BANK_1:1});
  Object.assign(mmc3_irq,{scanlineCounter:0,latch:0,reload:false,enabled:false,
    prevA12:0,lowSince:ppuCycles});
  irqAssert.mmc3=false;
}
function mmc3Irq(addr) {
  if(!mmc3FamilyActive())return;
  const high=(addr>>>12)&1;
  if(!high && mmc3_irq.prevA12)mmc3_irq.lowSince=ppuCycles;
  // Approximate three M2 periods with nine PPU dots; short nametable
  // pulses are rejected. Sub-cycle M2 phase differences remain unmodelled.
  if(high && !mmc3_irq.prevA12 &&
      ppuCycles-mmc3_irq.lowSince>=9) {
    const wasZero = mmc3_irq.scanlineCounter === 0;
    const forcedReload = mmc3_irq.reload;

    if(wasZero || forcedReload)
      mmc3_irq.scanlineCounter=mmc3_irq.latch;
    else
      --mmc3_irq.scanlineCounter;

    mmc3_irq.reload=false;

    if(mmc3_irq.scanlineCounter===0 && mmc3_irq.enabled) {
      // Sharp MMC3B/C: zero reload asserts every qualified A12 edge.
      // NEC/old MMC3: automatic reload after a naturally reached zero does
      // not reassert; a decrement-to-zero or explicit $C001 reload does.
      if(mmc3_irq.variant==="sharp" || forcedReload || !wasZero)
        irqAssert.mmc3=true;
    }
  }
  mmc3_irq.prevA12=high;
}
function mapper4_write_C000(value){mmc3_irq.latch=value&255;}
function mapper4_write_C001(){mmc3_irq.reload=true;}
function mapper4_write_E000(){mmc3_irq.enabled=false;irqAssert.mmc3=false;}
function mapper4_write_E001(){mmc3_irq.enabled=true;}

// debug, not tied in with an on click / button, just use console
function openMMC3DebugModal()
{
    let modal = document.getElementById("mmc3DynamicDebugModal");
    let timer = window.__mmc3DynamicDebugTimer || null;

    if (!modal)
    {
        modal = document.createElement("div");
        modal.id = "mmc3DynamicDebugModal";

        Object.assign(modal.style,{
            position:"fixed",
            inset:"0",
            background:"rgba(0,0,0,0.75)",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            zIndex:"100000"
        });

        const panel = document.createElement("div");

        Object.assign(panel.style,{
            background:"#111",
            color:"#0f0",
            border:"2px solid #444",
            padding:"16px",
            width:"min(900px,95vw)",
            maxHeight:"90vh",
            font:"14px monospace",
            boxSizing:"border-box"
        });

        const header = document.createElement("div");

        Object.assign(header.style,{
            display:"flex",
            justifyContent:"space-between",
            alignItems:"center",
            marginBottom:"12px"
        });

        const title = document.createElement("div");
        title.textContent = "MMC3 DEBUGGER";

        const buttonRow = document.createElement("div");

        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy";

        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";

        const ta = document.createElement("textarea");
        ta.id = "mmc3DynamicDebugText";
        ta.readOnly = true;

        Object.assign(ta.style,{
            width:"100%",
            height:"60vh",
            resize:"none",
            background:"#000",
            color:"#0f0",
            border:"1px solid #333",
            padding:"12px",
            font:"14px monospace",
            whiteSpace:"pre",
            overflow:"auto",
            boxSizing:"border-box"
        });

        copyBtn.onclick = async () => {
            ta.select();
            try{
                await navigator.clipboard.writeText(ta.value);
            }catch{
                document.execCommand("copy");
            }
        };

        function closeModal()
        {
            if(window.__mmc3DynamicDebugTimer)
            {
                clearInterval(window.__mmc3DynamicDebugTimer);
                window.__mmc3DynamicDebugTimer = null;
            }

            modal.remove();
            document.removeEventListener("keydown",escHandler);
        }

        function escHandler(e)
        {
            if(e.key === "Escape")
                closeModal();
        }

        closeBtn.onclick = closeModal;

        modal.onclick = (e)=>{
            if(e.target === modal)
                closeModal();
        };

        document.addEventListener("keydown",escHandler);

        buttonRow.appendChild(copyBtn);
        buttonRow.appendChild(closeBtn);

        header.appendChild(title);
        header.appendChild(buttonRow);

        panel.appendChild(header);
        panel.appendChild(ta);

        modal.appendChild(panel);
        document.body.appendChild(modal);
    }

    const ta = document.getElementById("mmc3DynamicDebugText");

    function safeHex(v,width=2)
    {
        if(typeof v!=="number") return "unset";
        return "$"+v.toString(16).toUpperCase().padStart(width,"0");
    }

    function render()
    {
        let out="";

        if(!mmc3FamilyActive())
        {
            ta.value="MMC3 DEBUGGER\n\nGame is not an MMC3-family mapper (4/118/119).";
            return;
        }

        const c=MMC3.control;
        const r=MMC3.registers;

        let map=new Array(8);

        if(c.chrMode==="CHR_NORMAL")
        {
            map=[

                r.CHR_BANK_0,
                r.CHR_BANK_0+1,
                r.CHR_BANK_1,
                r.CHR_BANK_1+1,
                r.CHR_BANK_2,
                r.CHR_BANK_3,
                r.CHR_BANK_4,
                r.CHR_BANK_5
            ];
        }
        else
        {
            map=[

                r.CHR_BANK_2,
                r.CHR_BANK_3,
                r.CHR_BANK_4,
                r.CHR_BANK_5,
                r.CHR_BANK_0,
                r.CHR_BANK_0+1,
                r.CHR_BANK_1,
                r.CHR_BANK_1+1
            ];
        }

        const addr=[
        "$0000-$03FF",
        "$0400-$07FF",
        "$0800-$0BFF",
        "$0C00-$0FFF",
        "$1000-$13FF",
        "$1400-$17FF",
        "$1800-$1BFF",
        "$1C00-$1FFF"
        ];

        out+="MMC3 DEBUGGER\n";
        out+="======================================\n";
        out+=`CHR MODE : ${c.chrMode}\n`;
        out+=`PRG MODE : ${c.prgMode}\n`;
        out+=`SELECTED : ${c.selectedRegister}\n\n`;

        out+="RAW REGISTERS\n";
        out+="-----------------------------\n";
        out+=`R0 : ${r.CHR_BANK_0} (${safeHex(r.CHR_BANK_0)})\n`;
        out+=`R1 : ${r.CHR_BANK_1} (${safeHex(r.CHR_BANK_1)})\n`;
        out+=`R2 : ${r.CHR_BANK_2} (${safeHex(r.CHR_BANK_2)})\n`;
        out+=`R3 : ${r.CHR_BANK_3} (${safeHex(r.CHR_BANK_3)})\n`;
        out+=`R4 : ${r.CHR_BANK_4} (${safeHex(r.CHR_BANK_4)})\n`;
        out+=`R5 : ${r.CHR_BANK_5} (${safeHex(r.CHR_BANK_5)})\n`;

        out+="\nPPU CHR MAP\n";
        out+="-----------------------------\n";

        for(let i=0;i<8;i++)
            out+=`${addr[i]} -> bank ${map[i]}\n`;

        ta.value=out;
    }

    render();

    if(timer)
        clearInterval(timer);

    window.__mmc3DynamicDebugTimer=setInterval(render,200);
}

function mmc3SaveState(){
  const r=MMC3.registers,c=MMC3.control,q=mmc3_irq;
  const base=new Uint8Array([
    1,
    c.prgMode==="PRG_SWAP_C000"?1:0,
    c.chrMode==="CHR_INVERTED"?1:0,
    ["CHR_BANK_0","CHR_BANK_1","CHR_BANK_2","CHR_BANK_3","CHR_BANK_4","CHR_BANK_5","PRG_BANK_0","PRG_BANK_1"].indexOf(c.selectedRegister)&7,
    c.prgRamEnabled?1:0,c.prgRamWriteProtect?1:0,
    r.CHR_BANK_0&255,r.CHR_BANK_1&255,r.CHR_BANK_2&255,r.CHR_BANK_3&255,r.CHR_BANK_4&255,r.CHR_BANK_5&255,
    r.PRG_BANK_0&255,r.PRG_BANK_1&255,
    q.scanlineCounter&255,q.latch&255,q.reload?1:0,q.enabled?1:0,q.prevA12?1:0,
    q.lowSince&255,(q.lowSince>>>8)&255,(q.lowSince>>>16)&255,(q.lowSince>>>24)&255,
    irqAssert.mmc3?1:0,
    MIRRORING==='horizontal'?1:MIRRORING==='vertical'?0:2
  ]);
  if(mapperNumber!==119)return base;
  const out=new Uint8Array(base.length+tqromChrRam.length);
  out.set(base);
  out[0]=2;
  out.set(tqromChrRam,base.length);
  return out;
}
function mmc3LoadState(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<24||(bytes[0]!==1&&bytes[0]!==2))return false;
  const version=bytes[0];
  let o=1;const names=["CHR_BANK_0","CHR_BANK_1","CHR_BANK_2","CHR_BANK_3","CHR_BANK_4","CHR_BANK_5","PRG_BANK_0","PRG_BANK_1"];
  MMC3.control.prgMode=bytes[o++]?"PRG_SWAP_C000":"PRG_SWAP_8000";
  MMC3.control.chrMode=bytes[o++]?"CHR_INVERTED":"CHR_NORMAL";
  MMC3.control.selectedRegister=names[bytes[o++]&7];
  MMC3.control.prgRamEnabled=!!bytes[o++];MMC3.control.prgRamWriteProtect=!!bytes[o++];
  MMC3.registers.CHR_BANK_0=bytes[o++];MMC3.registers.CHR_BANK_1=bytes[o++];MMC3.registers.CHR_BANK_2=bytes[o++];
  MMC3.registers.CHR_BANK_3=bytes[o++];MMC3.registers.CHR_BANK_4=bytes[o++];MMC3.registers.CHR_BANK_5=bytes[o++];
  MMC3.registers.PRG_BANK_0=bytes[o++];MMC3.registers.PRG_BANK_1=bytes[o++];
  mmc3_irq.scanlineCounter=bytes[o++];mmc3_irq.latch=bytes[o++];mmc3_irq.reload=!!bytes[o++];mmc3_irq.enabled=!!bytes[o++];
  mmc3_irq.prevA12=!!bytes[o++];
  mmc3_irq.lowSince=(bytes[o++]|(bytes[o++]<<8)|(bytes[o++]<<16)|(bytes[o++]<<24))>>>0;
  irqAssert.mmc3=!!bytes[o++];
  const m=bytes[o++];if(m===0)MIRRORING='vertical';else if(m===1)MIRRORING='horizontal';
  if(mapperNumber===119&&version>=2&&bytes.length>=o+tqromChrRam.length)
    tqromChrRam.set(bytes.subarray(o,o+tqromChrRam.length));
  return true;
}
