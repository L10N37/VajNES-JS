
// ===== 1. CONSTANTS =====
const SCREEN_WIDTH  = 256;
const SCREEN_HEIGHT = 240;
const TILES_X       = 32;
const TILES_Y       = 30;
const TOTAL_TILES   = 512;
const TILE_BYTES    = 16;

// ===== 2. FAKE MEMORY =====
let chrROM, nameTable, attributeTable;
let lowPlaneLUT, highPlaneLUT;

function generateFakePPUMemory() {
  // CHR-ROM fake pattern table
  chrROM = new Uint8Array(TOTAL_TILES * TILE_BYTES);
  for (let t = 0; t < TOTAL_TILES; t++) {
    for (let row = 0; row < 8; row++) {
      chrROM[t * 16 + row]     = (t % 2 === 0) ? 0b10101010 : 0b01010101;
      chrROM[t * 16 + row + 8] = (t % 2 === 0) ? 0b01010101 : 0b10101010;
    }
  }

  // Nametable (tile indices)
  nameTable = new Uint8Array(TILES_X * TILES_Y);
  for (let i = 0; i < nameTable.length; i++) {
    nameTable[i] = i % TOTAL_TILES;
  }

  // Attribute table (palette selections 0–3)
  attributeTable = new Uint8Array(64);
  for (let i = 0; i < attributeTable.length; i++) {
    attributeTable[i] = i % 4;
  }

  // NOTE: SHARED.PALETTE_RAM is NOT redeclared — uses global
  for (let i = 0; i < SHARED.PALETTE_RAM.length; i++) {
    SHARED.PALETTE_RAM[i] = i % 64;
  }
}

// ===== 3. LUTs =====
function buildTileLUTs() {
  lowPlaneLUT  = new Uint8Array(TOTAL_TILES * 8);
  highPlaneLUT = new Uint8Array(TOTAL_TILES * 8);
  for (let tileIndex = 0; tileIndex < TOTAL_TILES; tileIndex++) {
    for (let row = 0; row < 8; row++) {
      const lutIndex = tileIndex * 8 + row;
      lowPlaneLUT[lutIndex]  = chrROM[tileIndex * 16 + row];
      highPlaneLUT[lutIndex] = chrROM[tileIndex * 16 + row + 8];
    }
  }
}

// ===== 4. RENDER FRAME =====
function renderSimFrame() {
  generateFakePPUMemory();
  buildTileLUTs();

  console.time("Frame compute");
  const frameBuffer = Array.from({ length: SCREEN_HEIGHT }, () => new Uint8Array(SCREEN_WIDTH));

  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    const tileY     = Math.floor(y / 8);
    const rowInTile = y % 8;

    for (let x = 0; x < SCREEN_WIDTH; x++) {
      const tileX    = Math.floor(x / 8);
      const tileIndex = nameTable[tileY * TILES_X + tileX];
      const lutIndex  = tileIndex * 8 + rowInTile;

      const lowByte  = lowPlaneLUT[lutIndex];
      const highByte = highPlaneLUT[lutIndex];

      const pixelBit   = 7 - (x % 8);
      const pixelValue = ((highByte >> pixelBit) & 1) << 1 | ((lowByte >> pixelBit) & 1);

      const attrX         = Math.floor(tileX / 4);
      const attrY         = Math.floor(tileY / 4);
      const attrIndex     = attrY * 8 + attrX;
      const paletteNumber = attributeTable[attrIndex];

      const paletteBase   = paletteNumber * 4;
      const paletteIndex  = SHARED.PALETTE_RAM[paletteBase + pixelValue];

      frameBuffer[y][x] = paletteIndex;
    }
  }
  console.timeEnd("Frame compute");

  // Flatten frameBuffer to single Uint8Array of palette indices
  console.time("Frame blit");
  const flat = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  let i = 0;
  for (let y = 0; y < SCREEN_HEIGHT; y++) {
    for (let x = 0; x < SCREEN_WIDTH; x++) {
      flat[i++] = frameBuffer[y][x];
    }
  }

  // Cache so live palette changes can re-blit without recomputing
  window.lastSimIndices = flat;
  window.lastSimSize    = { w: SCREEN_WIDTH, h: SCREEN_HEIGHT };

  // Initial blit
  blitNESFramePaletteIndex(flat, SCREEN_WIDTH, SCREEN_HEIGHT);
  console.timeEnd("Frame blit");
}


