// USB and Bluetooth controllers both arrive through the browser Gamepad API.
// Controllers are deliberately unassigned until the user chooses Player 1 or
// Player 2 from the Controller menu.
const NESGamepads=(()=>{
  const slots=[null,null],states=[0,0];
  let focused=true,lastStatus='',knownIndices=new Set(),lastAssignmentUi='';

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

  function status(text){
    if(text===lastStatus)return;
    const el=document.getElementById('gamepad-status');
    if(el){el.textContent=text;lastStatus=text;}
  }

  function clear(){states.fill(0);}

  function connectedStandardPads(){
    try{
      return Array.from(navigator.getGamepads?.()||[])
        .filter(p=>p?.connected && p.mapping==='standard');
    }catch{
      clear();
      status('Controller access unavailable. Open this emulator on localhost or HTTPS.');
      return null;
    }
  }

  function assignmentFor(index){
    const player=slots.indexOf(index);
    return player<0?null:player;
  }

  function assign(padIndex,player){
    padIndex=Number(padIndex);
    if(player===null || player===undefined || player===-1){
      const old=slots.indexOf(padIndex);
      if(old>=0){slots[old]=null;states[old]=0;}
      update();
      return true;
    }

    player=Number(player);
    if(player!==0 && player!==1)return false;
    const pads=connectedStandardPads();
    if(!pads || !pads.some(p=>p.index===padIndex))return false;

    const oldPlayer=slots.indexOf(padIndex);
    if(oldPlayer>=0 && oldPlayer!==player){
      slots[oldPlayer]=null;
      states[oldPlayer]=0;
    }

    if(slots[player]!==null && slots[player]!==padIndex){
      states[player]=0;
    }
    slots[player]=padIndex;
    update();
    return true;
  }

  function renderAssignments(supported){
    const root=document.getElementById('gamepad-assignments');
    if(!root)return;

    // Do not rebuild clickable controls on every animation frame. Replacing
    // them between pointer-down and pointer-up prevents the browser from ever
    // dispatching a click event.
    const signature=JSON.stringify({
      pads:supported.map(p=>[p.index,p.id]),
      slots
    });
    if(signature===lastAssignmentUi)return;
    lastAssignmentUi=signature;
    root.replaceChildren();

    if(!supported.length){
      const empty=document.createElement('div');
      empty.className='gamepad-empty';
      empty.textContent='No standard controller detected.';
      root.appendChild(empty);
      return;
    }

    for(const pad of supported){
      const row=document.createElement('div');
      row.className='gamepad-assignment';

      const name=document.createElement('div');
      name.className='gamepad-name';
      name.textContent=pad.id || `Controller ${pad.index}`;

      const controls=document.createElement('div');
      controls.className='gamepad-assignment-buttons';

      for(let player=0;player<2;player++){
        const button=document.createElement('button');
        button.type='button';
        button.textContent=`Player ${player+1}`;
        button.className='gamepad-player-btn';
        if(slots[player]===pad.index)button.classList.add('is-assigned');
        button.setAttribute('aria-pressed',slots[player]===pad.index?'true':'false');
        button.addEventListener('click',()=>assign(pad.index,player));
        controls.appendChild(button);
      }

      const unassign=document.createElement('button');
      unassign.type='button';
      unassign.textContent='Unassign';
      unassign.className='gamepad-unassign-btn';
      unassign.disabled=assignmentFor(pad.index)===null;
      unassign.addEventListener('click',()=>assign(pad.index,null));
      controls.appendChild(unassign);

      row.append(name,controls);
      root.appendChild(row);
    }
  }

  function update(){
    if(!focused || document.hidden){clear();return;}

    let pads;
    try{pads=Array.from(navigator.getGamepads?.()||[]).filter(p=>p?.connected);}
    catch{
      clear();
      status('Controller access unavailable. Open this emulator on localhost or HTTPS.');
      return;
    }

    const supported=pads.filter(p=>p.mapping==='standard');

    for(let i=0;i<2;i++){
      if(slots[i]!==null && !supported.some(p=>p.index===slots[i])){
        slots[i]=null;
        states[i]=0;
      }
    }

    const currentIndices=new Set(supported.map(p=>p.index));
    const newlyConnected=supported.some(p=>!knownIndices.has(p.index));
    knownIndices=currentIndices;

    for(let i=0;i<2;i++){
      const pad=supported.find(p=>p.index===slots[i]);
      const next=pad?decode(pad):0;
      if(next && !states[i] && typeof NESAudio!=='undefined')NESAudio.unlock();
      states[i]=next;
    }

    renderAssignments(supported);

    const names=slots.map((index,i)=>{
      const pad=supported.find(p=>p.index===index);
      return pad?`P${i+1}: ${pad.id}`:null;
    }).filter(Boolean);
    const unassigned=supported.filter(p=>!slots.includes(p.index));

    if(names.length){
      status(names.join(' · ')+(unassigned.length?` · ${unassigned.length} awaiting assignment`:''));
    }else if(supported.length){
      status('Controller detected. Choose Player 1 or Player 2 below.');
    }else if(pads.length){
      status('Controller detected without a standard mapping. Try another browser or USB connection.');
    }else{
      status('No controller detected. Pair in system Bluetooth settings, then press a button.');
    }

    if(newlyConnected){
      const menu=document.querySelector?.('.gamepad-menu');
      if(menu)menu.open=true;
    }
  }

  window.addEventListener('gamepadconnected',update);
  window.addEventListener('gamepaddisconnected',event=>{
    const i=slots.indexOf(event.gamepad.index);
    if(i>=0){slots[i]=null;states[i]=0;}
    knownIndices.delete(event.gamepad.index);
    update();
  });
  window.addEventListener('blur',()=>{focused=false;clear();});
  window.addEventListener('focus',()=>{focused=true;update();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else update();});

  function tick(){update();requestAnimationFrame(tick);}
  requestAnimationFrame(tick);

  return {
    read:player=>states[player]||0,
    update,
    assign,
    assignment:padIndex=>assignmentFor(Number(padIndex)),
    slots:()=>slots.slice()
  };
})();
