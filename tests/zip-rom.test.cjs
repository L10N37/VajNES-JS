const fs=require('node:fs');
const vm=require('node:vm');
const zlib=require('node:zlib');
const {test}=require('node:test');
const assert=require('node:assert/strict');

function u16(v){const b=Buffer.alloc(2);b.writeUInt16LE(v);return b}
function u32(v){const b=Buffer.alloc(4);b.writeUInt32LE(v>>>0);return b}
function crc32(buf){
 let c=0xffffffff;
 for(const x of buf){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}
 return (c^0xffffffff)>>>0;
}
function makeZip(entries){
 const locals=[],centrals=[];let offset=0;
 for(const e of entries){
  const name=Buffer.from(e.name),raw=Buffer.from(e.data);
  const method=e.method??0;
  const comp=method===8?zlib.deflateRawSync(raw):raw;
  const crc=crc32(raw);
  const local=Buffer.concat([
   u32(0x04034b50),u16(20),u16(0x800),u16(method),u16(0),u16(0),
   u32(crc),u32(comp.length),u32(raw.length),u16(name.length),u16(0),name,comp
  ]);
  const central=Buffer.concat([
   u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(method),u16(0),u16(0),
   u32(crc),u32(comp.length),u32(raw.length),u16(name.length),u16(0),u16(0),
   u16(0),u16(0),u32(0),u32(offset),name
  ]);
  locals.push(local);centrals.push(central);offset+=local.length;
 }
 const cd=Buffer.concat(centrals);
 const eocd=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(entries.length),u16(entries.length),u32(cd.length),u32(offset),u16(0)]);
 return new Uint8Array(Buffer.concat([...locals,cd,eocd]));
}
function fixture(){
 const env={TextDecoder,DataView,Uint8Array,ArrayBuffer,Response,DecompressionStream};
 env.globalThis=env;
 vm.createContext(env);
 vm.runInContext(fs.readFileSync('assets/js/zip-rom.js','utf8'),env);
 return env;
}

test('ZIP reader lists and extracts a stored NES ROM',async()=>{
 const env=fixture(),rom=Buffer.from([0x4e,0x45,0x53,0x1a,1,0,0,0]);
 const zip=makeZip([{name:'Game.nes',data:rom,method:0}]);
 const list=env.listZipNesEntries(zip);
 assert.equal(list.length,1);assert.equal(list[0].name,'Game.nes');
 assert.deepEqual(Array.from(await env.extractZipEntry(zip,list[0])),Array.from(rom));
});

test('ZIP reader extracts normal DEFLATE NES entries',async()=>{
 const env=fixture(),rom=Buffer.alloc(32784,0x5a);rom.set([0x4e,0x45,0x53,0x1a],0);
 const zip=makeZip([{name:'Deflated.nes',data:rom,method:8}]);
 const list=env.listZipNesEntries(zip);
 assert.deepEqual(Array.from(await env.extractZipEntry(zip,list[0])),Array.from(rom));
});

test('ZIP reader ignores non-ROM files and preserves multiple NES choices',()=>{
 const env=fixture(),zip=makeZip([
  {name:'readme.txt',data:'hello'},
  {name:'A.nes',data:Buffer.from([1])},
  {name:'folder/B.NES',data:Buffer.from([2])}
 ]);
 assert.deepEqual(Array.from(env.listZipNesEntries(zip),e=>e.name),['A.nes','folder/B.NES']);
});