// nothing to do with the above, save making endless new test files

// =============================================
// Fake cartridge / PPU seeding for test output
// =============================================

function seedFakePPUData() {

  seedFakePRG();

  // 1) CHR ROM (pattern tables)
  // Build simple 8×8 tiles with diagonal stripes, checkerboards, etc.
  for (let tile = 0; tile < 256; tile++) {
    for (let row = 0; row < 8; row++) {
      // Low plane = alternating stripes, High plane = inverted
      const lo = ((row + tile) & 1) ? 0b10101010 : 0b01010101;
      const hi = ((row + (tile >> 2)) & 1) ? 0b11110000 : 0b00001111;
      const base = tile * 16;
      CHR_ROM[base + row]     = lo;
      CHR_ROM[base + row + 8] = hi;
    }
  }

  // 2) Name table $2000 (32×30 = 960 bytes)
  // Fill with sequential tile IDs, so screen shows a grid of tiles
  for (let y = 0; y < 30; y++) {
    for (let x = 0; x < 32; x++) {
      const idx = y * 32 + x;
      VRAM[idx] = (x + y) & 0xFF;  // wraps around CHR tile range
    }
  }

  // 3) Attribute table $23C0..$23FF (64 bytes)
  // Alternate between palette 1 and 2 in a checkerboard
  for (let i = 0; i < 64; i++) {
    const xBlock = i & 7;
    const yBlock = i >> 3;
    const quad = ((xBlock ^ yBlock) & 1) ? 0b01 : 0b10;
    VRAM[0x3C0 + i] = (quad << 6) | (quad << 4) | (quad << 2) | quad;
  }

  // 4) Palette RAM ($3F00–$3F1F)
  // Cycle through the 64 master palette indices
  for (let i = 0; i < 32; i++) {
    PALETTE_RAM[i] = (i * 2) & 0x3F;
  }
  // Ensure universal background color is a strong visible value
  PALETTE_RAM[0x00] = 0x0F;
  PALETTE_RAM[0x04] = 0x0F;
  PALETTE_RAM[0x08] = 0x0F;
  PALETTE_RAM[0x0C] = 0x0F;

  console.debug("[PPU] Fake data seeded: CHR, NT, AT, palette");
}

function seedFakePRG() {
  // Fill with NOP ($EA) initially
  for (let i = 0; i < prgRom.length; i++) {
    prgRom[i] = 0xEA;
  }

  // Program @ $8000
  let pc = 0x0000; // offset into prgRom (CPU $8000)

  function emit(op) { prgRom[pc++] = op & 0xFF; }

  // --- Reset init code ---
  // LDA #$00
  emit(0xA9); emit(0x00);
  // STA $2000
  emit(0x8D); emit(0x00); emit(0x20);
  // STA $2001
  emit(0x8D); emit(0x01); emit(0x20);

  // LDA #$1E ; enable background + color
  emit(0xA9); emit(0x1E);
  // STA $2001
  emit(0x8D); emit(0x01); emit(0x20);

  // LDA #$00 ; scroll X
  emit(0xA9); emit(0x00);
  // STA $2005
  emit(0x8D); emit(0x05); emit(0x20);
  // LDA #$00 ; scroll Y
  emit(0xA9); emit(0x00);
  // STA $2005
  emit(0x8D); emit(0x05); emit(0x20);

  // --- Infinite loop ---
  const loopAddr = 0x8000 + pc; // actual CPU address after setup
  emit(0x4C);                   // JMP abs
  emit(loopAddr & 0xFF);
  emit((loopAddr >> 8) & 0xFF);

  // --- Reset Vector ---
  const resetVector = 0x7FFC; // CPU $FFFC
  prgRom[resetVector - 0x8000] = 0x00; // low byte ($8000)
  prgRom[resetVector - 0x8000 + 1] = 0x80; // high byte ($8000)

  console.debug("[CPU] Fake PRG seeded: init PPU + infinite loop");
}
