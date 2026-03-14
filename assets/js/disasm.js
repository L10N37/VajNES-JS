"use strict";

let disasmEnabled = false;

openDisasm.onclick = () => {
    disasmEnabled = !disasmEnabled;
    window.alert(disasmEnabled ? "Disassembler enabled (console)" : "Disassembler disabled (console)");
};

function disasm(){
if (disasmEnabled) {

    const hex2 = v => (typeof v === "number")
        ? v.toString(16).toUpperCase().padStart(2, "0")
        : "--";

    const hex4 = v => v.toString(16).toUpperCase().padStart(4, "0");

    const mnemonic = OPCODES[code].func.name;

    const flags =
        `${CPUregisters.P.N ? "N" : "n"}` +
        `${CPUregisters.P.V ? "V" : "v"}` +
        `-` +
        `${CPUregisters.P.B ? "B" : "b"}` +
        `${CPUregisters.P.D ? "D" : "d"}` +
        `${CPUregisters.P.I ? "I" : "i"}` +
        `${CPUregisters.P.Z ? "Z" : "z"}` +
        `${CPUregisters.P.C ? "C" : "c"}`;

    console.log(
        `${hex4(CPUregisters.PC)}  ` +
        `${hex2(code)} ${hex2(operand1)} ${hex2(operand2)}  ` +
        `${mnemonic.padEnd(12)}  ` +
        `A:${hex2(CPUregisters.A)} ` +
        `X:${hex2(CPUregisters.X)} ` +
        `Y:${hex2(CPUregisters.Y)} ` +
        `SP:${hex2(CPUregisters.S)} ` +
        `P:${flags}`
    );
  }
}