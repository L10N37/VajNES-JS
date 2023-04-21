const CPUregister = 
{
AC:[bitSeven= 0,bitSix= 0,bitFive= 0,bitFour= 0,bitThree= 0,bitTwo= 0,bitOne= 0,bitZero= 0],
X:[bitSeven= 0,bitSix= 0,bitFive= 0,bitFour= 0,bitThree= 0,bitTwo= 0,bitOne= 0,bitZero= 0],
Y:[bitSeven= 0,bitSix= 0,bitFive= 0,bitFour= 0,bitThree= 0,bitTwo= 0,bitOne= 0,bitZero= 0],
// default to bit 2 set (unused)
SR:[bitSeven= 0,bitSix= 0,bitFive= 0,bitFour= 0,bitThree= 0,bitTwo= 1,bitOne= 0,bitZero= 0],
SP:[bitSeven= 0,bitSix= 0,bitFive= 0,bitFour= 0,bitThree= 0,bitTwo= 0,bitOne= 0,bitZero= 0],
flag: [C= 0, Z = 0, I= 0, D= 0, B= 0, O= 0, N= 0 ]
};
// Destructure for easier access
// direct access is available to flag bits with N,O,V,D,I,Z,C
const { AC, X, Y, SR, SP, flag } = CPUregister;



