/* -------------------------------------------- */
/*  Type Definitions                            */
/* -------------------------------------------- */

/**
 * @typedef {Object} MacroKeybindData
 * @property {string} key - The key code for the keybind (e.g., "KeyC")
 * @property {string[]} modifiers - Array of modifier keys (e.g., ["SHIFT", "ALT"])
 * @property {string} userId - The ID of the user who created this keybind
 * @property {string} name - The name of the macro this keybind executes
 * @property {string} keybind - Human-readable representation of the key combination
 */

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Initialize the module
 */
Hooks.on('init', () => {
  console.log('macro-keybinds | Initializing module');
  registerSettings();
  registerStoredKeybindings();
});

/**
 * Disable default macros when ready
 */
Hooks.on('ready', () => {
  const disableDefaultHotbar = game.settings.get('macro-keybinds', 'disableDefaultHotbar');
  console.log(`macro-keybinds | Checking disableDefaultHotbar: ${disableDefaultHotbar}`);

  if (disableDefaultHotbar) {
    console.log('macro-keybinds | Disabling default hotbar number keys');
    const originalHotbarKeyHandler = Hotbar.prototype._onClickMacro;
    Hotbar.prototype._onClickMacro = function (event, ...args) {
      if (event.key && /^\d$/.test(event.key)) {
        event.preventDefault();
        return;
      }
      return originalHotbarKeyHandler.call(this, event, ...args);
    };
  }
});

/**
 * Render keybind UI in macro configuration
 */
Hooks.on('renderMacroConfig', (app, html, data) => {
  const macro = app.object;
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  const currentKeybind = keybinds[macro.id]?.keybind || '';

  // Define which keys are modifiers
  const modifierCodes = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight'];

  // Add keybind input to the form
  const keybindHtml = `
    <div class="form-group">
      <label>Keybind</label>
      <div class="form-fields">
        <input type="text" name="macro-keybind" value="${currentKeybind}" placeholder="Press keys">
      </div>
      <p class="notes">Press key combination, Delete/Backspace to clear. Supports modifier keys (Ctrl, Alt, Shift)</p>
    </div>
  `;

  html.find('div.form-group:has(select[name="type"])').after(keybindHtml);

  // Set up event handlers for keybind input
  const input = html.find('input[name="macro-keybind"]');
  let activeModifiers = new Set();

  input.on('keydown', async (event) => {
    event.preventDefault();

    // Handle modifier keys
    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.add(event.originalEvent.code);
      return;
    }

    // Handle deletion keys
    if (event.originalEvent.code === 'Delete' || event.originalEvent.code === 'Backspace') {
      await updateStoredKeybinds(macro.id);
      input.val('');
      return;
    }

    // Create keybind data object
    const keybindData = {
      key: event.originalEvent.code,
      simKey: event.originalEvent.key.toUpperCase(),
      modifiers: getStandardizedModifiers(activeModifiers),
      userId: game.user.id,
      name: macro.name
    };

    // Format keybind string for display
    const keybindString = formatKeybind(keybindData);
    input.val(keybindString);

    // Check for and remove duplicate bindings
    const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
    Object.entries(keybinds).forEach(([id, data]) => {
      if (data.keybind === keybindString && id !== macro.id) {
        console.log(`macro-keybinds | Removing duplicate keybind for macro ${id}`);
        delete keybinds[id];
      }
    });

    // Save the new keybind
    await updateStoredKeybinds(macro.id, keybindData);

    // Notify user
    ui.notifications.info('Keybind saved. Reload page to apply changes.');
  });

  // Handle keyup to remove modifiers
  input.on('keyup', (event) => {
    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.delete(event.originalEvent.code);
    }
  });
});

/**
 * Update macro name in keybind data when macro is updated
 */
Hooks.on('updateMacro', async (macro, changes, options, userId) => {
  if (userId !== game.user.id) return;

  if (changes.name) {
    console.log(`macro-keybinds | Macro name updated for ${macro.id}`);
    const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');

    if (keybinds[macro.id]) {
      // Update stored keybind data with new name
      keybinds[macro.id].name = changes.name;

      try {
        // Update the keybinding data
        game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
        console.log(`macro-keybinds | Updated macro name in keybinds to ${changes.name}`);
      } catch (error) {
        console.error('macro-keybinds | Error updating keybindings:', error);
      }
    }
  }
});

/**
 * Update keybindings after configuration dialog is closed
 */
Hooks.on('renderKeybindingsConfig', async (app, html, data) => {
  // Get current keybinds
  const oldKeybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  const updatedKeybinds = {};

  // Update keybinds from the current Foundry keybinding registry
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

      updatedKeybinds[macroId] = {
        ...keybindData,
        keybind: formatKeybind(keybindData)
      };
    }
  }

  // Only update if there are changes
  if (JSON.stringify(oldKeybinds) !== JSON.stringify(updatedKeybinds)) {
    await game.settings.set('macro-keybinds', 'userKeybinds', updatedKeybinds);
  }
});

/* -------------------------------------------- */
/*  Settings Registration                       */
/* -------------------------------------------- */

/**
 * Register module settings
 */
function registerSettings() {
  // Register setting for disabling default hotbar
  game.settings.register('macro-keybinds', 'disableDefaultHotbar', {
    name: 'Disable Default Hotbar Numbers',
    hint: 'Disable the default 1-0 number keys for the macro hotbar.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: (value) => {
      console.log(`macro-keybinds | disableDefaultHotbar changed to: ${value}`);
      handleMacroKeybindings(value);
    }
  });

  // Register storage for user-defined keybindings
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

