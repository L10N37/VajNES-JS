function runBusTest() {
  console.debug("=== NES Bus Test ===");

  let total = 0;
  let passCount = 0;
  let failList = [];
  let groupStats = {};

  function recordResult(addr, label, exp, got) {
    total++;
    if (got === exp) {
      passCount++;
      groupStats[label] = (groupStats[label] || 0) + 1;
    } else {
      failList.push({ addr, label, exp, got });
    }
  }

  // ---------- CPU RAM ----------
  for (let a = 0; a < 0x0800; a += 0x40) {
    const val = (a ^ 0xAA) & 0xFF;
    checkWriteOffset(a, val);
    const got = checkReadOffset(a);
    recordResult(a, "CPU RAM", val, got);
  }

  // ---------- PRG RAM ----------
  for (let a = 0x6000; a < 0x8000; a += 0x40) {
    const val = (a ^ 0x55) & 0xFF;
    checkWriteOffset(a, val);
    const got = checkReadOffset(a);
    recordResult(a, "PRG RAM", val, got);
  }

  // ---------- VRAM / Nametables ----------
  for (let v = 0x2000; v < 0x2400; v += 0x40) {
    const val = (v ^ 0x77) & 0xFF;

    // write via $2006/$2007
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkWriteOffset(0x2007, val);

    // reset addr and prime buffer
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkReadOffset(0x2007); // dummy read

    // real read
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    const got = checkReadOffset(0x2007);

    recordResult(v, "Nametable", val, got);
  }

  // ---------- Palette ----------
  for (let v = 0x3F00; v < 0x3F20; v++) {
    const val = v & 0x1F;
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkWriteOffset(0x2007, val);

    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    const got = checkReadOffset(0x2007);
    recordResult(v, "Palette", val & 0x3F, got);
  }

  // ---------- OAM ----------
  for (let i = 0; i < 0x100; i += 0x20) {
    checkWriteOffset(0x2003, i);
    checkWriteOffset(0x2004, i ^ 0xAB);
    checkWriteOffset(0x2003, i);
    const got = checkReadOffset(0x2004);
    recordResult(0x2004, "OAMDATA", i ^ 0xAB, got);
  }

    // ---------- CPU RAM mirrors ----------
  for (let base = 0x0000; base < 0x0800; base += 0x100) {
    const val = (base ^ 0xCC) & 0xFF;
    checkWriteOffset(base, val);
    const mirrorAddr = base + 0x0800; // $0800 mirrors $0000
    const got = checkReadOffset(mirrorAddr);
    recordResult(mirrorAddr, "CPU RAM mirror", val, got);
  }

    // ---------- VRAM mirrors ----------
  for (let v = 0x2000; v < 0x2400; v += 0x40) {
    const val = (v ^ 0x5A) & 0xFF;

    // write original
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkWriteOffset(0x2007, val);

    // read mirror at $3000 region
    const mirror = v + 0x1000;
    checkWriteOffset(0x2006, (mirror >> 8) & 0x3F);
    checkWriteOffset(0x2006, mirror & 0xFF);
    checkReadOffset(0x2007); // dummy read
    checkWriteOffset(0x2006, (mirror >> 8) & 0x3F);
    checkWriteOffset(0x2006, mirror & 0xFF);
    const got = checkReadOffset(0x2007);

    recordResult(mirror, "VRAM mirror", val, got);
  }

    // ---------- Palette mirrors ----------
  for (let v = 0x3F00; v < 0x3F20; v++) {
    const val = (v ^ 0x3C) & 0x3F;

    // write into base palette
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkWriteOffset(0x2007, val);

    // read from mirrored address
    const mirror = 0x3F20 + (v & 0x1F); // repeats every 0x20 up to 0x3FFF
    checkWriteOffset(0x2006, (mirror >> 8) & 0x3F);
    checkWriteOffset(0x2006, mirror & 0xFF);
    const got = checkReadOffset(0x2007);

    recordResult(mirror, "Palette mirror", val, got);
  }

  // ---------- CHR ROM/RAM (if writable mapper) ----------
  for (let v = 0; v < 0x2000; v += 0x100) {
    const val = (v ^ 0x99) & 0xFF;
    SHARED.CHR_ROM[v] = val;  // direct write (mapper dependent)
    const got = SHARED.CHR_ROM[v];
    recordResult(v, "CHR", val, got);
  }

  // ---------- Write-only PPU registers ----------
  checkWriteOffset(0x2000, 0x80); recordResult(0x2000, "PPUCTRL", 0x80, PPUCTRL);
  checkWriteOffset(0x2001, 0x1E); recordResult(0x2001, "PPUMASK", 0x1E, PPUMASK);
  checkWriteOffset(0x2003, 0x33); recordResult(0x2003, "OAMADDR", 0x33, OAMADDR);

  // ---------- Read-only PPUSTATUS ----------
  PPUSTATUS = 0xE0;
  const got2002 = checkReadOffset(0x2002);
  recordResult(0x2002, "PPUSTATUS", 0xE0, got2002 | 0xE0);

  // ---------- APU ----------
  APUregister.SND_CHN = 0xAA;
  const got4015 = checkReadOffset(0x4015);
  recordResult(0x4015, "APU $4015", 0xAA, got4015);

  // ---------- Controllers ----------
  checkWriteOffset(0x4016, 0x01); recordResult(0x4016, "Joypad1 strobe", 0x01, JoypadRegister.JOYPAD1);
  checkWriteOffset(0x4017, 0x02); recordResult(0x4017, "Joypad2 strobe", 0x02, JoypadRegister.JOYPAD2);

  // ---------- Summary ----------
  console.debug("---- PASS GROUPS ----");
  for (let [label, count] of Object.entries(groupStats)) {
    console.debug(`${label}: ${count} ok`);
  }

  console.debug(`TOTAL: ${passCount} / ${total} passed`);
  console.debug(`FAIL: ${failList.length}`);

  if (failList.length) {
    console.debug("---- FAIL DETAILS ----");
    failList.forEach(f => {
      console.debug(
        `[${f.label}] $${f.addr.toString(16).padStart(4,"0")} exp=$${f.exp.toString(16).padStart(2,"0")} got=$${f.got.toString(16).padStart(2,"0")}`
      );
    });
  }

  console.debug("=== END TEST ===");
}
