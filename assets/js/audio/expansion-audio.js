// Expansion-audio identification is intentionally separate from mapper code.
// NES 2.0 metadata wins when it can disambiguate the physical board. Legacy
// iNES images fall back to known PRG+CHR payload CRC32 values for mapper
// families where the mapper number alone is ambiguous.

const EXPANSION_AUDIO_CHIPS = Object.freeze({
  MMC5: 'MMC5',
  N163: 'Namco 163',
  VRC6: 'Konami VRC6',
  VRC7: 'Konami VRC7',
  SUNSOFT5B: 'Sunsoft 5B',
  FDS: 'Famicom Disk System'
});

const N163_AUDIO_CRC32 = new Set([
  0xEF7996BF, // Erika to Satoru no Yume Bouken
  0x5746A461, // Final Lap
  0x369DA42D, // King of Kings
  0x35D8C961, // Mappy Kids
  0x96773F32, // Megami Tensei II
  0x684B292F, // Namco Classic II
  0x9EDBE2E2, // Rolling Thunder
  0xE64B8975, // Sangokushi: Chuugen no Hasha
  0x098C672A, // Sangokushi II: Haou no Tairiku
  0xC811DC7A  // Youkai Douchuuki (audio used for SFX)
]);

const N163_NO_AUDIO_CRC32 = new Set([
  0xB5FF71AB,0x2A7D3ADF,0x10C8F2FA,0x0C1792DA,0x47C2020B,
  0xCF23290F,0xBC11E61A,0xACE56F39,0x4C5836BD,0xCA69751B
]);

function expansionPayloadCrc32(romBytes, header) {
  const trainer=(header[6]&4)?512:0;
  const start=16+trainer;
  const size=header[4]*0x4000+header[5]*0x2000;
  if(!size || romBytes.length<start+size) return null;
  return crc32Bytes(romBytes.subarray(start,start+size));
}

function detectExpansionAudio(romBytes, header, mapper, isNES2) {
  const sub=isNES2 ? (header[8]>>>4) : 0;
  const crc=expansionPayloadCrc32(romBytes,header);

  if(mapper===5) return {chip:EXPANSION_AUDIO_CHIPS.MMC5,confidence:'board'};
  if(mapper===24 || mapper===26) return {chip:EXPANSION_AUDIO_CHIPS.VRC6,confidence:'board'};
  if(mapper===20) return {chip:EXPANSION_AUDIO_CHIPS.FDS,confidence:'board'};

  if(mapper===19) {
    if(isNES2 && (sub===1 || sub===2)) return null;
    if(isNES2 && sub>=3 && sub<=5)
      return {chip:EXPANSION_AUDIO_CHIPS.N163,confidence:'nes2',mixSubmapper:sub};
    if(crc!==null && N163_AUDIO_CRC32.has(crc))
      return {chip:EXPANSION_AUDIO_CHIPS.N163,confidence:'database'};
    if(crc!==null && N163_NO_AUDIO_CRC32.has(crc)) return null;
    return {chip:EXPANSION_AUDIO_CHIPS.N163,confidence:'possible'};
  }

  if(mapper===69) {
    // Japanese Gimmick! uses Sunsoft 5B audio; the PAL NES release is FME-7.
    if(crc===0x0D65E7C7) return {chip:EXPANSION_AUDIO_CHIPS.SUNSOFT5B,confidence:'database'};
    if(crc===0xA713DD30) return null;
    return {chip:EXPANSION_AUDIO_CHIPS.SUNSOFT5B,confidence:'possible'};
  }

  if(mapper===85) {
    // NES 2.0: submapper 2 = VRC7a (Lagrange Point/audio),
    // submapper 1 = VRC7b (Tiny Toon 2/no audio mixing circuit).
    if(isNES2 && sub===1) return null;
    if(isNES2 && sub===2) return {chip:EXPANSION_AUDIO_CHIPS.VRC7,confidence:'nes2'};
    if(crc===0x743387FF) return {chip:EXPANSION_AUDIO_CHIPS.VRC7,confidence:'database'};
    if(crc===0xE4362167) return null;
    return {chip:EXPANSION_AUDIO_CHIPS.VRC7,confidence:'possible'};
  }

  return null;
}

let expansionAudioState={chip:null,enabled:false,confidence:null};

function configureExpansionAudioForRom(romBytes,header,mapper,isNES2) {
  const found=detectExpansionAudio(romBytes,header,mapper,isNES2);
  expansionAudioState={chip:found?.chip||null,enabled:false,confidence:found?.confidence||null};

  if(!found) {
    if(typeof NESAudio!=='undefined' && NESAudio.setExpansion) NESAudio.setExpansion(null,false);
    return expansionAudioState;
  }

  const certain=found.confidence!=='possible';
  const message=certain
    ? `This game supports expansion audio (${found.chip}). Enable?`
    : `This legacy ROM may use expansion audio (${found.chip}), but its old header cannot identify the board exactly. Enable expansion audio?`;

  const enabled=typeof window!=='undefined' && typeof window.confirm==='function'
    ? !!window.confirm(message) : false;

  expansionAudioState.enabled=enabled;

  if(typeof NESAudio!=='undefined' && NESAudio.setExpansion)
    NESAudio.setExpansion(found.chip,enabled);

  return expansionAudioState;
}
