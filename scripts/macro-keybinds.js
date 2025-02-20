Hooks.on('init', () => {
  console.log('macro-keybinds | Initializing module');

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

  game.settings.register('macro-keybinds', 'userKeybinds', {
    scope: 'client',
    config: false,
    type: Object,
    default: {},
    onChange: (value) => {
      console.log('macro-keybinds | userKeybinds setting updated', value);
    }
  });

  // Register keybindings from settings
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  console.log('macro-keybinds | Retrieved userKeybinds', keybinds);

  Object.entries(keybinds).forEach(([macroId, data]) => {
    console.group(`macro-keybinds | Registering keybind for macro ${macroId}`);
    console.log('macro-keybinds | Full data:', { data });

    if (!data?.key) {
      console.log('macro-keybinds | Skipping - no key found');
      console.groupEnd();
      return;
    }

    game.keybindings.register('macro-keybinds', `execute.${macroId}`, {
      name: `Execute Macro: ${data.name || 'Unknown'}`,
      editable: [
        {
          key: data.key, // Ensure this uses the key property
          modifiers: data.modifiers || []
        }
      ],
      onDown: () => {
        const macro = game.macros.get(macroId);
        if (macro) macro.execute();
      },
      onUp: () => {},
      restricted: false,
      reservedModifiers: [],
      precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
    console.groupEnd();
  });
});

// Handle disabling default hotbar
Hooks.on('ready', () => {
  const disableDefaultHotbar = game.settings.get('macro-keybinds', 'disableDefaultHotbar');
  console.log(`macro-keybinds | Checking disableDefaultHotbar: ${disableDefaultHotbar}`);

  if (disableDefaultHotbar) {
    console.log('macro-keybinds | Disabling default hotbar number keys');
    const originalHotbarKeyHandler = Hotbar.prototype._onClickMacro;
    Hotbar.prototype._onClickMacro = function (event, ...args) {
      if (event.key && /^\d$/.test(event.key)) {
        console.log('macro-keybinds | Prevented default hotbar key');
        event.preventDefault();
        return;
      }
      return originalHotbarKeyHandler.call(this, event, ...args);
    };
  }
});

Hooks.on('renderMacroConfig', (app, html, data) => {
  const macro = app.object;
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  const currentKeybind = keybinds[macro.id]?.keybind || null;
  console.log(`macro-keybinds | Current keybind for macro ${macro.id}:`, currentKeybind);

  const modifierCodes = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'Meta', 'OsLeft', 'OsRight', 'ShiftLeft', 'ShiftRight'];

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

  const input = html.find('input[name="macro-keybind"]');
  let activeModifiers = new Set();

  input.on('keydown', async (event) => {
    event.preventDefault();
    console.log('macro-keybinds | Keydown event:', {
      code: event.originalEvent.code,
      key: event.originalEvent.key,
      activeModifiers: [...activeModifiers],
      event: event
    });

    // First, handle modifier keys
    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.add(event.originalEvent.code);
      console.log('macro-keybinds | Added modifier:', event.originalEvent.code);
      return;
    }

    // Determine the key to use
    const keyCode = event.originalEvent.code;

    if (keyCode === 'Delete' || keyCode === 'Backspace') {
      console.log('macro-keybinds | Clearing keybind');
      await updateStoredKeybinds(macro.id);
      input.val('');
      return;
    }

    const keybindData = {
      key: keyCode,
      simKey: event.originalEvent.key.toUpperCase(),
      modifiers: [
        ...new Set(
          Array.from(activeModifiers).map((mod) => {
            switch (mod) {
              case 'AltLeft':
              case 'AltRight':
                return 'Alt';
              case 'ControlLeft':
              case 'ControlRight':
                return 'Control';
              case 'ShiftLeft':
              case 'ShiftRight':
                return 'Shift';
              case 'MetaLeft':
              case 'MetaRight':
              case 'OsLeft':
              case 'OsRight':
              case 'Meta':
                return 'Meta';
              default:
                return mod;
            }
          })
        )
      ],
      userId: game.user.id,
      name: macro.name,
      keybind: null // Explicitly set to null to be calculated by formatKeybind
    };

    console.log('macro-keybinds | Prepared keybind data:', keybindData);

    const keybindString = formatKeybind(keybindData);
    input.val(keybindString);

    ui.notifications.info('Keybind saved. Reload page to apply changes.');

    // Check for and remove existing bindings
    Object.entries(keybinds).forEach(([id, data]) => {
      if (data.keybind === formatKeybind(keybindData) && id !== macro.id) {
        console.log(`macro-keybinds | Removing existing keybind for macro ${id}`);
        delete keybinds[id];
      }
    });

    await updateStoredKeybinds(macro.id, keybindData);
    input.val(formatKeybind(keybindData));
  });

  input.on('keyup', (event) => {
    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.delete(event.originalEvent.code);
      console.log('macro-keybinds | Removed modifier:', event.originalEvent.code);
    }
  });
});

