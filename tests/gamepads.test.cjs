const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 let pads=[];
 const events={},docEvents={},label={textContent:''},menu={open:false},closeEvents={};
 const cloud={game:{key:'TEST'},saves:0,loads:0,quickSave(){this.saves++;return Promise.resolve(true)},quickLoad(){this.loads++;return Promise.resolve(true)}};
 const closeButton={addEventListener:(k,v)=>closeEvents[k]=v};
 const env=vm.createContext({
   window:{addEventListener:(k,v)=>events[k]=v,VajNESCloudSaves:cloud},
   document:{
     hidden:false,
     getElementById:id=>id==='gamepad-status'?label:id==='gamepad-close'?closeButton:null,
     querySelector:sel=>sel==='.gamepad-menu'?menu:null,
     addEventListener:(k,v)=>docEvents[k]=v
   },
   navigator:{getGamepads:()=>pads},
   requestAnimationFrame:()=>{}
 });
 vm.runInContext(fs.readFileSync('assets/js/gamepads.js','utf8')+';globalThis.input=NESGamepads',env);
 return {env,events,docEvents,label,menu,closeEvents,cloud,input:env.input,setPads:p=>pads=p};
}
function pad(index=0,buttons=[],axes=[0,0]){
 return {index,id:'Xbox '+index,connected:true,mapping:'standard',axes,
   buttons:Array.from({length:17},(_,i)=>({pressed:buttons.includes(i),value:buttons.includes(i)?1:0}))};
}
test('connected controllers do not drive NES input until assigned',()=>{
 const f=fixture();f.setPads([pad(0,[0])]);f.input.update();
 assert.equal(f.input.read(0),0);assert.equal(f.input.read(1),0);
 assert.match(f.label.textContent,/Choose Player 1 or Player 2/);
});
test('Xbox buttons, menu/view and diagonals map to assigned NES player',()=>{
 const f=fixture();f.setPads([pad(0,[0,8,9,12,15])]);f.input.update();assert.equal(f.input.assign(0,0),true);
 assert.equal(f.input.read(0),1|4|8|16|128);
 f.setPads([pad(0,[1,2,3])]);f.input.update();assert.equal(f.input.read(0),3);
});
test('stick deadzone rejects drift and contradictory directions are neutral',()=>{
 const f=fixture();f.setPads([pad(0,[],[0.3,-0.2])]);f.input.update();f.input.assign(0,0);assert.equal(f.input.read(0),0);
 f.setPads([pad(0,[],[-0.8,0.8])]);f.input.update();assert.equal(f.input.read(0),64|32);
 f.setPads([pad(0,[12,13,14,15])]);f.input.update();assert.equal(f.input.read(0),0);
});
test('controllers can be assigned, reassigned and unassigned between players',()=>{
 const f=fixture();f.setPads([pad(1,[0]),pad(3,[1])]);f.input.update();
 f.input.assign(1,0);f.input.assign(3,1);
 assert.equal(f.input.read(0),1);assert.equal(f.input.read(1),2);
 f.input.assign(1,1);
 assert.equal(f.input.assignment(1),1);assert.equal(f.input.assignment(3),null);
 assert.equal(f.input.read(0),0);assert.equal(f.input.read(1),1);
 f.input.assign(1,null);assert.deepEqual(Array.from(f.input.slots()),[null,null]);
 assert.equal(f.input.read(1),0);
});
test('disconnect releases the assigned player without moving another controller',()=>{
 const f=fixture();f.setPads([pad(1,[0]),pad(3,[1])]);f.input.update();f.input.assign(1,0);f.input.assign(3,1);
 f.setPads([pad(3,[1])]);f.input.update();
 assert.equal(f.input.read(0),0);assert.equal(f.input.read(1),2);
 assert.deepEqual(Array.from(f.input.slots()),[null,3]);
});
test('blur, hidden tabs and API denial release held controller inputs',()=>{
 const f=fixture();f.setPads([pad(0,[0])]);f.input.update();f.input.assign(0,0);
 f.events.blur();assert.equal(f.input.read(0),0);f.input.update();assert.equal(f.input.read(0),0);
 f.events.focus();assert.equal(f.input.read(0),1);
 f.env.document.hidden=true;f.docEvents.visibilitychange();assert.equal(f.input.read(0),0);
 f.env.document.hidden=false;f.env.navigator.getGamepads=()=>{throw Error('blocked')};f.input.update();
 assert.equal(f.input.read(0),0);assert.match(f.label.textContent,/unavailable/);
});
test('unmapped controllers are reported without assuming button numbers',()=>{
 const f=fixture();f.setPads([{...pad(0,[0]),mapping:''}]);f.input.update();
 assert.equal(f.input.read(0),0);assert.match(f.label.textContent,/without a standard mapping/);
});

test('new controller auto-opens the Controller menu and internal Close button closes it',()=>{
 const f=fixture();
 f.setPads([pad(0,[0])]);
 f.input.update();
 assert.equal(f.menu.open,true);
 assert.equal(typeof f.closeEvents.click,'function');
 f.closeEvents.click();
 assert.equal(f.menu.open,false);
});

test('retired scanline developer test controls are not exposed in the UI',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.equal(html.includes('test-rgba-checkbox'),false);
 assert.equal(html.includes('test-index-checkbox'),false);
 assert.equal(html.includes('test-image-checkbox'),false);
 assert.equal(html.includes('Run testRGBAAnim()'),false);
 assert.equal(html.includes('Run testIndexAnim()'),false);
 assert.equal(html.includes('Show Test Image'),false);
});


test('Player 1 LB and RB trigger cloud quick save/load once per press',async()=>{
 const f=fixture();
 f.setPads([pad(0)]);f.input.update();f.input.assign(0,0);

 f.setPads([pad(0,[4])]);f.input.update();
 f.input.update();
 await Promise.resolve();
 assert.equal(f.cloud.saves,1);

 f.setPads([pad(0)]);f.input.update();
 f.setPads([pad(0,[4])]);f.input.update();
 await Promise.resolve();
 assert.equal(f.cloud.saves,2);

 f.setPads([pad(0)]);f.input.update();
 f.setPads([pad(0,[5])]);f.input.update();
 f.input.update();
 await Promise.resolve();
 assert.equal(f.cloud.loads,1);
});

test('Player 2 triggers do not operate cloud save shortcuts',async()=>{
 const f=fixture();
 f.setPads([pad(0)]);f.input.update();f.input.assign(0,1);
 f.setPads([pad(0,[4,5])]);f.input.update();
 await Promise.resolve();
 assert.equal(f.cloud.saves,0);
 assert.equal(f.cloud.loads,0);
});


