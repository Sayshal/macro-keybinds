const pendingKeybinds = new Map();

const MODIFIER_CODES = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'];
const PENDING_TTL_MS = 30_000;

/**
 * Read the userKeybinds setting, self-healing if a corrupt non-object slipped in.
 * @returns {object} Map of macroId to stored keybind entry.
 */
function getUserKeybinds() {
  let keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  if (Array.isArray(keybinds) || typeof keybinds !== 'object' || keybinds === null) {
    keybinds = {};
    game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
  }
  return keybinds;
}

/**
 * Persist the userKeybinds setting, coercing invalid input to an empty object.
 * @param {object} keybinds Map of macroId to stored keybind entry.
 * @returns {Promise<void>}
 */
async function setUserKeybinds(keybinds) {
  if (Array.isArray(keybinds) || typeof keybinds !== 'object' || keybinds === null) keybinds = {};
  await game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
}

Hooks.on('init', () => {
  console.log('macro-keybinds | Initializing module');
  registerSettings();
  registerStoredKeybindings();
});

Hooks.on('renderMacroConfig', (app, html) => {
  const macro = app?.document;
  const macroId = macro?.id;
  const isNewMacro = !macroId;
  const tempId = isNewMacro ? `temp-${app.id}` : macroId;
  const keybinds = getUserKeybinds();
  const currentKeybind = isNewMacro ? pendingKeybinds.get(tempId)?.keybind || '' : keybinds[macroId]?.keybind || '';
  const typeFormGroup = html.querySelector('select[name="type"]')?.closest('div.form-group');
  if (!typeFormGroup) {
    console.warn('macro-keybinds | Could not find type form group');
    return;
  }
  const keybindFormGroup = document.createElement('div');
  keybindFormGroup.className = 'form-group';
  const noticeText = isNewMacro
    ? `<p class="notes" style="color: #ff6400; font-style: italic;">${game.i18n.localize('MACROKEYBINDS.NoticeWillApply')}</p>`
    : `<p class="notes">${game.i18n.localize('MACROKEYBINDS.Instructions')}</p>`;
  keybindFormGroup.innerHTML = `
    <label>${game.i18n.localize('MACROKEYBINDS.Label')}</label>
    <div class="form-fields">
      <input type="text" name="macro-keybind" value="${currentKeybind}" placeholder="${game.i18n.localize('MACROKEYBINDS.Placeholder')}">
    </div>
    ${noticeText}
  `;
  typeFormGroup.parentNode.insertBefore(keybindFormGroup, typeFormGroup.nextSibling);
  const input = html.querySelector('input[name="macro-keybind"]');
  const activeModifiers = new Set();
  input.addEventListener('keydown', async (event) => {
    event.preventDefault();
    if (MODIFIER_CODES.includes(event.code)) {
      activeModifiers.add(event.code);
      return;
    }
    if (event.code === 'Delete' || event.code === 'Backspace') {
      if (isNewMacro) pendingKeybinds.delete(tempId);
      else await updateStoredKeybinds(macroId);
      input.value = '';
      return;
    }
    const keybindData = {
      key: event.code,
      simKey: event.key.toUpperCase(),
      modifiers: getStandardizedModifiers(activeModifiers),
      name: macro.name
    };
    const keybindString = formatKeybind(keybindData);
    input.value = keybindString;
    const keybinds = getUserKeybinds();
    for (const [id, data] of Object.entries(keybinds)) {
      if (data.keybind === keybindString && id !== macroId) {
        console.log(game.i18n.format('MACROKEYBINDS.RemovingDuplicate', { id }));
        delete keybinds[id];
      }
    }
    for (const [pendingId, pendingData] of pendingKeybinds.entries()) {
      if (pendingData.keybind === keybindString && pendingId !== tempId) pendingKeybinds.delete(pendingId);
    }
    if (isNewMacro) {
      pendingKeybinds.set(tempId, { ...keybindData, keybind: keybindString, timestamp: Date.now() });
      ui.notifications.info(game.i18n.localize('MACROKEYBINDS.NotificationWillApply'));
    } else {
      await updateStoredKeybinds(macroId, keybindData);
      ui.notifications.info(game.i18n.localize('MACROKEYBINDS.NotificationSaved'));
    }
  });
  input.addEventListener('keyup', (event) => {
    if (MODIFIER_CODES.includes(event.code)) activeModifiers.delete(event.code);
  });
});

