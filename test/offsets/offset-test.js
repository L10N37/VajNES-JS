// =========================
// Simple test helpers
// =========================
function expectEqual(name, got, expected) {
  if (got === expected) {
    console.log(`%cPASS%c ${name}`, "color:lime;font-weight:bold;", "");
  } else {
    console.error(`%cFAIL%c ${name} → got ${got}, expected ${expected}`,
                  "color:red;font-weight:bold;", "");
  }
}

// =========================
// TEST SUITE
// =========================
function runAllTests() {
  console.log("%c=== NES CPU/PPU/JOY/APU TESTS ===", "color:cyan;font-weight:bold;");

  // -----------------------
  // PPU read: Palette (immediate)
  // -----------------------
  PALETTE_RAM[0x00] = 0x1F;        // background color
  VRAM_ADDR = 0x3F00;

  let pal_read = checkReadOffset(0x2007); // should be immediate 0x1F

  expectEqual("Palette immediate read", pal_read, 0x1F);
  expectEqual("Palette buffer reloads with NT mirror", typeof VRAM_DATA, "number"); // buffer updated behind the scenes

  // -----------------------
  // PPU read: Nametable (buffered)
  // -----------------------
  VRAM[mapNT(0x2000)] = 0xBB;      // put data in NT
  VRAM_ADDR = 0x2000;              // point PPUADDR at NT

  let nt_dummy = checkReadOffset(0x2007); // first read = old VRAM_DATA
  let nt_real  = checkReadOffset(0x2007); // second read = actual 0xBB

  expectEqual("Nametable dummy read", nt_dummy, VRAM_DATA);
  expectEqual("Nametable real read", nt_real, 0xBB);

  // -----------------------
  // PPU read: Pattern table (buffered)
  // -----------------------
  CHR_ROM[0x0100] = 0xAA;          // write raw CHR data
  VRAM_ADDR = 0x0100;              // point PPUADDR at pattern table

  let pt_dummy = checkReadOffset(0x2007); // first read = old VRAM_DATA
  let pt_real  = checkReadOffset(0x2007); // second read = actual 0xAA

  expectEqual("Pattern table dummy read", pt_dummy, VRAM_DATA); 
  expectEqual("Pattern table real read", pt_real, 0xAA);

  // -----------------------
  // VRAM write + read test
  // -----------------------
  VRAM_ADDR = 0x2000;
  checkWriteOffset(0x2007, 0x99);     // write to NT via $2007

  VRAM_ADDR = 0x2000;                 // reset addr to same spot
  let dummy = checkReadOffset(0x2007); // buffered read (old VRAM_DATA)
  let real  = checkReadOffset(0x2007); // now should see 0x99

  expectEqual("VRAM dummy read first (buffered)", dummy, VRAM_DATA); // old buffer
  expectEqual("VRAM real read second", real, 0x99);

  // -----------------------
  // mapNT tests
  // -----------------------
  MIRRORING = "vertical";
  expectEqual("mapNT vertical NT0", mapNT(0x2000), 0x000);
  expectEqual("mapNT vertical NT2 mirrors NT0", mapNT(0x2800), 0x000);

  MIRRORING = "horizontal";
  expectEqual("mapNT horizontal NT0", mapNT(0x2000), 0x000);
  expectEqual("mapNT horizontal NT1 mirrors NT0", mapNT(0x2400), 0x000);
  expectEqual("mapNT horizontal NT2", mapNT(0x2800), 0x400);

  MIRRORING = "single0";
  expectEqual("mapNT single0 NT3", mapNT(0x2C00), 0x000);

  MIRRORING = "single1";
  expectEqual("mapNT single1 NT3", mapNT(0x2C00), 0x400);

  MIRRORING = "four";
  expectEqual("mapNT four NT3", mapNT(0x2C00), 0xC00);

  // -----------------------
  // paletteIndex tests
  // -----------------------
  expectEqual("paletteIndex $3F00", paletteIndex(0x3F00), 0x00);
  expectEqual("paletteIndex $3F10 mirrors $3F00", paletteIndex(0x3F10), 0x00);
  expectEqual("paletteIndex $3F14 mirrors $3F04", paletteIndex(0x3F14), 0x04);

  // -----------------------
  // CPU RAM read/write
  // -----------------------
  cpuWrite(0x0000, 0x42);
  expectEqual("cpuRead RAM 0x0000", cpuRead(0x0000), 0x42);

  // -----------------------
  // PRG-RAM read/write
  // -----------------------
  checkWriteOffset(0x6000, 0xAB);
  expectEqual("checkReadOffset PRG-RAM 0x6000", checkReadOffset(0x6000), 0xAB);

  // -----------------------
  // CHR-ROM/VRAM writes
  // -----------------------
  VRAM_ADDR = 0x0001;
  checkWriteOffset(0x2007, 0x55);
  expectEqual("CHR_ROM write fallback", CHR_ROM[0x0001], 0x55);

  VRAM_ADDR = 0x2000;
  checkWriteOffset(0x2007, 0x77);
  expectEqual("VRAM write NT", VRAM[mapNT(0x2000)], 0x77);

  VRAM_ADDR = 0x3F00;
  checkWriteOffset(0x2007, 0x23);
  expectEqual("PALETTE write normalized", PALETTE_RAM[0x00], 0x23);

  // -----------------------
  // PPUSTATUS read
  // -----------------------
  PPUSTATUS = 0x80;
  writeToggle = 1;
  let status = checkReadOffset(0x2002);
  expectEqual("checkReadOffset PPUSTATUS value", status, 0x80);
  expectEqual("checkReadOffset PPUSTATUS clear VBlank", (PPUSTATUS & 0x80), 0x00);
  expectEqual("checkReadOffset writeToggle reset", writeToggle, 0);

  // -----------------------
  // PRG-ROM direct read
  // -----------------------
  prgRom[0x1234] = 0x99;
  expectEqual("checkReadOffset PRG-ROM", checkReadOffset(0x9234), 0x99);

  // -----------------------
  // Joypad write/read
  // -----------------------
  // simulate controller always returning 1
  pollController1 = () => 1;
  pollController2 = () => 1;

  joypadWrite(0x4016, 1); // strobe on
  joypadWrite(0x4016, 0); // strobe off → latch states

  joypad1State = 0x01;
  let j1a = joypadRead(0x4016);
  expectEqual("joypadRead 1st bit", j1a & 1, 1);
  let j1b = joypadRead(0x4016);
  expectEqual("joypadRead shift works", (j1b & 1), (joypad1State & 1));

  joypad2State = 0x01;
  let j2a = joypadRead(0x4017);
  expectEqual("joypadRead2 1st bit", j2a & 1, 1);

  // -----------------------
  // APU write/read
  // -----------------------
  checkWriteOffset(0x4000, 0x55);
  expectEqual("APU SQ1_VOL write", APUregister.SQ1_VOL, 0x55);

  checkWriteOffset(0x4015, 0x99);
  expectEqual("APU SND_CHN write", APUregister.SND_CHN, 0x99);
  expectEqual("APU SND_CHN read", checkReadOffset(0x4015), 0x99);

  checkWriteOffset(0x4017, 0x77);
  expectEqual("APU FRAME_CNT write", APUregister.FRAME_CNT, 0x77);

  console.log("%c=== TESTS COMPLETE ===", "color:cyan;font-weight:bold;");
}
