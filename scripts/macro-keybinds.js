const pendingKeybinds = new Map();

/**
 * Get user keybinds with type safety
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
 * Set user keybinds with type safety
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

Hooks.on('ready', () => {
  const disableDefaultHotbar = game.settings.get('macro-keybinds', 'disableDefaultHotbar');
  console.log(`macro-keybinds | Checking disableDefaultHotbar: ${disableDefaultHotbar}`);
  if (disableDefaultHotbar) {
    console.log('macro-keybinds | Disabling default hotbar number keys');
    const HotbarClass = foundry?.applications?.ui?.Hotbar || Hotbar;
    const originalHotbarKeyHandler = HotbarClass.prototype._onClickMacro;
    HotbarClass.prototype._onClickMacro = function (event, ...args) {
      if (event.key && /^\d$/.test(event.key)) {
        event.preventDefault();
        return;
      }
      return originalHotbarKeyHandler.call(this, event, ...args);
    };
  }
});

Hooks.on('renderMacroConfig', (app, html, data) => {
  const macro = app?.document || app?.object || data?.document || data?.source;
  const macroId = macro?._id || macro?.id;
  const isNewMacro = !macroId || macroId === null;
  const tempId = isNewMacro ? `temp-${app.id}` : macroId;
  const keybinds = getUserKeybinds();
  const currentKeybind = isNewMacro ? pendingKeybinds.get(tempId)?.keybind || '' : keybinds[macroId]?.keybind || '';
  const modifierCodes = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'];
  const typeSelect = html.querySelector('select[name="type"]');
  const typeFormGroup = typeSelect?.closest('div.form-group');
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
  let activeModifiers = new Set();
  input.addEventListener('keydown', async (event) => {
    event.preventDefault();
    if (modifierCodes.includes(event.code)) {
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
      userId: game.user.id,
      name: macro.name
    };
    const keybindString = formatKeybind(keybindData);
    input.value = keybindString;
    const keybinds = getUserKeybinds();
    Object.entries(keybinds).forEach(([id, data]) => {
      if (data.keybind === keybindString && id !== macroId) {
        console.log(game.i18n.format('MACROKEYBINDS.RemovingDuplicate', { id }));
        delete keybinds[id];
      }
    });
    for (const [pendingId, pendingData] of pendingKeybinds.entries()) {
      if (pendingData.keybind === keybindString && pendingId !== tempId) pendingKeybinds.delete(pendingId);
    }
    if (isNewMacro) {
      pendingKeybinds.set(tempId, {
        ...keybindData,
        keybind: keybindString,
        originalName: macro.name,
        timestamp: Date.now(),
        formId: app.id
      });
      ui.notifications.info(game.i18n.localize('MACROKEYBINDS.NotificationWillApply'));
    } else {
      await updateStoredKeybinds(macroId, keybindData);
      ui.notifications.info(game.i18n.localize('MACROKEYBINDS.NotificationSaved'));
    }
  });
  input.addEventListener('keyup', (event) => {
    if (modifierCodes.includes(event.code)) activeModifiers.delete(event.code);
  });
});

Hooks.on('updateMacro', async (macro, changes, options, userId) => {
  if (userId !== game.user.id) return;
  const macroId = macro._id || macro.id;
  if (changes.name) {
    console.log(game.i18n.format('MACROKEYBINDS.UpdatingName', { id: macroId }));
    const keybinds = getUserKeybinds();
    if (keybinds[macroId]) {
      keybinds[macroId].name = changes.name;
      try {
        await setUserKeybinds(keybinds);
        console.log(game.i18n.format('MACROKEYBINDS.UpdatedName', { name: changes.name }));
      } catch (error) {
        console.error('macro-keybinds | Error updating keybindings:', error);
      }
    }
  }
});

Hooks.on('createMacro', async (macro, options, userId) => {
  if (userId !== game.user.id) return;
  const macroId = macro._id || macro.id;
  const now = Date.now();
  const timeThreshold = 30000;
  let mostRecentPending = null;
  let mostRecentKey = null;
  let mostRecentTime = 0;
  for (const [key, pendingData] of pendingKeybinds.entries()) {
    const age = now - (pendingData.timestamp || 0);
    if (age <= timeThreshold && pendingData.timestamp > mostRecentTime) {
      mostRecentPending = pendingData;
      mostRecentKey = key;
      mostRecentTime = pendingData.timestamp;
    }
  }
  if (mostRecentPending) {
    console.log(game.i18n.format('MACROKEYBINDS.ApplyingPending', { name: macro.name }));
    const keybindData = { ...mostRecentPending, name: macro.name, userId: game.user.id };
    await updateStoredKeybinds(macroId, keybindData);
    pendingKeybinds.delete(mostRecentKey);
    ui.notifications.info(
      game.i18n.format('MACROKEYBINDS.NotificationApplied', {
        keybind: mostRecentPending.keybind,
        name: macro.name
      })
    );
  }
});

Hooks.on('renderKeybindingsConfig', async (app, html, data) => {
  const oldKeybinds = getUserKeybinds();
  const updatedKeybinds = {};
  for (const macroId in oldKeybinds) {
    const binding = game.keybindings.get('macro-keybinds', `execute.${macroId}`);
    const macro = game.macros.get(macroId);
    if (binding && binding.length > 0 && macro) {
      const keybindData = {
        key: binding[0].key,
        modifiers: standardizeModifiers(binding[0].modifiers),
        userId: game.user.id,
        name: macro.name
      };
      updatedKeybinds[macroId] = { ...keybindData, keybind: formatKeybind(keybindData) };
    }
  }
  if (JSON.stringify(oldKeybinds) !== JSON.stringify(updatedKeybinds)) await setUserKeybinds(updatedKeybinds);
});

function registerSettings() {
  game.settings.register('macro-keybinds', 'disableDefaultHotbar', {
    name: game.i18n.localize('MACROKEYBINDS.SettingName'),
    hint: game.i18n.localize('MACROKEYBINDS.SettingHint'),
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: (value) => {
      console.log(game.i18n.format('MACROKEYBINDS.SettingChanged', { value }));
      handleMacroKeybindings(value);
    }
  });
  game.settings.register('macro-keybinds', 'userKeybinds', {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
    onChange: (value) => {
      console.log('macro-keybinds | userKeybinds setting updated');
    }
  });
}

function registerStoredKeybindings() {
  const keybinds = getUserKeybinds();
  console.log('macro-keybinds | Registering stored keybindings');
  Object.entries(keybinds).forEach(([macroId, data]) => {
    if (!data?.key) return;
    if (!macroId || macroId === 'undefined' || macroId === 'null') return;
    const standardizedModifiers = standardizeModifiers(data.modifiers || []);
    try {
      game.keybindings.register('macro-keybinds', `execute.${macroId}`, {
        name: game.i18n.format('MACROKEYBINDS.ExecuteName', { name: data.name || 'Unknown' }),
        editable: [{ key: data.key, modifiers: standardizedModifiers }],
        onDown: () => {
          const macro = game.macros.get(macroId);
          if (macro) macro.execute();
          return true;
        },
        onUp: () => {},
        restricted: false,
        reservedModifiers: [],
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
      });
    } catch (error) {
      console.error('macro-keybinds | Error registering keybinding:', error);
    }
  });
}

function handleMacroKeybindings(checked) {
  if (checked) return deleteMacroKeybindings();
  else return resetMacroKeybindings();
}

async function deleteMacroKeybindings() {
  console.log('macro-keybinds | Deleting default macro keybindings');
  for (let [actionId, bindings] of game.keybindings.bindings) {
    const isCoreMacroAction = actionId.match(/^core\.executeMacro\d$/);
    if (isCoreMacroAction) {
      try {
        await game.keybindings.set('core', actionId.split('.')[1], []);
      } catch (error) {
        console.error(`macro-keybinds | Error deleting keybindings for ${actionId}:`, error);
      }
    }
  }
}

async function resetMacroKeybindings() {
  console.log('macro-keybinds | Resetting macro keybindings');
  const defaultMacroBindings = {
    executeMacro0: [{ key: 'Digit0', modifiers: [] }],
    executeMacro1: [{ key: 'Digit1', modifiers: [] }],
    executeMacro2: [{ key: 'Digit2', modifiers: [] }],
    executeMacro3: [{ key: 'Digit3', modifiers: [] }],
    executeMacro4: [{ key: 'Digit4', modifiers: [] }],
    executeMacro5: [{ key: 'Digit5', modifiers: [] }],
    executeMacro6: [{ key: 'Digit6', modifiers: [] }],
    executeMacro7: [{ key: 'Digit7', modifiers: [] }],
    executeMacro8: [{ key: 'Digit8', modifiers: [] }],
    executeMacro9: [{ key: 'Digit9', modifiers: [] }]
  };

  for (let [action, bindings] of Object.entries(defaultMacroBindings)) {
    try {
      await game.keybindings.set('core', action, bindings);
    } catch (error) {
      console.error(`macro-keybinds | Error resetting keybindings for core.${action}:`, error);
    }
  }
}

/**
 * Update stored keybindings for a macro
 */