Hooks.on('updateMacro', async (macro, changes, _options, userId) => {
  if (userId !== game.user.id || !changes.name) return;
  const keybinds = getUserKeybinds();
  if (!keybinds[macro.id]) return;
  keybinds[macro.id].name = changes.name;
  await setUserKeybinds(keybinds);
});

Hooks.on('createMacro', async (macro, _options, userId) => {
  if (userId !== game.user.id) return;
  const now = Date.now();
  let mostRecentPending = null;
  let mostRecentKey = null;
  let mostRecentTime = 0;
  for (const [key, pendingData] of pendingKeybinds.entries()) {
    const age = now - (pendingData.timestamp || 0);
    if (age <= PENDING_TTL_MS && pendingData.timestamp > mostRecentTime) {
      mostRecentPending = pendingData;
      mostRecentKey = key;
      mostRecentTime = pendingData.timestamp;
    }
  }
  if (!mostRecentPending) return;
  const keybindData = { ...mostRecentPending, name: macro.name };
  await updateStoredKeybinds(macro.id, keybindData);
  pendingKeybinds.delete(mostRecentKey);
  ui.notifications.info(game.i18n.format('MACROKEYBINDS.NotificationApplied', { keybind: mostRecentPending.keybind, name: macro.name }));
});

Hooks.on('renderControlsConfig', async () => {
  const oldKeybinds = getUserKeybinds();
  const updatedKeybinds = {};
  for (const macroId in oldKeybinds) {
    const binding = game.keybindings.get('macro-keybinds', `execute.${macroId}`);
    const macro = game.macros.get(macroId);
    if (binding?.length && macro) {
      const keybindData = { key: binding[0].key, modifiers: standardizeModifiers(binding[0].modifiers), name: macro.name };
      updatedKeybinds[macroId] = { ...keybindData, keybind: formatKeybind(keybindData) };
    }
  }
  if (JSON.stringify(oldKeybinds) !== JSON.stringify(updatedKeybinds)) await setUserKeybinds(updatedKeybinds);
});

/** Register the module's two client/user settings. */
function registerSettings() {
  game.settings.register('macro-keybinds', 'disableDefaultHotbar', {
    name: 'MACROKEYBINDS.SettingName',
    hint: 'MACROKEYBINDS.SettingHint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: (value) => (value ? deleteMacroKeybindings() : resetMacroKeybindings())
  });
  game.settings.register('macro-keybinds', 'userKeybinds', { scope: 'user', config: false, type: Object, default: {} });
}