// every 6502 opcode in object, will this even be of use?!
const ADC= 
{ 
    immediate: 0x69, 
    zeroPage: 0x65, 
    zeroPagex: 0x75, 
    absolute:0x6D, 
    absolutex:0x7D, 
    absolutey:0x79, 
    indirectx: 0x61, 
    indirecty: 0x71 
};
const AND=
{ 
    immediate: 0x29, 
    zeroPage: 0x25, 
    zeroPagex: 0x35, 
    absolute: 0x2D, 
    absolutex: 0x3D, 
    absolutey: 0x39, 
    indirectx: 0x21,
    indirecty: 0x31
};
const ASL= 
{ 
accumulator: 0x0A, 
zeroPage: 0x06, 
zeroPagex: 0x16, 
absolute: 0x0E, 
absolutex: 0x1E 
};
const BIT=
{ 
zeroPage : 0x24, 
absolute: 0x2C 
};
const BPL = 
{ 
relative :0x10 
};
const BMI = 
{
relative: 0x30
};
const BVC=
{ 
relative: 0x50 
};
const BCC= 
{ 
relative: 0x90 
};
const BCS= 
{ 
relative: 0xB0 
};
const BNE=
{ 
relative: 0xD0
};
const BEQ=
{ 
relative: 0xF0
};
const BRK=
{ 
impliedied:0x00 
};
const CMP= 
{ 
immediate: 0xC9, 
zeroPage: 0xC5, 
zeroPagex: 0xD5,
absolute: 0xCD, 
absolutex: 0xDD, 
absolutey: 0xD9, 
indirectx: 0xC1, 
indirecty: 0xD1 
};
const CPY= 
{ 
immediate: 0xC0, 
zeroPage: 0xC4, 
absolute: 0xCC 
};
const DEC= 
{ 
zeroPage: 0xC6, 
zeroPagex: 0xD6, 
absolute: 0xCE, 
absolutex: 0xDE 
};
const EOR= 
{ 
immediate: 0x49, 
zeroPage: 0x45, 
zeroPagex: 0x55, 
absolute: 0x4D, 
absolutex: 0x5D, 
absolutey: 0x59, 
indirectx: 0x41, 
indirecty: 0x51 
};
const CLC= 
{ 
implied: 
0x18 
};
const SEC= 
{
implied: 0x38
};
const CLI= 
{ 
implied: 0x58
};
const SEI= 
{
implied: 0x78 
};
const CLV= 
{ 
implied: 0xB8 
};
const CLD= 
{ 
implied: 0xD8 
};
const SED= 
{ 
implied: 0xF8 
};
const INC= 
{
zpg: 0xE6, 
zeroPagex: 0xF6, 
absolute: 0xEE, 
absolutex: 0xFE 
};
const JMP= 
{ 
absolute : 0x4C, 
indirect : 0x6C 
};
const JSR= 
{ 
absolute: 0x20 
};
const LDA= 
{ 
immediate: 0xA9, 
zeroPage: 0xA5,
zeroPagex: 0xB5, 
absolute: 0xAD, 
absolutex: 0xBD,
absolutey: 0xB9, 
indirectx: 0xA1, 
indirecty: 0xB1 
};
const LDX= 
{ 
immediate: 0xA2, 
zeroPage: 0xB6, 
absolute: 0xAE, 
absolutey: 0xBE 
};
const LDY= 
{ 
immediate: 0xA0,
zeroPage: 0xA4, 
zeroPagex: 0xB4, 
absolute: 0xAC, 
absolutex: 0xBC 
};
const LSR= 
{ 
accumulator: 0x4A, 
zeroPage: 0x46, 
zeroPagex: 0x56, 
absolute: 0x4E, 
absolutex: 0x5E 
};
const NOP= 
{
implied: 0xEA 
};
const ORA= 
{ 
immediate: 0x09, 
zeroPage: 0x05, 
zeroPagex: 0x15, 
absolute: 0x0D, 
absolutex: 0x1D, 
absolutey: 0x19, 
indirectx: 0x01, 
indirecty: 0x11 
};
const TAX= 
{ 
implied: 0xAA 
};
const TXA= 
{ 
implied: 0x8A 
};
const DEX= 
{ 
implied : 0xCA
};
const INX= 
{ 
implied : 0xE8 
};
const TAY= 
{ 
implied: 0xA8 
};
const TYA= 
{ 
implied: 0x98 
};
const DEY= 
{
implied: 0x88 
};
const INY= 
{
implied: 0xC8 
};
const ROL= 
{ 
accumulator: 0x2A, 
zeroPage: 0x26, 
zeroPagex: 0x36, 
absolute: 0x2E, 
absolutex: 0x3E 
};
const ROR= 
{ 
accumulator: 0x6A, 
zeroPage: 0x66, 
zeroPagex: 0x76, 
absolute: 0x6E, 
absolutex: 0x7E 
};
const RTI= 
{ 
implied : 0x40 
};
const RTS= 
{
implied: 0x60 
};
const SBC= 
{ 
immediate: 0xE9, 
zeroPage: 0xE5, 
zeroPagex: 0xF5, 
absolute: 0xED, 
absolutex: 0xFD, 
absolutey: 0xF9, 
indirectx: 0xE1, 
indirecty: 0xF1 
};
const STA = 
{
zeroPage: 0x85,
zeroPagex: 0x95,
absolute: 0x8D,
absolutex: 0x9D,
absolutey: 0x99,
indirectx: 0x81,
indirecty: 0x91
};
const TXS= 
{ 
implied: 0x9A 
};
const TSX= 
{ 
implied: 0xBA  
};
const PHA= 
{ 
implied: 0x48 
};
const PLA= 
{ 
implied : 0x68 
};
const PHP= 
{
implied: 0x08
};
const PLP= 
{ 
implied: 0x28 
};
const STX= 
{ 
zeroPage: 0x86, 
zeropagey: 0x96, 
absolute: 0x8E  
};
const STY= 
{ 
zeroPage: 0x84, 
zeroPagex: 0x94, 
absolute: 0x8C 
};
const TA= {
zeroPage: 0x85, 
zeroPagex: 0x95, 
absolute: 0x8D, 
absolutex : 0x9D, 
absolutey : 0x99, 
indirectx : 0x81, 
indirecty : 0x91 
};
const BV1S=
{ 
relative: 0x70 
};
const CPX= 
{ 
immediate: 0xE0, 
zeroPage: 0xE4, 
absolute: 0xEC
};












