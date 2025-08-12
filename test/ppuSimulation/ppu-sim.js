
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

  // NOTE: paletteRAM is NOT redeclared — uses global
  for (let i = 0; i < paletteRAM.length; i++) {
    paletteRAM[i] = i % 64;
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
      const paletteIndex  = paletteRAM[paletteBase + pixelValue];

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
