// Minimal browser ZIP reader for NES ROM archives.
// Supports standard stored (method 0) and DEFLATE (method 8) entries.

function zipU16(v,o){return v.getUint16(o,true);}
function zipU32(v,o){return v.getUint32(o,true);}

function zipFindEocd(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const min=Math.max(0,bytes.length-0x10000-22);
  for(let i=bytes.length-22;i>=min;i--){
    if(zipU32(view,i)===0x06054b50)return i;
  }
  throw new Error('Invalid ZIP: end-of-central-directory not found');
}

function zipDecodeName(bytes,utf8){
  if(utf8)return new TextDecoder('utf-8').decode(bytes);
  // CP437 is rare in modern ROM sets; latin1 preserves common ASCII names.
  return new TextDecoder('latin1').decode(bytes);
}

function listZipNesEntries(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const eocd=zipFindEocd(bytes);
  const count=zipU16(view,eocd+10);
  const cdOffset=zipU32(view,eocd+16);
  let p=cdOffset;
  const out=[];
  for(let i=0;i<count;i++){
    if(zipU32(view,p)!==0x02014b50)throw new Error('Invalid ZIP central directory');
    const flags=zipU16(view,p+8),method=zipU16(view,p+10);
    const crc=zipU32(view,p+16),compressedSize=zipU32(view,p+20),size=zipU32(view,p+24);
    const nameLen=zipU16(view,p+28),extraLen=zipU16(view,p+30),commentLen=zipU16(view,p+32);
    const localOffset=zipU32(view,p+42);
    const name=zipDecodeName(bytes.subarray(p+46,p+46+nameLen),!!(flags&0x800));
    if(name.toLowerCase().endsWith('.nes')&&!name.endsWith('/')){
      out.push({name,flags,method,crc,compressedSize,size,localOffset});
    }
    p+=46+nameLen+extraLen+commentLen;
  }
  if(!out.length)throw new Error('ZIP does not contain a .nes ROM');
  return out;
}

async function inflateZipRaw(data){
  if(typeof DecompressionStream==='undefined')
    throw new Error('This browser does not support ZIP decompression');
  let stream;
  try{stream=new DecompressionStream('deflate-raw');}
  catch{throw new Error('This browser does not support raw DEFLATE ZIP entries');}
  const writer=stream.writable.getWriter();
  writer.write(data);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function extractZipEntry(bytes,entry){
  if(entry.flags&1)throw new Error('Encrypted ZIP entries are not supported');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const p=entry.localOffset;
  if(zipU32(view,p)!==0x04034b50)throw new Error('Invalid ZIP local header');
  const nameLen=zipU16(view,p+26),extraLen=zipU16(view,p+28);
  const start=p+30+nameLen+extraLen;
  const compressed=bytes.subarray(start,start+entry.compressedSize);
  let out;
  if(entry.method===0)out=compressed.slice();
  else if(entry.method===8)out=await inflateZipRaw(compressed);
  else throw new Error(`Unsupported ZIP compression method ${entry.method}`);
  if(out.length!==entry.size)throw new Error('ZIP entry size mismatch');
  return out;
}

function chooseZipNesEntry(entries){
  if(entries.length===1)return Promise.resolve(entries[0]);
  if(typeof document==='undefined'||!document.body)return Promise.resolve(entries[0]);
  return new Promise(resolve=>{
    document.getElementById('zip-rom-picker')?.remove?.();
    const overlay=document.createElement('div');
    overlay.id='zip-rom-picker';overlay.className='zip-rom-picker';
    const card=document.createElement('div');card.className='zip-rom-card';
    const title=document.createElement('h2');title.textContent='Choose ROM';
    const select=document.createElement('select');select.className='zip-rom-select';
    entries.forEach((entry,i)=>{
      const option=document.createElement('option');option.value=String(i);option.textContent=entry.name;select.append(option);
    });
    const actions=document.createElement('div');actions.className='zip-rom-actions';
    const load=document.createElement('button');load.type='button';load.textContent='Load';load.className='zip-rom-button';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.className='zip-rom-button';
    const finish=value=>{overlay.remove();resolve(value);};
    load.addEventListener('click',()=>finish(entries[Number(select.value)||0]));
    cancel.addEventListener('click',()=>finish(null));
    overlay.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();finish(null);}});
    actions.append(load,cancel);card.append(title,select,actions);overlay.append(card);document.body.append(overlay);select.focus();
  });
}

async function extractNesFromZip(bytes){
  const entries=listZipNesEntries(bytes);
  const chosen=await chooseZipNesEntry(entries);
  if(!chosen)return null;
  return {name:chosen.name,bytes:await extractZipEntry(bytes,chosen)};
}
