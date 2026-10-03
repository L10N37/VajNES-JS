// VajNES Game Genie support.
// NES Game Genie patches the cartridge ROM data bus after mapper translation.
// 6-character codes always substitute; 8-character codes substitute only when
// the mapped ROM byte matches the decoded compare value.
const VajNESGenie=(()=>{
  const alphabet='APZLGITYEOXUKSVN';
  const nibble=Object.fromEntries([...alphabet].map((c,i)=>[c,i]));

  const games=[
    {
      title:'Alien Syndrome (USA)', aliases:['Alien Syndrome (USA) (Unl)','Alien Syndrome (U)'],
      fullCrcs:[0x711347EA], payloadCrcs:[0xCBF4366F],
      cheats:[
        ['Infinite Time','SZUNYXVK'],['Set Timer To 440','GUONPPLL'],
        ['Both Players (1 Life)','PAOGPIGA'],['Both Players (8 Lives)','AAOGPIGE'],
        ['Start With Flame Thrower','PAVKGIAA'],['Start With Fireball','ZAVKGIAA'],
        ['Start With Laser','LAVKGIAA'],["Don't Lose Life When Shot Or Touched",'AEEKXONY'],
        ["Don't Lose Life From Falling Down Holes",'AANGVXNY'],['1 Life After Continue','PEXGGLGA'],
        ['8 Lives After Continue','AEXGGLGE'],['Start On Round 2','PENNELAP+KUNNXLAA+LENNULAZ'],
        ['Start On Round 3','ZENNELAP+KUNNXLAA+LENNULAZ'],['Start On Round 4','LENNELAP+KUNNXLAA+LENNULAZ'],
        ['Start On Round 5','GENNELAP+KUNNXLAA+LENNULAZ'],['Start On Round 6','IENNELAP+KUNNXLAA+LENNULAZ'],
        ['Start On Round 7','TENNELAP+KUNNXLAA+LENNULAZ']
      ]
    },
    {
      title:'Super Mario Bros. 3 (USA)', aliases:['Super Mario Bros. 3 (U)','Super Mario Bros. 3'],
      fullCrcs:[0x661019C6,0xE8C3AF69], payloadCrcs:[],
      cheats:[
        ['Infinite Lives Mario and Luigi','SLXPLOVS'],['Power Jumps','ELKZYVEK'],
        ['Super Power Jumps','EZKZYVEK'],['Mega Power Jumps','EAKZYVEK'],
        ['Multi-Jumps','GZUXNGEI'],['Super Speed Running','OXKZELSX'],
        ['Start and stay as Super Mario','XUKXGLIE'],['Start and stay as Fire Mario','UXKXGLIA'],
        ['Start and stay as Racoon Mario (& Luigi)','NXKXGLIE'],['Start and stay as Frog Mario','OUKXGLIE'],
        ['Start and stay as Sledgehammer Mario','XNKXGLIE'],['Start on World 2','PEUZUGAA'],
        ['Start on World 3','ZEUZUGAA'],['Start on World 4','LEUZUGAA'],['Start on World 5','GEUZUGAA'],
        ['Start on World 6','IEUZUGAA'],['Start on World 7','TEUZUGAA'],['Start on World 8','YEUZUGAA'],
        ['Mario can reuse items','YPXXLVGE']
      ]
    },
    {
      title:'The Legend of Zelda (USA)', aliases:['Legend of Zelda, The (USA)','Legend of Zelda, The','The Legend of Zelda'],
      fullCrcs:[0x316CFF69,0xE47960E0], payloadCrcs:[],
      cheats:[
        ["Don't Take Damage From Anything",'AVVLAUSZ'],['Create Character With 8 Life Hearts','YYKPOYZZ'],
        ['Create Character With 16 Life Hearts','NYKPOYZX'],["Don't Lose Rubies When Buying",'SZVXASVK'],
        ['Infinite Bombs','SZNZVOVK'],['Wear A Blue Ring','ESKUILTA'],['Wear A Red Ring','OSKUILTA'],
        ['All Items For Free','SZVXASVK+AEVEVALG'],['All Items Are Free','XPZAYV'],
        ["Some Enemies Can't Move",'SXPAPO'],['Fewer Monsters','AEOANAEG'],['No Zolas','AEVATVAA'],
        ['No Darkened Rooms','AOEUYTEY'],['Blue Ring Costs 2 Rupies','ZAVEIVXY'],
        ['Play Zelda In Black And White','YOXTGKTO'],['Enemy Attacks Do Not Disable Sword','SPVEGGSA'],
        ['Remote Control Bombs','KOVVOIKA+EEVTOIAY'],['Sword Beam Does Not Stop After Hitting Enemies','ESSYGLSL'],
        ['Faster Text Scrolling','OPPEEA'],['Always Able To Shoot Sword Beams','AANYSEVI+AANNKANI'],
        ['Reveal Bombable Walls','SZYZNO']
      ]
    },
    {
      title:'Metroid (USA)', aliases:['Metroid (U)','Metroid'],
      fullCrcs:[0xD1A02CAB], payloadCrcs:[],
      cheats:[
        ['Minimum Energy Of 30','SXSGNVSE'],['Infinite Rockets On Pick-Up','SZUILUVK'],
        ['Gain 10 Rockets On Pick-Up','ZENSXLIE'],['Gain 15 Rockets On Pick-Up','YENSXLIE'],
        ['255 Rockets On Pick-Up','NNNSXLIE'],['Start With Over 1,600 On Life','NYXGVPLE'],
        ['Extra Energy','YAXGVPLA'],['Start With All Items And You Are Invincible','ALLGKP'],
        ['Infinite Life','YAYGNP']
      ]
    },
    {
      title:'Contra (USA)', aliases:['Contra (U)','Contra'],
      fullCrcs:[0x52CD5CD8], payloadCrcs:[],
      cheats:[
        ['Infinite Lives','SLAIUZ'],['Keep Weapons After Losing Life','GXIIUX'],
        ['Enemies Will Ignore You','SLTIYG'],['Get Machine Gun After Dying','PEIIXZ'],
        ['Get Fire Gun After Dying','ZEIIXZ'],['Get Spread Gun After Dying','LEIIXZ']
      ]
    },
    {
      title:'Mega Man 2 (USA)', aliases:['Mega Man 2 (U)','Mega Man 2'],
      fullCrcs:[0x80E08660], payloadCrcs:[],
      cheats:[
        ['Infinite Lives','SXUGTPVG'],['Infinite Energy','SXXTPSSE'],['Start With Half Energy','TEKAIEGO'],
        ['Start With 1 Life','PANALALA'],['Start With 6 Lives','TANALALA'],['Start With 9 Lives','PANALALE'],
        ['Burst-Fire Normal Weapon','LZVSSZYZ'],['Power Jumps','TANAOZGA'],['Super Power Jumps','AANAOZGE'],
        ['Mega Power Jumps','APNAOZGA'],['Maximum Weapon Energy On Pick-Up','GZKEYLAL'],['Moonwalking','PGEAKOPX']
      ]
    },
    {
      title:'Castlevania (USA)', aliases:['Castlevania (U)','Castlevania'],
      fullCrcs:[0xAE0FA667,0x12A6CB14], payloadCrcs:[],
      cheats:[
        ['Infinite Lives','OXNGLZVK'],['Start With 40 Power Hearts','AXOGOPIE'],['Start With 80 Power Hearts','ASOGOPIA'],
        ['Infinite Time','SXXXYAAX'],['Keep Weapons After Losing A Life','GZOGYUSE'],
        ['Gain Rapid Fire Shots On Weapon Pick-Up','ZEUTAYAA'],["Weapons Don't Use Power Hearts",'KZSSEZKA+KXESUZKA'],
        ['Start With 1 Life','PANKXPGA+PANGSAGA'],['Start With 8 Lives','AANKXPGE+AANGSAGE'],
        ['Infinite Health','SZSVLYSE'],['Continue With Whip Power-Ups','SXVZYPSA'],['Start With 99 Hearts','LVOGOPIA'],
        ['Simon Jumps 1.5 Times Higher','ENPPEL'],['Simon Jumps Twice As High','EVPPEL'],
        ['Invincible After One Hit','VXNVXAVG'],['Enemies Always Drop An Item','AEUVGAZA'],
        ['Start And Continue With 99 Hearts','LTKGXPIA'],['Hidden Items Can Reappear','SZEZANSE']
      ]
    },
    {
      title:"Kirby's Adventure (USA)", aliases:["Kirby's Adventure (U)","Kirby's Adventure"],
      fullCrcs:[0x4F20B058,0xC68F0885], payloadCrcs:[],
      cheats:[
        ['Start With 2 Lives','PEVXIYGA'],['Start With 9 Lives','AEVXIYGE'],['Start With 17 Lives','AOVXIYGA'],
        ["Less Energy From 'Pep Drinks'",'ZAKLLXAA'],["More Energy From 'Pep Drinks'",'APKLLXAA'],
        ["Full Energy From 'Pep Drinks'",'YZKLLXAE'],['Start With Less Energy','YONZZNYX'],
        ['Start With More Energy','YKNZZNYX'],['Infinite Energy','SZEPSVSE'],
        ['No Enemies In Stages','VVYVEP'],['Transparent','KEPSSX'],['Kirby And Foes Are See-Through','KEPSOX']
      ]
    },
    {
      title:"Mike Tyson's Punch-Out!!", aliases:["Mike Tyson's Punch-Out!! (USA)","Mike Tyson's Punch-Out!! (U)","Mike Tyson's Punch-Out!!"],
      fullCrcs:[0x12F19390,0xACD20BD8], payloadCrcs:[],
      cheats:[
        ['Infinite Health','ATEALIXZ'],['Refill Stamina Between Rounds','KVKAAGLA'],['Never Lose Hearts','GZKETGST'],
        ['Never Lose Stars','ALNEVPEY'],['Take Less Damage','SZVAAOIV'],['Take Even Less Damage','SZVALPAX'],
        ['Energy Replenishment','AGUELIGA'],['No Energy Replenishment For Opponent','SZSELPAX'],
        ['Normal Punches Do More Damage','AAVETLGA'],['Stunned Punches Do Less Damage','STNAPUIV'],
        ['Start Each Round With 3 Stars','LASAEPAA'],['Stop Timer','XXXELNVA+SUSETNSO']
      ]
    },
    {
      title:'Battletoads (USA)', aliases:['Battletoads (U)','Battletoads'],
      fullCrcs:[0xCFFF05A1], payloadCrcs:[],
      cheats:[
        ['1 Life','PENVZILA'],['6 Lives','TENVZILA'],['9 Lives','PENVZILE'],['Infinite Lives','GXXZZLVI'],
        ['Enemies Easier To Kill','GXEILUSO'],['Mega-Jumping','EYSAUVEI'],['Super Fast Punching','AEUZITPA'],
        ['Start On Level 2 (Wookie Hole)','ZAXAALAA'],['Start On Level 3 (Turbo Tunnel)','LAXAALAA'],
        ['Start On Level 4 (Arctic Cavern)','GAXAALAA'],['Start On Level 5 (Surf City)','IAXAALAA'],
        ["Start On Level 6 (Karnath's Lair)",'TAXAALAA'],["Start On Level 7 (Volkmire's Inferno)",'YAXAALAA'],
        ['Start On Level 8 (Intruder Excluder)','AAXAALAE'],['Start On Level 9 (Terra Tubes)','PAXAALAE'],
        ['Start On Level 10 (Rat Race)','ZAXAALAE'],['Start On Level 11 (Clinger Winger)','LAXAALAE'],
        ['Start On Level 12 (The Revolution)','GAXAALAE'],['Start On Level 13 (Armageddon)','IAXAALAE'],
        ["Start In Dark Queen's Tower",'PYXAALAE'],['Double Energy From Flies','AOUKXNAA'],
        ['Maximum Energy From Flies','YXUKXNAE']
      ]
    }
  ];

  let current={title:'No ROM loaded',fullCrc:0,payloadCrc:0,mapper:null,game:null};
  let enabled=new Map();
  let manual=[];
  let active=[];

  function cleanCode(code){
    return String(code||'').toUpperCase().replace(/[\s-]/g,'');
  }

  function decode(code){
    const c=cleanCode(code);
    if(c.length!==6 && c.length!==8)throw new Error('Game Genie code must be 6 or 8 letters');
    const n=[...c].map(ch=>{
      const v=nibble[ch];
      if(v===undefined)throw new Error('Game Genie letters must use APZLGITYEOXUKSVN');
      return v;
    });
    const address=0x8000 |
      ((n[3]&7)<<12) |
      ((n[5]&7)<<8) | ((n[4]&8)<<8) |
      ((n[2]&7)<<4) | ((n[1]&8)<<4) |
      (n[4]&7) | (n[3]&8);
    const data=c.length===6
      ? (((n[1]&7)<<4)|((n[0]&8)<<4)|(n[0]&7)|(n[5]&8))
      : (((n[1]&7)<<4)|((n[0]&8)<<4)|(n[0]&7)|(n[7]&8));
    const compare=c.length===8
      ? (((n[7]&7)<<4)|((n[6]&8)<<4)|(n[6]&7)|(n[5]&8))
      : null;
    return {code:c,address:address&0xffff,data:data&0xff,compare};
  }

  function decodeChain(code){
    return String(code||'').split('+').map(x=>x.trim()).filter(Boolean).map(decode);
  }

  function normalName(name){
    return String(name||'')
      .replace(/^.*[\\/]/,'').replace(/\.nes$/i,'')
      .replace(/\s*\[[^\]]*\]\s*/g,' ')
      .replace(/\s+/g,' ').trim().toLowerCase();
  }

  function identify(fullCrc,payloadCrc,fileName){
    const full=fullCrc>>>0,payload=payloadCrc>>>0,n=normalName(fileName);
    return games.find(g=>
      (g.fullCrcs||[]).some(x=>(x>>>0)===full) ||
      (g.payloadCrcs||[]).some(x=>(x>>>0)===payload)
    ) || games.find(g=>
      n && [g.title,...(g.aliases||[])].some(a=>normalName(a)===n)
    ) || null;
  }

  function rebuildActive(){
    const out=[];
    if(current.game){
      current.game.cheats.forEach((entry,i)=>{
        if(!enabled.get(i))return;
        try{out.push(...decodeChain(entry[1]));}catch{}
      });
    }
    for(const item of manual){
      if(!item.enabled)continue;
      try{out.push(...decodeChain(item.code));}catch{}
    }
    active=out;
    updateButton();
  }

  function patchRomRead(address,value){
    if(!active.length || address<0x8000)return value&0xff;
    const original=value&0xff;
    let out=original;
    for(const p of active){
      if(p.address!==(address&0xffff))continue;
      if(p.compare!==null && p.compare!==original)continue;
      out=p.data;
    }
    return out&0xff;
  }

  function crcText(v){return (v>>>0).toString(16).toUpperCase().padStart(8,'0');}

  function updateButton(){
    const b=document.getElementById?.('genieButton');
    if(!b)return;
    b.disabled=current.mapper===null;
    const count=active.length;
    b.textContent=count?('Genie ('+count+')'):'Genie';
  }

  function onRomLoaded(info){
    enabled=new Map();
    manual=[];
    active=[];
    const game=identify(info.fullCrc,info.payloadCrc,info.fileName);
    current={
      title:game?.title || (info.fileName?String(info.fileName).replace(/^.*[\\/]/,'').replace(/\.nes$/i,''):'Unknown ROM'),
      fullCrc:info.fullCrc>>>0,
      payloadCrc:info.payloadCrc>>>0,
      mapper:info.mapper,
      game
    };
    updateButton();
    render();
  }

  function setBuiltIn(index,on){
    if(!current.game)return;
    enabled.set(Number(index),!!on);
    rebuildActive();
  }

  function addManual(code,description='Manual Game Genie code'){
    const cleaned=String(code||'').trim().toUpperCase();
    decodeChain(cleaned);
    manual.push({description:String(description||'Manual Game Genie code'),code:cleaned,enabled:true});
    rebuildActive();
    render();
    return true;
  }

  function removeManual(index){
    manual.splice(Number(index),1);
    rebuildActive();
    render();
  }

  function disableAll(){
    enabled.clear();
    for(const m of manual)m.enabled=false;
    rebuildActive();
    render();
  }

  function render(){
    const title=document.getElementById?.('genie-game-title');
    const meta=document.getElementById?.('genie-game-meta');
    const list=document.getElementById?.('genie-cheat-list');
    const empty=document.getElementById?.('genie-empty');
    if(title)title.textContent=current.title;
    if(meta)meta.textContent=current.mapper===null
      ? 'Load a ROM to identify it and view cheats.'
      : ('Mapper '+current.mapper+' · ROM CRC '+crcText(current.fullCrc)+' · payload CRC '+crcText(current.payloadCrc));
    if(!list)return;
    list.replaceChildren();

    const cheats=current.game?.cheats||[];
    if(empty){
      empty.style.display=cheats.length?'none':'block';
      empty.textContent=current.mapper===null
        ? 'No ROM loaded.'
        : 'No built-in cheat set is indexed for this exact game yet. Manual Game Genie codes still work.';
    }

    cheats.forEach((entry,i)=>{
      const row=document.createElement('label');
      row.className='genie-cheat-row';
      const box=document.createElement('input');box.type='checkbox';box.checked=!!enabled.get(i);
      box.addEventListener('change',()=>setBuiltIn(i,box.checked));
      const body=document.createElement('span');
      const name=document.createElement('strong');name.textContent=entry[0];
      const code=document.createElement('code');code.textContent=entry[1];
      body.append(name,code);row.append(box,body);list.append(row);
    });

    manual.forEach((item,i)=>{
      const row=document.createElement('div');row.className='genie-cheat-row genie-manual-row';
      const box=document.createElement('input');box.type='checkbox';box.checked=!!item.enabled;
      box.addEventListener('change',()=>{item.enabled=box.checked;rebuildActive();});
      const body=document.createElement('span');
      const name=document.createElement('strong');name.textContent=item.description;
      const code=document.createElement('code');code.textContent=item.code;
      const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.className='genie-small-button';
      remove.addEventListener('click',()=>removeManual(i));
      body.append(name,code);row.append(box,body,remove);list.append(row);
    });
  }

  function bindUi(){
    const add=document.getElementById?.('genie-add');
    const input=document.getElementById?.('genie-code-input');
    const error=document.getElementById?.('genie-code-error');
    add?.addEventListener('click',()=>{
      try{
        const value=input?.value||'';
        addManual(value);
        if(input)input.value='';
        if(error)error.textContent='';
      }catch(e){
        if(error)error.textContent=e.message||String(e);
      }
    });
    document.getElementById?.('genie-disable-all')?.addEventListener('click',disableAll);
    updateButton();render();
  }

  if(typeof document!=='undefined'){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindUi);
    else bindUi();
  }

  return {
    decode,decodeChain,identify,onRomLoaded,patchRomRead,setBuiltIn,addManual,
    disableAll,render,state:()=>({current:{...current},active:active.map(x=>({...x}))}),
    database:games
  };
})();
