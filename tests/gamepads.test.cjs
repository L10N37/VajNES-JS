const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture(){
 let pads=[];
 const events={},docEvents={},label={textContent:''};
 const env=vm.createContext({
   window:{addEventListener:(k,v)=>events[k]=v},
   document:{
     hidden:false,
     getElementById:id=>id==='gamepad-status'?label:null,
     querySelector:()=>null,
     addEventListener:(k,v)=>docEvents[k]=v
   },
   navigator:{getGamepads:()=>pads},
   requestAnimationFrame:()=>{}
 });
 vm.runInContext(fs.readFileSync('assets/js/gamepads.js','utf8')+';globalThis.input=NESGamepads',env);
 return {env,events,docEvents,label,input:env.input,setPads:p=>pads=p};
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

test('detecting a controller never auto-opens the Controller menu',()=>{
 const menu={open:false};
 const f=fixture();
 f.env.document.querySelector=sel=>sel==='.gamepad-menu'?menu:null;
 f.setPads([pad(0,[0])]);
 f.input.update();
 assert.equal(menu.open,false);
});
