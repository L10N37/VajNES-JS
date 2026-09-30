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

function setExpansionAudioChoice(found, enabled) {
  expansionAudioState={
    chip:found?.chip||null,
    enabled:!!enabled && !!found,
    confidence:found?.confidence||null
  };
  if(typeof NESAudio!=='undefined' && NESAudio.setExpansion)
    NESAudio.setExpansion(found?.chip||null, expansionAudioState.enabled);
}

function showExpansionAudioPrompt(found) {
  const certain=found.confidence!=='possible';
  const message=certain
    ? `This game supports expansion audio (${found.chip}). Enable it?`
    : `This legacy ROM may use expansion audio (${found.chip}), but its old header cannot identify the board exactly. Enable it?`;

  // Headless/test fallback. Browsers get the explicit Yes / No VajNES dialog.
  if(typeof document==='undefined' || !document.body || typeof document.createElement!=='function') {
    const enabled=typeof window!=='undefined' && typeof window.confirm==='function'
      ? !!window.confirm(message) : false;
    setExpansionAudioChoice(found,enabled);
    return;
  }

  document.getElementById('expansion-audio-prompt')?.remove?.();

  const overlay=document.createElement('div');
  overlay.id='expansion-audio-prompt';
  overlay.className='expansion-audio-prompt';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','expansion-audio-title');

  const card=document.createElement('div');
  card.className='expansion-audio-card';

  const title=document.createElement('h2');
  title.id='expansion-audio-title';
  title.textContent='Expansion Audio';

  const text=document.createElement('p');
  text.textContent=message;

  const actions=document.createElement('div');
  actions.className='expansion-audio-actions';

  const yes=document.createElement('button');
  yes.type='button';
  yes.className='expansion-audio-button';
  yes.textContent='Yes';

  const no=document.createElement('button');
  no.type='button';
  no.className='expansion-audio-button';
  no.textContent='No';

  const choose=enabled=>{
    setExpansionAudioChoice(found,enabled);
    overlay.remove();
  };

  yes.addEventListener('click',()=>choose(true));
  no.addEventListener('click',()=>choose(false));
  overlay.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();choose(false);}
  });

  actions.append(yes,no);
  card.append(title,text,actions);
  overlay.append(card);
  document.body.append(overlay);
  yes.focus();
}

function expansionAudioPromptOpen() {
  if(typeof document==='undefined') return false;
  const prompt=document.getElementById?.('expansion-audio-prompt');
  return !!prompt && prompt.id==='expansion-audio-prompt';
}

function configureExpansionAudioForRom(romBytes,header,mapper,isNES2) {
  const found=detectExpansionAudio(romBytes,header,mapper,isNES2);
  expansionAudioState={chip:found?.chip||null,enabled:false,confidence:found?.confidence||null};

  if(!found) {
    document?.getElementById?.('expansion-audio-prompt')?.remove?.();
    if(typeof NESAudio!=='undefined' && NESAudio.setExpansion) NESAudio.setExpansion(null,false);
    return expansionAudioState;
  }

  // Start disabled until the player explicitly chooses Yes.
  setExpansionAudioChoice(found,false);
  showExpansionAudioPrompt(found);
  return expansionAudioState;
}