async function updateStoredKeybinds(macroId, keybindData = null) {
  if (!macroId || macroId === 'undefined' || macroId === 'null') {
    console.warn('macro-keybinds | Cannot store keybind for invalid macro ID:', macroId);
    return;
  }
  const keybinds = getUserKeybinds();
  if (keybindData) {
    const standardizedModifiers = standardizeModifiers(keybindData.modifiers || []);
    keybinds[macroId] = {
      key: keybindData.key,
      name: keybindData.name,
      userId: keybindData.userId,
      modifiers: standardizedModifiers,
      keybind: formatKeybind({
        ...keybindData,
        modifiers: standardizedModifiers
      })
    };
    try {
      const actionExists = game.keybindings.bindings.has(`macro-keybinds.execute.${macroId}`);
      if (actionExists) await game.keybindings.set('macro-keybinds', `execute.${macroId}`, [{ key: keybindData.key, modifiers: standardizedModifiers }]);
    } catch (error) {
      console.error('macro-keybinds | Error setting keybindings:', error);
    }
  } else delete keybinds[macroId];
  try {
    await setUserKeybinds(keybinds);
  } catch (error) {
    console.error('macro-keybinds | Error saving settings:', error);
  }
}

/**
 * Format a keybind object into a human-readable string
 */
function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const displayKey = keybind.simKey || getDisplayKey(keybind.key);
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];
  const formattedKeybind = [...uniqueModifiers, displayKey].join('+');
  return formattedKeybind;
}

/**
 * Convert a key code to a display-friendly format
 */
function getDisplayKey(keyCode) {
  if (keyCode.startsWith('Key')) return keyCode.substring(3);
  if (keyCode.startsWith('Digit')) return keyCode.substring(5);
  return keyCode;
}

/**
 * Convert a set of modifier key codes into standardized modifier names
 */
function getStandardizedModifiers(modifierSet) {
  return Array.from(modifierSet).map((mod) => {
    if (mod.startsWith('Alt')) return 'ALT';
    if (mod.startsWith('Control')) return 'CONTROL';
    if (mod.startsWith('Shift')) return 'SHIFT';
    if (mod.startsWith('Meta') || mod.startsWith('Os')) return 'META';
    return mod;
  });
}

/**
 * Standardize modifiers to ensure consistent format
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
