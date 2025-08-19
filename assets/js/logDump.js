// Store last dump values for change tracking
let lastDump = {};

// ---------- UI HELPERS ----------
function addSectionHeader(container, title, id) {
  const wrap = document.createElement('section');
  wrap.id = id;
  wrap.className = 'section-wrap';

  const h2 = document.createElement('h2');
  h2.innerText = title;
  h2.className = 'section-title';

  wrap.appendChild(h2);
  container.appendChild(wrap);
  return wrap;
}

// Hex table generator with change highlighting
function generateHexTable(title, array, baseAddress = 0x0000) {
  const table = document.createElement('table');
  table.className = 'dump-table hex-table';

  const caption = document.createElement('caption');
  caption.innerText = title;
  caption.className = 'table-caption';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.appendChild(document.createElement('th'));
  for (let col = 0; col < 16; col++) {
    const th = document.createElement('th');
    th.innerText = col.toString(16).toUpperCase().padStart(2, '0');
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const totalRows = Math.ceil(array.length / 16);
  const isROM = title.includes('PRG ROM') || title.includes('CHR ROM');

  if (!lastDump[title]) {
    lastDump[title] = new Uint8Array(array.length);
    if (isROM) lastDump[title].set(array);
  }

  for (let row = 0; row < totalRows; row++) {
    const tr = document.createElement('tr');

    const addr = baseAddress + row * 16;
    const addrCell = document.createElement('td');
    addrCell.innerText = addr.toString(16).toUpperCase().padStart(4, '0');
    addrCell.className = 'addr-cell';
    tr.appendChild(addrCell);

    for (let col = 0; col < 16; col++) {
      const idx = row * 16 + col;
      const td = document.createElement('td');
      td.className = 'data-cell';

      if (idx < array.length) {
        const val = array[idx];
        td.innerText = val.toString(16).toUpperCase().padStart(2, '0');

        if (lastDump[title][idx] !== val) {
          if (!(isROM && lastDump[title][idx] === 0 && lastDump[title].length === array.length)) {
            td.classList.add('changed');
          }
          lastDump[title][idx] = val;
        }
      } else {
        td.innerText = '';
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// Simple key/value register table
function generateRegisterTable(title, regList) {
  const table = document.createElement('table');
  table.className = 'dump-table kv-table';

  const caption = document.createElement('caption');
  caption.innerText = title;
  caption.className = 'table-caption';
  table.appendChild(caption);

  const tbody = document.createElement('tbody');
  for (const [key, value] of Object.entries(regList)) {
    const tr = document.createElement('tr');

    const tdKey = document.createElement('td');
    tdKey.innerText = key;
    tdKey.className = 'kv-key';
    tr.appendChild(tdKey);

    const tdVal = document.createElement('td');
    tdVal.innerText = '$' + (value & 0xFFFF).toString(16).toUpperCase().padStart(2, '0');
    tdVal.className = 'kv-val';
    tr.appendChild(tdVal);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// Controller state table
function generateControllerTable() {
  const table = document.createElement('table');
  table.className = 'dump-table kv-table';

  const caption = document.createElement('caption');
  caption.innerText = 'Controller State';
  caption.className = 'table-caption';
  table.appendChild(caption);

  const tbody = document.createElement('tbody');
  const states = {
    joypadStrobe,
    joypad1State: '0b' + joypad1State.toString(2).padStart(8, '0'),
    joypad2State: '0b' + joypad2State.toString(2).padStart(8, '0'),
  };

  for (const [key, value] of Object.entries(states)) {
    const tr = document.createElement('tr');

    const tdKey = document.createElement('td');
    tdKey.innerText = key;
    tdKey.className = 'kv-key';
    tr.appendChild(tdKey);

    const tdVal = document.createElement('td');
    tdVal.innerText = value;
    tdVal.className = 'kv-val';
    tr.appendChild(tdVal);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// ---------- MAIN CLICK HANDLER ----------
document.getElementById('dumpState').addEventListener('click', () => {
  const report = document.createElement('div');
  report.className = 'container';

  const cpuSec = addSectionHeader(report, 'CPU Memory', 'cpu');
  cpuSec.appendChild(generateHexTable('CPU RAM ($0000)', systemMemory, 0x0000));
  cpuSec.appendChild(generateHexTable('PRG ROM ($8000)', prgRom, 0x8000));

  const chrSec = addSectionHeader(report, 'CHR-ROM', 'chr');
  chrSec.appendChild(generateHexTable('CHR ROM ($0000)', CHR_ROM, 0x0000)); // accessor

  const vramSec = addSectionHeader(report, 'VRAM', 'vram');
  vramSec.appendChild(generateHexTable('PPU VRAM ($2000)', VRAM, 0x2000)); // accessor

  const palSec = addSectionHeader(report, 'Palette RAM', 'pal');
  palSec.appendChild(generateHexTable('Palette RAM ($3F00)', PALETTE_RAM, 0x3F00)); // accessor

  const oamSec = addSectionHeader(report, 'OAM', 'oam');
  oamSec.appendChild(generateHexTable('OAM ($0000)', OAM, 0x0000)); // accessor

  const regSec = addSectionHeader(report, 'Registers', 'regs');

  // CPU registers
  regSec.appendChild(generateRegisterTable('CPU Registers', CPUregisters));

  // PPU registers — build an object from your accessors
  const ppuRegs = {
    PPUCTRL,
    PPUMASK,
    PPUSTATUS,
    OAMADDR,
    OAMDATA,
    SCROLL_X,
    SCROLL_Y,
    ADDR_HIGH,
    ADDR_LOW,
    t_lo,
    t_hi,
    fineX,
    writeToggle,
    VRAM_DATA,
    BG_ntByte,
    BG_atByte,
    BG_tileLo,
    BG_tileHi,
    VRAM_ADDR
  };
  regSec.appendChild(generateRegisterTable('PPU Registers', ppuRegs));

  regSec.appendChild(generateRegisterTable('APU Registers', APUregister));

  const padSec = addSectionHeader(report, 'Controllers', 'pads');
  padSec.appendChild(generateControllerTable());

  const styles = `
    html, body { background: #0f1115; color: #e8eaf0; font-family: sans-serif; margin: 0; padding: 0; scroll-behavior: smooth; }
    .container { max-width: 1200px; margin: 40px auto 120px auto; padding: 0 16px; }
    .section-title { font-size: 20px; margin: 0 0 14px 0; padding-left: 6px; border-left: 3px solid #5bd0ff; }
    .dump-table { border-collapse: collapse; margin: 0 auto 20px auto; font-family: monospace; font-size: 13px; background: #161923; border: 1px solid #2a2f3a; border-radius: 14px; }
    .dump-table caption { caption-side: top; font-weight: 700; padding: 10px 12px; color: #6cf1b6; text-align: left; background: #182033; border-bottom: 1px solid #2a2f3a; }
    .dump-table th, .dump-table td { border: 1px solid #2a2f3a; padding: 6px 10px; text-align: center; }
    .addr-cell { font-weight: 700; color: #a8afc2; background: #171b28; }
    .data-cell.changed { background: #ff6b6b20; }
    .kv-key { color: #a8afc2; min-width: 180px; font-weight: 600; }
    .kv-val { font-weight: 700; }
    .jumpbar { position: fixed; left: 0; right: 0; bottom: 0; background: rgba(15,17,21,0.85); backdrop-filter: blur(6px); border-top: 1px solid #2a2f3a; padding: 10px 12px; z-index: 9999; }
    .jumpbar .inner { max-width: 1200px; margin: 0 auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
    .jumpbar button { border: 1px solid #2a2f3a; background: #1a1f2c; color: #e8eaf0; padding: 8px 12px; border-radius: 999px; cursor: pointer; font-weight: 600; }
    .jumpbar button.active { border-color: #5bd0ff; }
  `;

  const newTab = window.open('', '_blank');
  newTab.document.write(`<html><head><title>NES State Dump</title><style>${styles}</style></head><body></body></html>`);
  newTab.document.body.appendChild(report);

  const jumpbar = newTab.document.createElement('div');
  jumpbar.className = 'jumpbar';
  jumpbar.innerHTML = `
    <div class="inner">
      <button data-target="#cpu">CPU Memory</button>
      <button data-target="#chr">CHR-ROM</button>
      <button data-target="#vram">VRAM</button>
      <button data-target="#pal">Palette RAM</button>
      <button data-target="#oam">OAM</button>
      <button data-target="#regs">Registers</button>
      <button data-target="#pads">Controllers</button>
    </div>
  `;
  newTab.document.body.appendChild(jumpbar);

  const buttons = newTab.document.querySelectorAll('.jumpbar button');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = newTab.document.querySelector(btn.getAttribute('data-target'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
});
