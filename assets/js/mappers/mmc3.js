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
        prgRamEnabled: false,         // PRG-RAM enable flag from $A001
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
        console.error(
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

function mapper4_chr_read(address)
{
    const bankSize = 0x0400; // 1KB
    const chrBankCount = FULL_CHR_ROM_SIZE / bankSize;

    let bank;
    let offset;

    address &= 0x1FFF;

    if (MMC3.control.chrMode === "CHR_NORMAL")
    {
        // $0000-$07FF -> R0/R0+1 (2KB)
        if (address < 0x0800)
        {
            const base = MMC3.registers.CHR_BANK_0 & 0xFE;
            bank = base + ((address >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $0800-$0FFF -> R1/R1+1 (2KB)
        else if (address < 0x1000)
        {
            const base = MMC3.registers.CHR_BANK_1 & 0xFE;
            bank = base + (((address - 0x0800) >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $1000-$13FF -> R2
        else if (address < 0x1400)
        {
            bank = MMC3.registers.CHR_BANK_2;
            offset = address & 0x03FF;
        }

        // $1400-$17FF -> R3
        else if (address < 0x1800)
        {
            bank = MMC3.registers.CHR_BANK_3;
            offset = address & 0x03FF;
        }

        // $1800-$1BFF -> R4
        else if (address < 0x1C00)
        {
            bank = MMC3.registers.CHR_BANK_4;
            offset = address & 0x03FF;
        }

        // $1C00-$1FFF -> R5
        else
        {
            bank = MMC3.registers.CHR_BANK_5;
            offset = address & 0x03FF;
        }
    }
    else
    {
        // $0000-$03FF -> R2
        if (address < 0x0400)
        {
            bank = MMC3.registers.CHR_BANK_2;
            offset = address & 0x03FF;
        }

        // $0400-$07FF -> R3
        else if (address < 0x0800)
        {
            bank = MMC3.registers.CHR_BANK_3;
            offset = address & 0x03FF;
        }

        // $0800-$0BFF -> R4
        else if (address < 0x0C00)
        {
            bank = MMC3.registers.CHR_BANK_4;
            offset = address & 0x03FF;
        }

        // $0C00-$0FFF -> R5
        else if (address < 0x1000)
        {
            bank = MMC3.registers.CHR_BANK_5;
            offset = address & 0x03FF;
        }

        // $1000-$17FF -> R0/R0+1 (2KB)
        else if (address < 0x1800)
        {
            const base = MMC3.registers.CHR_BANK_0 & 0xFE;
            bank = base + (((address - 0x1000) >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $1800-$1FFF -> R1/R1+1 (2KB)
        else
        {
            const base = MMC3.registers.CHR_BANK_1 & 0xFE;
            bank = base + (((address - 0x1800) >> 10) & 1);
            offset = address & 0x03FF;
        }
    }

    bank &= (chrBankCount - 1);

    const romIndex = (bank * bankSize) + offset;
    const result = FULL_CHR_ROM[romIndex] & 0xFF;

    return result;
}

function mapper4_chr_write(address, value)
{
    if (!chrIsRAM) return; // CHR ROM ignores writes

    const bankSize = 0x0400; // 1KB
    const chrBankCount = FULL_CHR_ROM_SIZE / bankSize;

    let bank;
    let offset;

    address &= 0x1FFF;
    value &= 0xFF;

    if (MMC3.control.chrMode === "CHR_NORMAL")
    {
        // $0000-$07FF -> R0/R0+1 (2KB)
        if (address < 0x0800)
        {
            const base = MMC3.registers.CHR_BANK_0 & 0xFE;
            bank = base + ((address >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $0800-$0FFF -> R1/R1+1 (2KB)
        else if (address < 0x1000)
        {
            const base = MMC3.registers.CHR_BANK_1 & 0xFE;
            bank = base + (((address - 0x0800) >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $1000-$13FF -> R2
        else if (address < 0x1400)
        {
            bank = MMC3.registers.CHR_BANK_2;
            offset = address & 0x03FF;
        }

        // $1400-$17FF -> R3
        else if (address < 0x1800)
        {
            bank = MMC3.registers.CHR_BANK_3;
            offset = address & 0x03FF;
        }

        // $1800-$1BFF -> R4
        else if (address < 0x1C00)
        {
            bank = MMC3.registers.CHR_BANK_4;
            offset = address & 0x03FF;
        }

        // $1C00-$1FFF -> R5
        else
        {
            bank = MMC3.registers.CHR_BANK_5;
            offset = address & 0x03FF;
        }
    }
    else
    {
        // $0000-$03FF -> R2
        if (address < 0x0400)
        {
            bank = MMC3.registers.CHR_BANK_2;
            offset = address & 0x03FF;
        }

        // $0400-$07FF -> R3
        else if (address < 0x0800)
        {
            bank = MMC3.registers.CHR_BANK_3;
            offset = address & 0x03FF;
        }

        // $0800-$0BFF -> R4
        else if (address < 0x0C00)
        {
            bank = MMC3.registers.CHR_BANK_4;
            offset = address & 0x03FF;
        }

        // $0C00-$0FFF -> R5
        else if (address < 0x1000)
        {
            bank = MMC3.registers.CHR_BANK_5;
            offset = address & 0x03FF;
        }

        // $1000-$17FF -> R0/R0+1 (2KB)
        else if (address < 0x1800)
        {
            const base = MMC3.registers.CHR_BANK_0 & 0xFE;
            bank = base + (((address - 0x1000) >> 10) & 1);
            offset = address & 0x03FF;
        }

        // $1800-$1FFF -> R1/R1+1 (2KB)
        else
        {
            const base = MMC3.registers.CHR_BANK_1 & 0xFE;
            bank = base + (((address - 0x1800) >> 10) & 1);
            offset = address & 0x03FF;
        }
    }

    bank &= (chrBankCount - 1);

    const romIndex = (bank * bankSize) + offset;

    if (romIndex >= 0 && romIndex < FULL_CHR_ROM.length)
    {
        FULL_CHR_ROM[romIndex] = value;
    }
}

// ============================ //
//   A12 EDGE DETECTOR          //
// ============================ //
const mmc3_irq = {

  scanlineCounter: 0,
  latch: 0,

  reload: false,
  prevA12: 0,
  a12LowCount: 0 // for filter

};


// pre req's IRQ/NMI timing + overlap behavior
function mmc3Irq(addr){

    const A12_STATE = (addr >> 12) & 1;

    // count how long A12 is LOW
    if (!A12_STATE) {
    mmc3_irq.a12LowCount++;
    }

    // detect rising edge with filter
    if (!mmc3_irq.prevA12 && A12_STATE && mmc3_irq.a12LowCount >= 8) {

    console.log("A12 rising edge detected - Last A12:", mmc3_irq.prevA12, "this A12:", A12_STATE, "vramAddr:", VRAM_ADDR.toString(16));

    if (mmc3_irq.scanlineCounter === 0 || mmc3_irq.reload) {

        mmc3_irq.scanlineCounter = mmc3_irq.latch;

        console.log("mmc3 scanline counter reloaded:", mmc3_irq.scanlineCounter);

        mmc3_irq.reload = false;

    } else {

        mmc3_irq.scanlineCounter--;

        console.log("scanline counter dec'd:", mmc3_irq.scanlineCounter);

    }

    // IRQ fires when counter becomes 0
    if (mmc3_irq.scanlineCounter === 0 && mmc3_irq.reload === false) {
        console.log("MMC3 IRQ FIRED");
        irqPending = 1; // or service straight away with serviceIRQ() ?
    }
    }

    // reset filter if A12 is high
    if (A12_STATE) {
    mmc3_irq.a12LowCount = 0;
    }

    mmc3_irq.prevA12 = A12_STATE;

}

// http://kevtris.org/mappers/mmc3/index.html

function mapper4_write_C000(value)
{
    mmc3_irq.latch = value & 0xFF;
    console.log("latch $C000:", mmc3_irq.latch);
}

function mapper4_write_C001(value)
{
    console.log("$C001 reg hit ,reload set to true, counter cleared")
    mmc3_irq.reload = true;
    mmc3_irq.scanlineCounter = 0;
}

function mapper4_write_E000(value)
{
    CPUregisters.P.I = 1;
    console.log("mmc3 irq enabled:", CPUregisters.P.I);
    irqPending = 0;
}

function mapper4_write_E001(value)
{
    CPUregisters.P.I = 0;
    console.log("mmc3 irq enabled:", CPUregisters.P.I);
}


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

        if(mapperNumber!==4)
        {
            ta.value="MMC3 DEBUGGER\n\nGame is not mapper 4.";
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