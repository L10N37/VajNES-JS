// USB and Bluetooth controllers both arrive through the browser Gamepad API.
// Cache once per animation frame, never query the browser on CPU bus cycles.
const NESGamepads=(()=>{
  const slots=[null,null],states=[0,0];let focused=true,lastStatus='';
  function decode(pad){
    const down=i=>!!pad.buttons[i]?.pressed || pad.buttons[i]?.value>0.5;
    let bits=(down(0)||down(3)?1:0)|(down(1)||down(2)?2:0)|
      (down(8)?4:0)|(down(9)?8:0);
    const x=pad.axes[0]||0,y=pad.axes[1]||0,deadzone=0.35;
    if(down(12)||y < -deadzone)bits|=16;
    if(down(13)||y > deadzone)bits|=32;
    if(down(14)||x < -deadzone)bits|=64;
    if(down(15)||x > deadzone)bits|=128;
    if((bits&48)===48)bits&=~48;
    if((bits&192)===192)bits&=~192;
    return bits;
  }
  function status(text){if(text===lastStatus)return;const el=document.getElementById('gamepad-status');if(el){el.textContent=text;lastStatus=text;}}
  function clear(){states.fill(0);}
  function update(){
    if(!focused || document.hidden){clear();return;}
    let pads;
    try{pads=Array.from(navigator.getGamepads?.()||[]).filter(p=>p?.connected);}
    catch{clear();status('Controller access unavailable. Open this emulator on localhost or HTTPS.');return;}
    const supported=pads.filter(p=>p.mapping==='standard');
    for(let i=0;i<2;i++)if(slots[i]!==null&&!supported.some(p=>p.index===slots[i])){slots[i]=null;states[i]=0;}
    for(const pad of supported)if(!slots.includes(pad.index)){const slot=slots.indexOf(null);if(slot>=0)slots[slot]=pad.index;}
    for(let i=0;i<2;i++){const pad=supported.find(p=>p.index===slots[i]);const next=pad?decode(pad):0;
      if(next && !states[i] && typeof NESAudio!=='undefined')NESAudio.unlock();
      states[i]=next;
    }
    const names=slots.map((index,i)=>{const pad=supported.find(p=>p.index===index);return pad?`P${i+1}: ${pad.id}`:null;}).filter(Boolean);
    status(names.length?names.join(' · '):pads.length?'Controller detected without a standard mapping. Try another browser or USB connection.':'No controller detected. Pair in system Bluetooth settings, then press a button.');
  }
  window.addEventListener('gamepadconnected',update);
  window.addEventListener('gamepaddisconnected',event=>{const i=slots.indexOf(event.gamepad.index);if(i>=0){slots[i]=null;states[i]=0;}update();});
  window.addEventListener('blur',()=>{focused=false;clear();});
  window.addEventListener('focus',()=>{focused=true;update();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else update();});
  function tick(){update();requestAnimationFrame(tick);}
  requestAnimationFrame(tick);
  return {read:player=>states[player]||0,update};
})();
