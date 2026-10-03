// VajNES Game Genie support.
// NES Game Genie patches cartridge CPU reads after mapper translation.
// 6-character codes always substitute; 8-character codes substitute only when
// the mapped ROM byte matches the decoded compare value.
const VajNESGenie = (() => {
  const alphabet = 'APZLGITYEOXUKSVN';
  const nibble = Object.fromEntries([...alphabet].map((c, i) => [c, i]));
  const sourceBase =
    'https://raw.githubusercontent.com/libretro/libretro-database/master/cht/' +
    'Nintendo%20-%20Nintendo%20Entertainment%20System/';

  // Header-independent fallbacks for ROMs whose PRG+CHR payload is already
  // known to VajNES. Exact whole-file CRC matching remains the primary path.
  const payloadAliases = Object.freeze({
    CBF4366F: {
      title: 'Alien Syndrome (USA) (Unl)',
      path: 'Alien Syndrome (USA, Japan) (Game Genie).cht'
    }
  });
  const learnedPayloadStorage = 'vajnesGeniePayloadAliasesV1';

  function loadLearnedPayloadAliases() {
    if (typeof localStorage === 'undefined') return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(learnedPayloadStorage) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  let learnedPayloadAliases = loadLearnedPayloadAliases();

  function rememberPayloadAlias(payloadCrc, entry) {
    if (!entry?.path) return;
    const key = crcText(payloadCrc);
    if (key === '00000000') return;
    learnedPayloadAliases[key] = { title: entry.title, path: entry.path };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(learnedPayloadStorage, JSON.stringify(learnedPayloadAliases));
      } catch {}
    }
  }

  let current = {
    title: 'No ROM loaded',
    fullCrc: 0,
    payloadCrc: 0,
    mapper: null,
    entry: null,
    source: '',
    status: 'idle',
    cheats: [],
    error: ''
  };

  let enabled = new Map();
  let manual = [];
  let active = [];
  let loadToken = 0;
  let uiBound = false;
  const cache = new Map();

  function cleanCode(code) {
    return String(code || '').toUpperCase().replace(/[\s-]/g, '');
  }

  function decode(code) {
    const c = cleanCode(code);
    if (c.length !== 6 && c.length !== 8)
      throw new Error('Game Genie code must be 6 or 8 letters');

    const n = [...c].map(ch => {
      const value = nibble[ch];
      if (value === undefined)
        throw new Error('Game Genie letters must use APZLGITYEOXUKSVN');
      return value;
    });

    const address = 0x8000 |
      ((n[3] & 7) << 12) |
      ((n[5] & 7) << 8) | ((n[4] & 8) << 8) |
      ((n[2] & 7) << 4) | ((n[1] & 8) << 4) |
      (n[4] & 7) | (n[3] & 8);

    const data = c.length === 6
      ? (((n[1] & 7) << 4) | ((n[0] & 8) << 4) | (n[0] & 7) | (n[5] & 8))
      : (((n[1] & 7) << 4) | ((n[0] & 8) << 4) | (n[0] & 7) | (n[7] & 8));

    const compare = c.length === 8
      ? (((n[7] & 7) << 4) | ((n[6] & 8) << 4) | (n[6] & 7) | (n[5] & 8))
      : null;

    return {
      code: c,
      address: address & 0xffff,
      data: data & 0xff,
      compare
    };
  }

  function decodeChain(code) {
    const parts = String(code || '').split('+').map(x => x.trim()).filter(Boolean);
    if (!parts.length) throw new Error('Enter a Game Genie code');
    return parts.map(decode);
  }

  function isNoOpChain(decoded) {
    return decoded.length > 0 &&
      decoded.every(patch => patch.compare !== null && patch.compare === patch.data);
  }

  function crcText(value) {
    return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  function normalName(name) {
    return String(name || '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.nes$/i, '')
      .replace(/\s*\[[^\]]*\]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function baseTitle(name) {
    return normalName(name)
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function indexObject() {
    return globalThis.VAJNES_GAME_GENIE_INDEX || {};
  }

  function findByFileName(fileName) {
    const exact = normalName(fileName);
    if (!exact) return null;
    const entries = Object.values(indexObject());

    const exactHit = entries.find(entry => normalName(entry.title) === exact);
    if (exactHit) return exactHit;

    const base = baseTitle(fileName);
    if (!base) return null;
    const matches = entries.filter(entry => baseTitle(entry.title) === base);
    if (!matches.length) return null;

    // Only accept a fuzzy title fallback when every regional/revision match
    // points at the same Game Genie set.
    const uniquePaths = [...new Set(matches.map(entry => entry.path))];
    return uniquePaths.length === 1 ? matches[0] : null;
  }

  function identify(fullCrc, payloadCrc, fileName) {
    const exact = indexObject()[crcText(fullCrc)];
    if (exact) {
      rememberPayloadAlias(payloadCrc, exact);
      return { entry: exact, source: 'exact ROM CRC' };
    }

    const payloadKey = crcText(payloadCrc);
    const payload = payloadAliases[payloadKey] || learnedPayloadAliases[payloadKey];
    if (payload) return { entry: payload, source: 'PRG+CHR payload CRC' };

    const byName = findByFileName(fileName);
    if (byName) {
      rememberPayloadAlias(payloadCrc, byName);
      return { entry: byName, source: 'ROM filename fallback' };
    }

    return { entry: null, source: '' };
  }

  function parseValue(text) {
    const value = String(text || '').trim();
    try {
      return JSON.parse(value);
    } catch {
      if (value.startsWith('"') && value.endsWith('"'))
        return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      return value;
    }
  }

  function parseCht(text) {
    const descriptions = new Map();
    const codes = new Map();

    for (const line of String(text || '').split(/\r?\n/)) {
      const match = line.match(/^\s*cheat(\d+)_(desc|code)\s*=\s*(.+?)\s*$/);
      if (!match) continue;
      const index = Number(match[1]);
      const value = parseValue(match[3]);
      if (match[2] === 'desc') descriptions.set(index, value);
      else codes.set(index, value);
    }

    const cheats = [];
    for (const index of [...codes.keys()].sort((a, b) => a - b)) {
      const code = String(codes.get(index) || '').trim().toUpperCase();
      try {
        const decoded = decodeChain(code);
        // Some public databases contain codes whose compare and replacement
        // bytes are identical. Those can never change the cartridge bus, so
        // don't present them as working cheats.
        if (isNoOpChain(decoded)) continue;
      } catch {
        continue;
      }
      cheats.push({
        description: String(descriptions.get(index) || ('Cheat ' + (index + 1))),
        code
      });
    }
    return cheats;
  }

  function activeCheatCount() {
    let count = 0;
    for (const value of enabled.values()) if (value) count++;
    for (const item of manual) if (item.enabled) count++;
    return count;
  }

  function updateButton() {
    if (typeof document === 'undefined') return;
    const button = document.getElementById('genieButton');
    if (!button) return;
    button.disabled = current.mapper === null;
    const count = activeCheatCount();
    button.textContent = count ? ('Genie (' + count + ')') : 'Genie';
    button.classList?.toggle?.('genie-active', count > 0);
  }

  function rebuildActive() {
    const out = [];

    current.cheats.forEach((item, index) => {
      if (!enabled.get(index)) return;
      try {
        out.push(...decodeChain(item.code));
      } catch {}
    });

    for (const item of manual) {
      if (!item.enabled) continue;
      try {
        out.push(...decodeChain(item.code));
      } catch {}
    }

    active = out;
    updateButton();
  }

  function patchRomRead(address, value) {
    const original = value & 0xff;
    if (!active.length || address < 0x8000) return original;

    let out = original;
    for (const patch of active) {
      if (patch.address !== (address & 0xffff)) continue;
      if (patch.compare !== null && patch.compare !== original) continue;
      out = patch.data;
    }
    return out & 0xff;
  }

  async function ensureBuiltIns() {
    if (!current.entry || !current.entry.path || current.mapper === null) {
      render();
      return false;
    }
    if (current.status === 'ready') return true;
    if (current.status === 'loading') return false;

    const token = ++loadToken;
    current.status = 'loading';
    current.error = '';
    render();

    try {
      let cheats = cache.get(current.entry.path);
      if (!cheats) {
        if (typeof fetch !== 'function')
          throw new Error('Cheat database download is unavailable in this browser');

        const response = await fetch(sourceBase + encodeURIComponent(current.entry.path), {
          cache: 'force-cache'
        });
        if (!response.ok)
          throw new Error('Cheat database request failed (' + response.status + ')');

        cheats = parseCht(await response.text());
        cache.set(current.entry.path, cheats);
      }

      if (token !== loadToken) return false;
      current.cheats = cheats;
      current.status = 'ready';
      rebuildActive();
      render();
      return true;
    } catch (error) {
      if (token !== loadToken) return false;
      current.cheats = [];
      current.status = 'error';
      current.error = error?.message || String(error);
      render();
      return false;
    }
  }

  function onRomLoaded(info = {}) {
    loadToken++;
    enabled = new Map();
    manual = [];
    active = [];

    const fullCrc = info.fullCrc >>> 0;
    const payloadCrc = info.payloadCrc >>> 0;
    const match = identify(fullCrc, payloadCrc, info.fileName);

    current = {
      title: match.entry?.title ||
        (info.fileName
          ? String(info.fileName).replace(/^.*[\\/]/, '').replace(/\.nes$/i, '')
          : 'Unknown ROM'),
      fullCrc,
      payloadCrc,
      mapper: Number.isFinite(info.mapper) ? info.mapper : null,
      entry: match.entry,
      source: match.source,
      status: match.entry ? 'available' : 'none',
      cheats: [],
      error: ''
    };

    updateButton();
    render();
  }

  function setBuiltIn(index, on) {
    enabled.set(Number(index), !!on);
    rebuildActive();
  }

  function addManual(code, description = 'Manual Game Genie code') {
    const cleaned = String(code || '').trim().toUpperCase();
    const decoded = decodeChain(cleaned);
    if (isNoOpChain(decoded))
      throw new Error('This Game Genie code is a no-op: its compare and replacement bytes are identical');
    manual.push({
      description: String(description || 'Manual Game Genie code'),
      code: cleaned,
      enabled: true
    });
    rebuildActive();
    render();
    return true;
  }

  function removeManual(index) {
    manual.splice(Number(index), 1);
    rebuildActive();
    render();
  }

  function disableAll() {
    enabled.clear();
    for (const item of manual) item.enabled = false;
    rebuildActive();
    render();
  }

  function appendCheatRow(list, item, checked, onChange, removeAction) {
    const row = document.createElement(removeAction ? 'div' : 'label');
    row.className = 'genie-cheat-row' + (removeAction ? ' genie-manual-row' : '');

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!checked;
    box.addEventListener('change', () => onChange(box.checked));

    const body = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = item.description;
    const code = document.createElement('code');
    code.textContent = item.code;
    body.append(name, code);
    row.append(box, body);

    if (removeAction) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.className = 'genie-small-button';
      remove.addEventListener('click', removeAction);
      row.append(remove);
    }

    list.append(row);
  }

  function render() {
    if (typeof document === 'undefined') return;

    const title = document.getElementById('genie-game-title');
    const meta = document.getElementById('genie-game-meta');
    const status = document.getElementById('genie-status');
    const list = document.getElementById('genie-cheat-list');
    const empty = document.getElementById('genie-empty');

    if (title) title.textContent = current.title;

    if (meta) {
      meta.textContent = current.mapper === null
        ? 'Load a ROM to identify it and view cheats.'
        : ('Mapper ' + current.mapper +
          ' · ROM CRC ' + crcText(current.fullCrc) +
          ' · payload CRC ' + crcText(current.payloadCrc));
    }

    if (status) {
      if (current.mapper === null) status.textContent = '';
      else if (current.entry)
        status.textContent = 'Matched by ' + current.source + ' · ' + current.entry.path;
      else
        status.textContent = 'No matching built-in Game Genie set was found for this ROM.';
    }

    if (!list || typeof list.replaceChildren !== 'function') {
      updateButton();
      return;
    }
    list.replaceChildren();

    let emptyText = '';
    if (current.mapper === null) emptyText = 'No ROM loaded.';
    else if (!current.entry)
      emptyText = 'Manual 6- or 8-character Game Genie codes still work for this ROM.';
    else if (current.status === 'available')
      emptyText = 'Built-in cheats are available. Open Genie to load them.';
    else if (current.status === 'loading')
      emptyText = 'Loading the matching Game Genie cheat set...';
    else if (current.status === 'error')
      emptyText = 'Built-in cheat set could not be loaded: ' + current.error;
    else if (current.status === 'ready' && !current.cheats.length)
      emptyText = 'The matched set contains no valid 6- or 8-character Game Genie codes.';

    if (empty) {
      empty.style.display = emptyText ? 'block' : 'none';
      empty.textContent = emptyText;
    }

    current.cheats.forEach((item, index) => {
      appendCheatRow(
        list,
        item,
        !!enabled.get(index),
        checked => setBuiltIn(index, checked),
        null
      );
    });

    manual.forEach((item, index) => {
      appendCheatRow(
        list,
        item,
        item.enabled,
        checked => {
          item.enabled = checked;
          rebuildActive();
        },
        () => removeManual(index)
      );
    });

    updateButton();
  }

  function bindUi() {
    if (uiBound || typeof document === 'undefined') return;
    uiBound = true;

    const add = document.getElementById('genie-add');
    const input = document.getElementById('genie-code-input');
    const error = document.getElementById('genie-code-error');

    add?.addEventListener?.('click', () => {
      try {
        addManual(input?.value || '');
        if (input) input.value = '';
        if (error) error.textContent = '';
      } catch (ex) {
        if (error) error.textContent = ex?.message || String(ex);
      }
    });

    input?.addEventListener?.('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      add?.click?.();
    });

    document.getElementById('genie-disable-all')?.addEventListener?.('click', disableAll);
    document.getElementById('genieButton')?.addEventListener?.('click', () => {
      ensureBuiltIns();
    });

    updateButton();
    render();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', bindUi);
    else
      bindUi();
  }

  return {
    decode,
    decodeChain,
    parseCht,
    identify,
    onRomLoaded,
    ensureBuiltIns,
    patchRomRead,
    setBuiltIn,
    addManual,
    disableAll,
    render,
    state: () => ({
      current: { ...current, cheats: current.cheats.map(item => ({ ...item })) },
      active: active.map(item => ({ ...item })),
      manual: manual.map(item => ({ ...item }))
    })
  };
})();
