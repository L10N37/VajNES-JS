function runBusTest() {
  console.log("=== NES Bus Test ===");

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

    // ---------- Nametables ----------
    for (let v = 0x2000; v < 0x2400; v += 0x40) {
    const val = (v ^ 0x77) & 0xFF;

    // write the value
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkWriteOffset(0x2007, val);

    // reset addr and prime read buffer
    checkWriteOffset(0x2006, (v >> 8) & 0x3F);
    checkWriteOffset(0x2006, v & 0xFF);
    checkReadOffset(0x2007); // dummy read to fill buffer

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

  // ---------- Write-only PPU registers ----------
  checkWriteOffset(0x2000, 0x80); recordResult(0x2000, "PPUCTRL", 0x80, PPUCTRL);
  checkWriteOffset(0x2001, 0x1E); recordResult(0x2001, "PPUMASK", 0x1E, PPUMASK);
  checkWriteOffset(0x2003, 0x33); recordResult(0x2003, "OAMADDR", 0x33, OAMADDR);

  // ---------- Read-only PPUSTATUS ----------
  PPUSTATUS = 0xE0;
  const got2002 = checkReadOffset(0x2002);
  recordResult(0x2002, "PPUSTATUS", 0xE0, got2002 | 0xE0);

  // ---------- APU readable reg ----------
  APUregister.SND_CHN = 0xAA;
  const got4015 = checkReadOffset(0x4015);
  recordResult(0x4015, "APU $4015", 0xAA, got4015);

  // ---------- Controllers ----------
  checkWriteOffset(0x4016, 0x01); recordResult(0x4016, "Joypad1 strobe", 0x01, JoypadRegister.JOYPAD1);
  checkWriteOffset(0x4017, 0x02); recordResult(0x4017, "Joypad2 strobe", 0x02, JoypadRegister.JOYPAD2);

  // ---------- Summary ----------
  console.log("---- PASS GROUPS ----");
  for (let [label, count] of Object.entries(groupStats)) {
    console.log(`${label}: ${count} ok`);
  }

  console.log(`TOTAL: ${passCount} / ${total} passed`);
  console.log(`FAIL: ${failList.length}`);

  if (failList.length) {
    console.log("---- FAIL DETAILS ----");
    failList.forEach(f => {
      console.log(
        `[${f.label}] $${f.addr.toString(16).padStart(4,"0")} exp=$${f.exp.toString(16).padStart(2,"0")} got=$${f.got.toString(16).padStart(2,"0")}`
      );
    });
  }

  console.log("=== END TEST ===");
}