function formatKeybind(keybind) {
  console.log('macro-keybinds | Formatting keybind:', { keybind: keybind });
  if (!keybind?.key) return '';
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];
  const formattedKeybind = [...uniqueModifiers, keybind.simKey || keybind.key].join('+');
  console.log('macro-keybinds | Formatted keybind:', formattedKeybind);
  return formattedKeybind;
}

async function updateStoredKeybinds(macroId, keybindData = null) {
  console.group(`macro-keybinds | updateStoredKeybinds for ${macroId}`);
  console.log('Input keybindData:', keybindData);

  // Retrieve the current keybinds
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  console.log('Current keybinds before update:', keybinds);

  if (keybindData) {
    // Transform modifiers to uppercase
    const formattedModifiers = (keybindData.modifiers || []).map((mod) => {
      switch (mod) {
        case 'Alt':
          return 'ALT';
        case 'Control':
          return 'CONTROL';
        case 'Shift':
          return 'SHIFT';
        case 'Meta':
          return 'META';
        default:
          return mod.toUpperCase();
      }
    });

    // Ensure we're using the correct key format
    keybinds[macroId] = {
      key: keybindData.key,
      name: keybindData.name,
      userId: keybindData.userId,
      modifiers: formattedModifiers,
      keybind: formatKeybind({ ...keybindData, modifiers: formattedModifiers })
    };

    // Update the keybindings using set()
    try {
      await game.keybindings.set('macro-keybinds', `execute.${macroId}`, [
        {
          key: keybindData.key,
          modifiers: formattedModifiers
        }
      ]);
    } catch (error) {
      console.error('macro-keybinds | Error setting keybindings:', error);
    }

    console.log('Updated keybinds:', keybinds);
  } else {
    delete keybinds[macroId];
    console.log('Deleted keybind for macroId');
  }

  // Use a try-catch to ensure the setting is saved
  try {
    await game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
    console.log('Settings saved successfully');

    // Verify the settings were saved
    const finalSettings = game.settings.get('macro-keybinds', 'userKeybinds');
    console.log('Final settings after save:', finalSettings);
  } catch (error) {
    console.error('macro-keybinds | Error saving settings:', error);
  }

  console.groupEnd();
}

Hooks.on('updateMacro', async (macro, changes, options, userId) => {
  if (userId !== game.user.id) return;

  if (changes.name) {
    console.log(`macro-keybinds | Macro name updated for ${macro.id}`);
    const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');

    if (keybinds[macro.id]) {
      // Update stored keybind data with new name
      keybinds[macro.id].name = changes.name;

      try {
        // Transform modifiers to uppercase
        const formattedModifiers = (keybinds[macro.id].modifiers || []).map((mod) => {
          switch (mod) {
            case 'Alt':
              return 'ALT';
            case 'Control':
              return 'CONTROL';
            case 'Shift':
              return 'SHIFT';
            case 'Meta':
              return 'META';
            default:
              return mod.toUpperCase();
          }
        });

        // Update the keybindings using set()
        await game.keybindings.set('macro-keybinds', `execute.${macro.id}`, [
          {
            key: keybinds[macro.id].key,
            modifiers: formattedModifiers
          }
        ]);

        // Save updated settings
        await game.settings.set('macro-keybinds', 'userKeybinds', keybinds);

        console.log(`macro-keybinds | Updated macro name in keybinds to ${changes.name}`);
      } catch (error) {
        console.error('macro-keybinds | Error updating keybindings:', error);
      }
    }
  }
});

function handleMacroKeybindings(checked) {
  console.log(`macro-keybinds | Handling macro keybindings: ${checked}`);
  if (checked) {
    // If checked, delete the default macro keybindings
    return deleteMacroKeybindings();
  } else {
    // If unchecked, reset to default macro keybindings
    return resetMacroKeybindings();
  }
}

async function deleteMacroKeybindings() {
  console.log('macro-keybinds | Deleting macro keybindings');
  // Iterate through all existing keybindings
  for (let [actionId, bindings] of game.keybindings.bindings) {
    // Check if the action is a core execute macro action
    if (actionId.match(/^core\.executeMacro\d$/)) {
      try {
        // Set the bindings to an empty array, effectively removing them
        await game.keybindings.set('core', actionId.split('.')[1], []);
        console.log(`macro-keybinds | Deleted keybindings for ${actionId}`);
      } catch (error) {
        console.error(`macro-keybinds | Error deleting keybindings for ${actionId}:`, error);
      }
    }
  }
}

async function resetMacroKeybindings() {
  console.log('macro-keybinds | Resetting macro keybindings');
  // Default macro keybindings (adjust as needed)
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
      console.log(`macro-keybinds | Reset keybindings for core.${action}`);
    } catch (error) {
      console.error(`macro-keybinds | Error resetting keybindings for core.${action}:`, error);
    }
  }
}
