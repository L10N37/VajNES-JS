/*
============================================================
                     MMC3 (MAPPER 4)
                IMPLEMENTATION OUTLINE
============================================================

1. MEMORY MAP
------------------------------------------------------------
PRG:
- 8 KB fixed at $E000–$FFFF (last PRG bank)
- 8 KB switchable at $A000–$BFFF
- 8 KB switchable at $8000–$9FFF
- 8 KB switchable or fixed at $C000–$DFFF depending on PRG mode

1) Declare the 4 PRG slots, address wrap accordingly and make sure the slots are all filled with
appropriate data at rom launch.

CHR:
- 2 × 2 KB switchable banks
- 4 × 1 KB switchable banks
- CHR mode bit flips which set appears at $0000–0FFF vs $1000–1FFF

2) Declare the 6 switchable banks, add the logic for the CHR mode that places the correct character set
at the 2 address ranges above.

------------------------------------------------------------
2. REGISTERS ($8000–$FFFF)
------------------------------------------------------------

$8000 — Bank Select
  7  bit  0
  CPRM MRRR
  C = CHR mode (swap CHR halves)
  P = PRG mode (swap PRG fixed/switchable)
  RRR = bank register select (0–7)

 3) Add the bank select byte, declare it, add appropriate masking for bit checking / logic

                Bit 7 = C

                Bit 6 = P

                Bit 5 = R (unused)

                Bit 4 = M (unused)

                Bits 3–0 = RRRR (bank register select, but only 0–7 are valid)

Bank register targets:
  0 = 2 KB CHR @ $0000
  1 = 2 KB CHR @ $0800
  2 = 1 KB CHR @ $1000
  3 = 1 KB CHR @ $1400
  4 = 1 KB CHR @ $1800
  5 = 1 KB CHR @ $1C00
  6 = 8 KB PRG slot A ($8000 or $C000 depending on PRG mode)
  7 = 8 KB PRG slot B ($A000 or $8000 depending on PRG mode)

  Writes to $8000 select which of the 8 internal bank registers you are about to modify, and then $8001 writes the value into that register.

$8000:
👉 “Which slot do I want to update?”
And $8001:
👉 “What bank number do I put into that slot?”

1. CPU writes to $8000

This stores an 8-bit value into the mapper's internal “bank select register.”

Bits 0–2 tell the mapper which internal slot (0–7) will be updated next.

Bits 6–7 immediately change PRG/CHR mode.

So after writing $8000, the mapper knows:

✔ Which slot is selected
✔ CHR mode bit
✔ PRG mode bit

4) 4) Add the logic for the above, an $8000 address write to our declared byte happens, apparently we don't need to read this
register, just write it. 

this sets our selected slot, CHR mode bit and PRG mode bit.

same for $8001, game ROM juse writes the bit, no read back, just write. Set the bank into the slot in this reg.

Slots 0–5 = CHR banks
Slots 6–7 = PRG banks


$8001 — Bank Data
  - Writes actual bank number into selected register.

  5) this is outlined above

$A000 — Mirroring
  0 = Vertical
  1 = Horizontal
  (ignored on fixed-mirror boards)

  6) This is already kinda taken care, so we just check our write to $A000, we can use a bool i guess. 
  if it writes 0, set our vertical mirrorring, else set horizontal.

$A001 — PRG RAM Control
  - Enable/disable WRAM
  - Write-protect flag

  7) This is actually the SRAM for save games, enable or disable. Because all the other bits are ignored, we can use
  a bool instead of a masked out byte. (I think)

  by setting it to 1, we are protecting writes to our SRAM which could corrupt our save game files
  This sounds weird, i guess its a fail safe, as why would we ever write to the region unless saving a game.
  ...anyway 

  7)
IRQ Registers:
  $C000 = IRQ reload value
  $C001 = IRQ reload trigger (force reload on next A12 rise)
  $E000 = IRQ disable + acknowledge (clear IRQ)
  $E001 = IRQ enable

  8) well this is self explanatory i guess. Add the logic so the interrupt request stuff happens on writes to these regs.
  They are write only, so after the write, we have the according handlers run the logic.

------------------------------------------------------------
3. IRQ COUNTER LOGIC (CRITICAL PART)
------------------------------------------------------------
MMC3 IRQ counts rising edges on PPU A12.

Rules:
- Counter clocks ONLY on a 0→1 rising edge of PPU A12.
- A12 must stay low ~8 PPU cycles before rising to avoid false triggers.
- If counter == 0 on clock → reload from $C000 and IRQ fires on next clock.
- Else → counter--;

Reload control:
- Writing $C001 causes the next valid A12 rise to force a reload.
- $E000 disables IRQ and clears pending flag.
- $E001 enables IRQ.

IRQ fires to CPU when:
- Counter hits 0
- IRQ is enabled
- Rendering is active (not during vblank or forced blank)

9) I never like the ~around abouts symbol, but what ever. Theres a counter we need to declare, if its equal to 0, we do the IRQ 
reload value from step 8 with the $C000 write, so being equal to zero triggers the $C000 write.

look into this properly after the other steps.

------------------------------------------------------------
4. PRG BANKING
------------------------------------------------------------
PRG mode = bit 6 of $8000.

Mode 0:
  $8000-$9FFF = bank 6 (switchable)
  $A000-$BFFF = bank 7 (switchable)
  $C000-$DFFF = second-last PRG bank (fixed)
  $E000-$FFFF = last PRG bank (fixed)

Mode 1 (inverted):
  $C000-$DFFF = bank 6 (switchable)
  $A000-$BFFF = bank 7 (switchable)
  $8000-$9FFF = second-last PRG bank (fixed)
  $E000-$FFFF = last PRG bank (fixed)

  10) get a more throrough understanding of this when we get to this step.

------------------------------------------------------------
5. CHR BANKING
------------------------------------------------------------
CHR mode = bit 7 of $8000.

Mode 0:
  2 KB @ $0000 = reg 0
  2 KB @ $0800 = reg 1
  1 KB @ $1000 = reg 2
  1 KB @ $1400 = reg 3
  1 KB @ $1800 = reg 4
  1 KB @ $1C00 = reg 5

Mode 1 (swap regions):
  1 KB @ $0000 = reg 2
  1 KB @ $0400 = reg 3
  1 KB @ $0800 = reg 4
  1 KB @ $0C00 = reg 5
  2 KB @ $1000 = reg 0
  2 KB @ $1800 = reg 1

  11) get a more thorough understanding of this when we get to this step.

------------------------------------------------------------
6. SUMMARY OF WHAT YOU MUST IMPLEMENT
------------------------------------------------------------
- 8 bank registers (0–7)
- PRG mode swap logic
- CHR mode swap logic
- Mirroring write handler
- WRAM enable/write-protect logic
- A12 rising edge detection with ~8 PPU cycle debounce
- IRQ countdown with reload on 0
- IRQ enable/disable and acknowledgement
- Proper bank mapping for PRG and CHR after any register write

============================================================
End of MMC3 mapper outline
============================================================

12) we need to reroute all appropriate addresses passed to offsetHandler.js across to custom mmc3 handlers, dependant
on mapper being set to '4' on mapper 4 ROM load, same as what i did with mmc1.

*/