/** Register a Foundry keybinding action for every macro with a stored keybind. */
function registerStoredKeybindings() {
  const keybinds = getUserKeybinds();
  console.log('macro-keybinds | Registering stored keybindings');
  for (const [macroId, data] of Object.entries(keybinds)) {
    if (!data?.key || !macroId || macroId === 'undefined' || macroId === 'null') continue;
    const modifiers = standardizeModifiers(data.modifiers || []);
    try {
      game.keybindings.register('macro-keybinds', `execute.${macroId}`, {
        name: data.name,
        editable: [{ key: data.key, modifiers }],
        onDown: () => {
          game.macros.get(macroId)?.execute();
          return true;
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
      });
    } catch (error) {
      console.error('macro-keybinds | Error registering keybinding:', error);
    }
  }
}

/** Clear all core executeMacro<N> bindings so number keys no longer fire the hotbar. */
async function deleteMacroKeybindings() {
  for (const [actionId] of game.keybindings.bindings) {
    if (!/^core\.executeMacro\d$/.test(actionId)) continue;
    await game.keybindings.set('core', actionId.split('.')[1], []);
  }
}

/** Restore the default Digit0–Digit9 bindings for core executeMacro<N>. */
async function resetMacroKeybindings() {
  for (let i = 0; i < 10; i++) await game.keybindings.set('core', `executeMacro${i}`, [{ key: `Digit${i}`, modifiers: [] }]);
}

/**
 * Write (or delete) the stored keybind for a macro and sync the active binding.
 * @param {string} macroId The macro document id to bind against.
 * @param {object|null} [keybindData] Pass null/undefined to remove the binding.
 * @returns {Promise<void>}
 */
async function updateStoredKeybinds(macroId, keybindData = null) {
  if (!macroId || macroId === 'undefined' || macroId === 'null') {
    console.warn('macro-keybinds | Cannot store keybind for invalid macro ID:', macroId);
    return;
  }
  const keybinds = getUserKeybinds();
  if (keybindData) {
    const modifiers = standardizeModifiers(keybindData.modifiers || []);
    keybinds[macroId] = { key: keybindData.key, name: keybindData.name, modifiers, keybind: formatKeybind({ ...keybindData, modifiers }) };
    if (game.keybindings.bindings.has(`macro-keybinds.execute.${macroId}`)) await game.keybindings.set('macro-keybinds', `execute.${macroId}`, [{ key: keybindData.key, modifiers }]);
  } else delete keybinds[macroId];
  await setUserKeybinds(keybinds);
}

/**
 * Render a keybind as a human-readable string like `CTRL+SHIFT+G`.
 * @param {object} keybind Keybind shape with `key`, optional `simKey`, optional `modifiers`.
 * @returns {string} The formatted modifier+key string, or `''` when no key is set.
 */
function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const displayKey = keybind.simKey || getDisplayKey(keybind.key);
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];
  return [...uniqueModifiers, displayKey].join('+');
}

/**
 * Strip the `Key`/`Digit` prefix from a KeyboardEvent.code for display.
 * @param {string} keyCode Raw KeyboardEvent.code value.
 * @returns {string} Display-friendly key name.
 */
function getDisplayKey(keyCode) {
  if (keyCode.startsWith('Key')) return keyCode.substring(3);
  if (keyCode.startsWith('Digit')) return keyCode.substring(5);
  return keyCode;
}

/**
 * Convert KeyboardEvent.code modifier names (e.g. AltLeft) to Foundry modifier tokens (ALT).
 * @param {Set<string>} modifierSet Active modifier KeyboardEvent.code values.
 * @returns {string[]} Foundry modifier tokens.
 */
function getStandardizedModifiers(modifierSet) {
  return Array.from(modifierSet).map((mod) => {
    if (mod.startsWith('Alt')) return 'ALT';
    if (mod.startsWith('Control')) return 'CONTROL';
    if (mod.startsWith('Shift')) return 'SHIFT';
    if (mod.startsWith('Meta')) return 'META';
    return mod;
  });
}

/**
 * Normalize already-Foundry-formatted modifier names (handles CTRL/OPTION/COMMAND aliases).
 * @param {string[]} modifiers Modifier names in any supported casing/alias.
 * @returns {string[]} Canonical Foundry modifier tokens.
 */
function standardizeModifiers(modifiers) {
  return modifiers.map((mod) => {
    const upperMod = mod.toUpperCase();
    if (upperMod === 'ALT' || upperMod === 'OPTION') return 'ALT';
    if (upperMod === 'CONTROL' || upperMod === 'CTRL') return 'CONTROL';
    if (upperMod === 'SHIFT') return 'SHIFT';
    if (upperMod === 'META' || upperMod === 'COMMAND' || upperMod === 'OS') return 'META';
    return upperMod;
  });
}