/* -------------------------------------------- */
/*  Keybinding Registration                     */
/* -------------------------------------------- */

/**
 * Register keybindings from stored settings during initialization
 */
function registerStoredKeybindings() {
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  console.log('macro-keybinds | Registering stored keybindings');

  Object.entries(keybinds).forEach(([macroId, data]) => {
    if (!data?.key) {
      return;
    }

    // Ensure modifiers are in the correct format for registration
    const standardizedModifiers = standardizeModifiers(data.modifiers || []);

    // Register the keybinding
    game.keybindings.register('macro-keybinds', `execute.${macroId}`, {
      name: `Execute Macro: ${data.name || 'Unknown'}`,
      editable: [
        {
          key: data.key,
          modifiers: standardizedModifiers
        }
      ],
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
  });
}

/* -------------------------------------------- */
/*  Keybinding Management                       */
/* -------------------------------------------- */

/**
 * Handle enabling/disabling default macro keybindings
 * @param {boolean} checked - Whether to disable default keybindings
 * @returns {Promise<void>}
 */
function handleMacroKeybindings(checked) {
  if (checked) {
    return deleteMacroKeybindings();
  } else {
    return resetMacroKeybindings();
  }
}

/**
 * Delete default macro keybindings
 * @returns {Promise<void>}
 */
async function deleteMacroKeybindings() {
  console.log('macro-keybinds | Deleting default macro keybindings');

  // Iterate through all existing keybindings
  for (let [actionId, bindings] of game.keybindings.bindings) {
    // Check if the action is a core execute macro action
    if (actionId.match(/^core\.executeMacro\d$/)) {
      try {
        // Set the bindings to an empty array, effectively removing them
        await game.keybindings.set('core', actionId.split('.')[1], []);
      } catch (error) {
        console.error(`macro-keybinds | Error deleting keybindings for ${actionId}:`, error);
      }
    }
  }
}

/**
 * Reset macro keybindings to defaults
 * @returns {Promise<void>}
 */
async function resetMacroKeybindings() {
  console.log('macro-keybinds | Resetting macro keybindings');

  // Default macro keybindings
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

  // Reset each action to its default binding
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
 * @param {string} macroId - ID of the macro
 * @param {Object|null} keybindData - Keybind data to store, or null to remove
 * @returns {Promise<void>}
 */
async function updateStoredKeybinds(macroId, keybindData = null) {
  // Retrieve current keybinds
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');

  if (keybindData) {
    // Standardize modifiers for storage
    const standardizedModifiers = standardizeModifiers(keybindData.modifiers || []);

    // Update the keybind data
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

    // Update the keybinding if it's already registered
    try {
      // Check if this keybind action exists first
      const actionExists = game.keybindings.bindings.has(`macro-keybinds.execute.${macroId}`);

      if (actionExists) {
        await game.keybindings.set('macro-keybinds', `execute.${macroId}`, [
          {
            key: keybindData.key,
            modifiers: standardizedModifiers
          }
        ]);
      }
    } catch (error) {
      console.error('macro-keybinds | Error setting keybindings:', error);
    }
  } else {
    // Remove the keybind
    delete keybinds[macroId];
  }

  // Save updated keybinds
  try {
    await game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
  } catch (error) {
    console.error('macro-keybinds | Error saving settings:', error);
  }
}

/* -------------------------------------------- */
/*  Utility Functions                           */
/* -------------------------------------------- */

/**
 * Format a keybind object into a human-readable string
 * @param {Object} keybind - The keybind data object
 * @returns {string} Formatted keybind string (e.g., "SHIFT+C")
 */
function formatKeybind(keybind) {
  if (!keybind?.key) return '';

  // Get a standardized display version of the key
  const displayKey = keybind.simKey || getDisplayKey(keybind.key);

  // Get standardized display versions of modifiers
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];

  // Join everything with + signs
  const formattedKeybind = [...uniqueModifiers, displayKey].join('+');
  return formattedKeybind;
}

/**
 * Convert a key code to a display-friendly format
 * @param {string} keyCode - The key code (e.g., "KeyC")
 * @returns {string} Display-friendly key name (e.g., "C")
 */
function getDisplayKey(keyCode) {
  // Handle special cases
  if (keyCode.startsWith('Key')) {
    return keyCode.substring(3);
  }
  if (keyCode.startsWith('Digit')) {
    return keyCode.substring(5);
  }

  // For other keys, return as is
  return keyCode;
}

/**
 * Convert a set of modifier key codes into standardized modifier names
 * @param {Set<string>} modifierSet - Set of modifier key codes
 * @returns {string[]} Array of standardized modifier names
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
 * @param {string[]} modifiers - Array of modifier keys
 * @returns {string[]} Standardized modifier keys
 */
function standardizeModifiers(modifiers) {
  return modifiers.map((mod) => {
    // Convert to uppercase and ensure consistent format
    const upperMod = mod.toUpperCase();

    // Handle common variations
    if (upperMod === 'ALT' || upperMod === 'OPTION') return 'ALT';
    if (upperMod === 'CONTROL' || upperMod === 'CTRL') return 'CONTROL';
    if (upperMod === 'SHIFT') return 'SHIFT';
    if (upperMod === 'META' || upperMod === 'COMMAND' || upperMod === 'OS') return 'META';

    return upperMod;
  });
}
