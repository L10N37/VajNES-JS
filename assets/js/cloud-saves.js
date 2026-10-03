(() => {
  'use strict';

  const cfg = window.VAJNES_CLOUD_CONFIG || {};
  const SLOT_COUNT = Number(cfg.slotCount) || 10;
  const DB_NAME = 'vajnes-cloud-saves-v1';
  const DB_VERSION = 1;
  const STORE = 'states';
  const META = 'meta';
  const MIME_STATE = 'application/octet-stream';
  const DRIVE_SCOPE = cfg.driveScope || 'https://www.googleapis.com/auth/drive.file';
  const ROOT_NAME = cfg.rootFolderName || 'VajNES';

  const model = {
    game: window.VajNESCurrentGame || null,
    slot: 1,
    token: '',
    tokenExpiresAt: 0,
    signedIn: false,
    googleReady: false,
    authBusy: false,
    authError: '',
    syncBusy: false,
    driveRootId: '',
    driveGameId: '',
    driveGameKey: '',
    tokenClient: null,
    slots: Array.from({length:SLOT_COUNT},()=>null)
  };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);

  function safeGameFolder(game) {
    const base = String(game?.name || 'NES Game')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 96) || 'NES Game';
    return `${base} [${game?.payloadCrcHex || game?.key || 'UNKNOWN'}]`;
  }

  function slotKey(game, slot) {
    return `${game.key}:${slot}`;
  }

  function selectedSlotKey(game) {
    return `selected:${game.key}`;
  }

  function openDb() {
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'id'});
        if(!db.objectStoreNames.contains(META)) db.createObjectStore(META,{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  async function dbGet(store,key) {
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readonly');
      const req=tx.objectStore(store).get(key);
      req.onsuccess=()=>resolve(req.result || null);
      req.onerror=()=>reject(req.error);
      tx.oncomplete=()=>db.close();
    });
  }

  async function dbPut(store,value) {
    const db=await openDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete=()=>{db.close();resolve(value);};
      tx.onerror=()=>{db.close();reject(tx.error);};
    });
  }

  async function loadLocalSlots() {
    model.slots=Array.from({length:SLOT_COUNT},()=>null);
    if(!model.game) return;
    const selected=await dbGet(META,selectedSlotKey(model.game)).catch(()=>null);
    model.slot=Math.min(SLOT_COUNT,Math.max(1,Number(selected?.value)||1));
    await Promise.all(Array.from({length:SLOT_COUNT},async(_,i)=>{
      const rec=await dbGet(STORE,slotKey(model.game,i+1)).catch(()=>null);
      model.slots[i]=rec;
    }));
  }

  async function setSlot(slot) {
    if(!model.game) return;
    model.slot=Math.min(SLOT_COUNT,Math.max(1,Number(slot)||1));
    await dbPut(META,{key:selectedSlotKey(model.game),value:model.slot});
    render();
  }

  function stateIO() {
    return window.VajNESStateIO || null;
  }

  async function saveLocal(slot=model.slot,{sync=true}={}) {
    if(!model.game) throw new Error('Load a game first.');
    const io=stateIO();
    if(!io) throw new Error('Save-state engine is not ready.');
    const bytes=io.build();
    if(!(bytes instanceof Uint8Array)) throw new Error('Could not build save state.');
    const now=Date.now();
    const rec={
      id:slotKey(model.game,slot),
      gameKey:model.game.key,
      gameName:model.game.name,
      slot,
      updatedAt:now,
      bytes:new Blob([bytes],{type:MIME_STATE}),
      size:bytes.byteLength,
      cloudUpdatedAt:0,
      dirty:true
    };
    await dbPut(STORE,rec);
    model.slots[slot-1]=rec;
    render();
    toast(`Saved slot ${slot} locally`);
    if(sync && model.signedIn) {
      try { await uploadSlot(slot,rec); }
      catch(err) { console.warn('[Cloud Saves] upload failed',err); toast('Saved locally — Drive sync pending'); }
    }
    return rec;
  }

  async function loadLocal(slot=model.slot) {
    if(!model.game) throw new Error('Load a game first.');
    let rec=model.slots[slot-1] || await dbGet(STORE,slotKey(model.game,slot));
    if(!rec && model.signedIn) {
      await syncFromDrive();
      rec=model.slots[slot-1] || null;
    }
    if(!rec?.bytes) throw new Error(`Slot ${slot} is empty.`);
    const bytes=new Uint8Array(await rec.bytes.arrayBuffer());
    const ok=stateIO()?.apply(bytes);
    if(!ok) throw new Error('Save state could not be restored.');
    toast(`Loaded slot ${slot}`);
    return true;
  }

  function googleReady() {
    return !!window.google?.accounts?.oauth2?.initTokenClient;
  }

  function loadGoogleIdentity() {
    if(googleReady()) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-vajnes-google-identity]');
      if(existing) {
        existing.addEventListener('load',()=>resolve(),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Google sign-in failed to load.')),{once:true});
        return;
      }
      const s=document.createElement('script');
      s.src='https://accounts.google.com/gsi/client';
      s.async=true;s.defer=true;s.dataset.vajnesGoogleIdentity='1';
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error('Google sign-in failed to load.'));
      document.head.appendChild(s);
    });
  }

  function requireClientId() {
    const id=String(cfg.googleClientId||'').trim();
    if(!id) throw new Error('Google Drive login is not configured yet (missing OAuth Client ID).');
    return id;
  }

  function oauthFailure(error) {
    model.authBusy=false;
    model.signedIn=false;
    model.authError='Google sign-in failed: '+(error?.type || error?.error || 'unknown error');
    render();
    toast(model.authError,5000);
    console.error('[Cloud Saves]',model.authError,error);
  }

  async function finishSignIn(response) {
    try {
      if(response?.error) throw new Error(response.error);
      if(!response?.access_token) throw new Error('Google returned no access token.');

      model.token=response.access_token;
      model.tokenExpiresAt=Date.now()+(Number(response.expires_in)||3600)*1000-60000;

      // Confirm the token really works with Drive before saying we're connected.
      await driveJson('https://www.googleapis.com/drive/v3/about?fields=kind');

      model.signedIn=true;
      model.authError='';
      model.driveRootId='';
      model.driveGameId='';
      model.driveGameKey='';
      render();
      toast('Google Drive connected');

      if(model.game) await syncFromDrive();
    } catch(err) {
      model.token='';
      model.tokenExpiresAt=0;
      model.signedIn=false;
      model.authError=err?.message || String(err);
      render();
      toast(model.authError,5000);
      console.error('[Cloud Saves]',err);
    } finally {
      model.authBusy=false;
      render();
    }
  }

  async function prepareGoogleSignIn() {
    try {
      requireClientId();
      await loadGoogleIdentity();
      if(!model.tokenClient) {
        model.tokenClient=google.accounts.oauth2.initTokenClient({
          client_id:cfg.googleClientId,
          scope:DRIVE_SCOPE,
          callback:response=>{ void finishSignIn(response); },
          error_callback:oauthFailure
        });
      }
      model.googleReady=true;
      model.authError='';
      render();
    } catch(err) {
      model.googleReady=false;
      model.authError=err?.message || String(err);
      render();
    }
  }

  function signIn() {
    requireClientId();
    if(!model.googleReady || !model.tokenClient) {
      model.authError='Google sign-in is still loading. Try again in a moment.';
      render();
      void prepareGoogleSignIn();
      return;
    }

    model.authBusy=true;
    model.authError='';
    render();

    // This call happens directly inside the button click handler. Do not await
    // script loading here: Firefox may otherwise treat the OAuth popup as no
    // longer user-initiated.
    model.tokenClient.requestAccessToken();
  }

  function signOut() {
    // Disconnect this browser session only. Do not revoke the user's whole
    // Google authorization grant every time they disconnect from VajNES.
    model.token='';model.tokenExpiresAt=0;model.signedIn=false;
    model.authBusy=false;model.authError='';
    model.driveRootId='';model.driveGameId='';model.driveGameKey='';
    render();
    toast('Google Drive disconnected');
  }

  function authHeaders(extra={}) {
    if(!model.token || Date.now()>=model.tokenExpiresAt) {
      model.signedIn=false;
      throw new Error('Google Drive session expired. Sign in again.');
    }
    return {Authorization:`Bearer ${model.token}`,...extra};
  }

  async function driveJson(url,options={}) {
    const res=await fetch(url,{...options,headers:authHeaders(options.headers||{})});
    if(!res.ok) {
      let body=''; try { body=await res.text(); } catch {}
      throw new Error(`Google Drive error ${res.status}${body ? ': '+body.slice(0,180) : ''}`);
    }
    if(res.status===204) return null;
    return res.json();
  }

  function q(value) {
    return String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  }

  async function findChildFolder(name,parentId) {
    const query=[
      `name='${q(name)}'`,
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
      parentId ? `'${q(parentId)}' in parents` : null
    ].filter(Boolean).join(' and ');
    const data=await driveJson('https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,name,createdTime)&pageSize=100&q='+encodeURIComponent(query));
    return data.files?.[0] || null;
  }

  async function createFolder(name,parentId,appProperties={}) {
    const body={name,mimeType:'application/vnd.google-apps.folder',appProperties};
    if(parentId) body.parents=[parentId];
    return driveJson('https://www.googleapis.com/drive/v3/files?fields=id,name',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
  }

  async function ensureDriveFolders() {
    if(!model.game) throw new Error('Load a game first.');
    if(model.driveGameId && model.driveGameKey===model.game.key) return model.driveGameId;

    let root=model.driveRootId ? {id:model.driveRootId} : await findChildFolder(ROOT_NAME,'root');
    if(!root) root=await createFolder(ROOT_NAME,'root',{app:'VajNES',kind:'root'});
    model.driveRootId=root.id;

    const folderName=safeGameFolder(model.game);
    let game=await findChildFolder(folderName,root.id);
    if(!game) game=await createFolder(folderName,root.id,{
      app:'VajNES',kind:'game',gameKey:model.game.key,crc:model.game.payloadCrcHex
    });
    model.driveGameId=game.id;
    model.driveGameKey=model.game.key;
    return game.id;
  }

  async function findSlotFile(slot,parentId) {
    const name=`slot-${String(slot).padStart(2,'0')}.state`;
    const query=[
      `name='${q(name)}'`,
      "trashed=false",
      `'${q(parentId)}' in parents`
    ].join(' and ');
    const data=await driveJson('https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,name,modifiedTime,size,appProperties)&pageSize=20&q='+encodeURIComponent(query));
    return data.files?.[0] || null;
  }

  function multipartBody(metadata,bytes) {
    const boundary='vajnes_'+Math.random().toString(16).slice(2)+Date.now().toString(16);
    const enc=new TextEncoder();
    const head=enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`+
      JSON.stringify(metadata)+
      `\r\n--${boundary}\r\nContent-Type: ${MIME_STATE}\r\n\r\n`
    );
    const tail=enc.encode(`\r\n--${boundary}--`);
    const out=new Uint8Array(head.length+bytes.length+tail.length);
    out.set(head,0);out.set(bytes,head.length);out.set(tail,head.length+bytes.length);
    return {boundary,body:out};
  }

  async function uploadSlot(slot,rec=model.slots[slot-1]) {
    if(!rec?.bytes) throw new Error(`Slot ${slot} is empty.`);
    model.syncBusy=true;render();
    try {
      const parentId=await ensureDriveFolders();
      const existing=await findSlotFile(slot,parentId);
      const bytes=new Uint8Array(await rec.bytes.arrayBuffer());
      const metadata={
        name:`slot-${String(slot).padStart(2,'0')}.state`,
        appProperties:{
          app:'VajNES',gameKey:model.game.key,slot:String(slot),
          updatedAt:String(rec.updatedAt||Date.now())
        }
      };
      if(!existing) metadata.parents=[parentId];
      const mp=multipartBody(metadata,bytes);
      const endpoint=existing
        ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart&fields=id,modifiedTime,size`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime,size';
      const res=await fetch(endpoint,{
        method:existing?'PATCH':'POST',
        headers:authHeaders({'Content-Type':`multipart/related; boundary=${mp.boundary}`}),
        body:mp.body
      });
      if(!res.ok) throw new Error(`Google Drive upload failed (${res.status})`);
      const file=await res.json();
      rec={...rec,cloudUpdatedAt:Date.parse(file.modifiedTime)||Date.now(),dirty:false,driveFileId:file.id};
      await dbPut(STORE,rec);model.slots[slot-1]=rec;
      render();toast(`Slot ${slot} synced to Drive`);
      return file;
    } finally { model.syncBusy=false;render(); }
  }

  async function downloadDriveFile(file) {
    const res=await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,{headers:authHeaders()});
    if(!res.ok) throw new Error(`Google Drive download failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async function syncFromDrive() {
    if(!model.game || !model.signedIn) return;
    model.syncBusy=true;render();
    try {
      const parentId=await ensureDriveFolders();
      for(let slot=1;slot<=SLOT_COUNT;slot++) {
        const remote=await findSlotFile(slot,parentId);
        if(!remote) continue;
        const local=model.slots[slot-1];
        const remoteTime=Date.parse(remote.modifiedTime)||0;
        const localTime=Number(local?.updatedAt)||0;
        if(local && local.dirty && localTime>=remoteTime) {
          await uploadSlot(slot,local);
          continue;
        }
        if(!local || remoteTime>localTime) {
          const bytes=await downloadDriveFile(remote);
          const updatedAt=Number(remote.appProperties?.updatedAt)||remoteTime||Date.now();
          const rec={
            id:slotKey(model.game,slot),gameKey:model.game.key,gameName:model.game.name,slot,
            updatedAt,bytes:new Blob([bytes],{type:MIME_STATE}),size:bytes.byteLength,
            cloudUpdatedAt:remoteTime||Date.now(),dirty:false,driveFileId:remote.id
          };
          await dbPut(STORE,rec);model.slots[slot-1]=rec;
        }
      }
      render();
      toast('Drive saves synced');
    } finally { model.syncBusy=false;render(); }
  }

  async function syncToDrive() {
    if(!model.signedIn) throw new Error('Sign in to Google Drive first.');
    for(let slot=1;slot<=SLOT_COUNT;slot++) {
      const rec=model.slots[slot-1];
      if(rec?.bytes) await uploadSlot(slot,rec);
    }
  }

  let root,slotGrid,statusText,gameText,accountBtn,syncBtn;
  function buildUi() {
    const wrap=document.createElement('div');
    wrap.id='cloud-save-modal';
    wrap.className='cloud-save-modal';
    wrap.setAttribute('aria-hidden','true');
    wrap.innerHTML=`
      <div class="cloud-save-card" role="dialog" aria-modal="true" aria-labelledby="cloud-save-title">
        <button type="button" class="cloud-save-close" aria-label="Close">&times;</button>
        <div class="cloud-save-head">
          <div><h2 id="cloud-save-title">Cloud Saves</h2>
          <div class="cloud-save-sub">10 slots per game · local first · Google Drive sync</div></div>
          <div class="cloud-save-status" id="cloud-save-status">Local saves ready</div>
        </div>
        <div class="cloud-save-game" id="cloud-save-game">Load a ROM to start</div>
        <div class="cloud-save-toolbar">
          <button type="button" id="cloud-account-button">Sign in with Google</button>
          <button type="button" id="cloud-sync-button">Sync now</button>
        </div>
        <div class="cloud-save-slots" id="cloud-save-slots"></div>
        <div class="cloud-save-actions">
          <button type="button" id="cloud-quick-save">Quick Save</button>
          <button type="button" id="cloud-quick-load">Quick Load</button>
        </div>
        <div class="cloud-save-hint">Selected slot is remembered per game. Alt+1…9 / Alt+0 selects slots 1…10.</div>
      </div>`;
    document.body.appendChild(wrap);
    root=wrap;
    slotGrid=wrap.querySelector('#cloud-save-slots');
    statusText=wrap.querySelector('#cloud-save-status');
    gameText=wrap.querySelector('#cloud-save-game');
    accountBtn=wrap.querySelector('#cloud-account-button');
    syncBtn=wrap.querySelector('#cloud-sync-button');

    wrap.querySelector('.cloud-save-close').addEventListener('click',close);
    wrap.addEventListener('click',e=>{if(e.target===wrap)close();});
    accountBtn.addEventListener('click',async()=>run(model.signedIn?signOut:signIn));
    syncBtn.addEventListener('click',()=>run(syncFromDrive));
    wrap.querySelector('#cloud-quick-save').addEventListener('click',()=>run(()=>saveLocal()));
    wrap.querySelector('#cloud-quick-load').addEventListener('click',()=>run(()=>loadLocal()));

    const btn=document.getElementById('cloudButton');
    btn?.addEventListener('click',open);
  }

  function fmt(ts) {
    if(!ts) return 'Empty';
    try { return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(ts)); }
    catch { return new Date(ts).toLocaleString(); }
  }

  function render() {
    if(!root) return;
    gameText.textContent=model.game
      ? `${model.game.name} · ${model.game.payloadCrcHex}`
      : 'Load a ROM to start';
    statusText.textContent=model.authBusy
      ? 'Signing in…'
      : model.authError
        ? model.authError
        : model.syncBusy
          ? 'Syncing…'
          : model.signedIn ? 'Google Drive connected'
          : model.googleReady ? 'Google sign-in ready'
          : 'Loading Google sign-in…';
    accountBtn.textContent=model.authBusy
      ? 'Signing in…'
      : model.signedIn ? 'Disconnect Google Drive'
      : model.googleReady ? 'Sign in with Google'
      : 'Loading Google…';
    accountBtn.disabled=model.authBusy || (!model.googleReady && !model.signedIn);
    syncBtn.disabled=!model.signedIn || !model.game || model.syncBusy || model.authBusy;
    slotGrid.innerHTML='';
    for(let slot=1;slot<=SLOT_COUNT;slot++) {
      const rec=model.slots[slot-1];
      const b=document.createElement('button');
      b.type='button';
      b.className='cloud-slot'+(slot===model.slot?' is-selected':'')+(rec?' has-save':'');
      b.dataset.slot=String(slot);
      b.innerHTML=`<span class="cloud-slot-number">Slot ${slot}</span><span class="cloud-slot-time">${esc(fmt(rec?.updatedAt))}</span><span class="cloud-slot-state">${rec ? (rec.dirty?'Local · sync pending':'Local + Drive') : 'Empty'}</span>`;
      b.addEventListener('click',()=>setSlot(slot));
      slotGrid.appendChild(b);
    }
  }

  function open() { root?.classList.add('is-open');root?.setAttribute('aria-hidden','false');render(); }
  function close(){ root?.classList.remove('is-open');root?.setAttribute('aria-hidden','true'); }

  let toastTimer=0;
  function toast(message,duration=1800) {
    let el=document.getElementById('cloud-save-toast');
    if(!el){el=document.createElement('div');el.id='cloud-save-toast';el.className='cloud-save-toast';document.body.appendChild(el);}
    el.textContent=message;el.classList.add('is-visible');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-visible'),duration);
  }

  async function run(fn) {
    try { await fn(); }
    catch(err) { console.error('[Cloud Saves]',err);toast(err?.message||String(err)); }
  }

  async function onGame(game) {
    model.game=game;
    model.driveGameId='';model.driveGameKey='';
    await loadLocalSlots();
    render();
    if(model.signedIn) await run(syncFromDrive);
  }

  window.VajNESCloudSaves={
    open,close,signIn,signOut,sync:syncFromDrive,
    quickSave:()=>saveLocal(model.slot),
    quickLoad:()=>loadLocal(model.slot),
    selectSlot:setSlot,
    get selectedSlot(){return model.slot;},
    get game(){return model.game;},
    get connected(){return model.signedIn;}
  };

  window.addEventListener('vajnes-rom-loaded',e=>run(()=>onGame(e.detail)));
  document.addEventListener('keydown',e=>{
    if(e.altKey && !e.ctrlKey && !e.metaKey) {
      const n=e.code==='Digit0'?10:
        /^Digit[1-9]$/.test(e.code)?Number(e.code.slice(5)):0;
      if(n){e.preventDefault();run(()=>setSlot(n));return;}
    }
    if(e.key==='Escape' && root?.classList.contains('is-open')) close();
  });

  document.addEventListener('DOMContentLoaded',()=>{
    buildUi();
    void prepareGoogleSignIn();
    if(window.VajNESCurrentGame) run(()=>onGame(window.VajNESCurrentGame));
  });
})();
