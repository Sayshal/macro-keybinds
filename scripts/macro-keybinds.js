Hooks.on('init', () => {
  // Register setting for disabling default hotbar
  game.settings.register('macro-keybinds', 'disableDefaultHotbar', {
    name: 'Disable Default Hotbar Numbers',
    hint: 'Disable the default 1-0 number keys for the macro hotbar.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: handleMacroKeybindings
  });

  game.settings.register('macro-keybinds', 'userKeybinds', {
    scope: 'client',
    config: false,
    type: Object,
    default: {}
  });

  // Register keybindings from settings
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  Object.entries(keybinds).forEach(([macroId, data]) => {
    if (!data?.key) return;

    try {
      game.keybindings.register('macro-keybinds', `execute.${macroId}`, {
        name: `Execute Macro: ${data.name || 'Unknown'}`,
        hint: `Execute macro using ${data.keybind}`, // Changed from data.keybind to data.key
        editable: [
          {
            key: data.keybind,
            modifiers: data.modifiers || []
          }
        ],
        onDown: () => {
          const macro = game.macros.get(macroId);
          if (macro) macro.execute();
        }
      });
    } catch (error) {
      console.error(`Macro Keybinds | Failed to register keybind for macro ${macroId}:`, error);
    }
  });
});

// Handle disabling default hotbar
Hooks.on('ready', () => {
  if (game.settings.get('macro-keybinds', 'disableDefaultHotbar')) {
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

Hooks.on('renderMacroConfig', (app, html, data) => {
  const macro = app.object;
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
  const currentKeybind = keybinds[macro.id]?.keybind || '';
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

    const modifierCodes = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'Meta', 'OsLeft', 'OsRight', 'ShiftLeft', 'ShiftRight'];

    // First, handle modifier keys
    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.add(event.originalEvent.code);
      return;
    }

    // Determine the key to use
    const keyCode = event.originalEvent.code;

    if (keyCode === 'Delete' || keyCode === 'Backspace') {
      await updateStoredKeybinds(macro.id);
      input.val('');
      return;
    }

    const keybindData = {
      key: keyCode,
      modifiers: [
        ...new Set(
          Array.from(activeModifiers).map((mod) => {
            // Map specific modifier codes to their base modifier names
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
      name: macro.name
    };

    const keybindString = formatKeybind(keybindData);
    input.val(keybindString);

    ui.notifications.info('Keybind saved. Reload page to apply changes.');

    // Check for and remove existing bindings
    Object.entries(keybinds).forEach(([id, data]) => {
      if (data.keybind === formatKeybind(keybindData) && id !== macro.id) {
        delete keybinds[id];
      }
    });

    await updateStoredKeybinds(macro.id, keybindData);
    input.val(formatKeybind(keybindData));
  });

  input.on('keyup', (event) => {
    const modifierCodes = ['AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'Meta', 'OsLeft', 'OsRight', 'ShiftLeft', 'ShiftRight'];

    if (modifierCodes.includes(event.originalEvent.code)) {
      activeModifiers.delete(event.originalEvent.code);
    }
  });
});

function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const uniqueModifiers = [...new Set(keybind.modifiers || [])];
  return [...uniqueModifiers, keybind.key].join('+');
}

async function updateStoredKeybinds(macroId, keybindData = null) {
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');

  if (keybindData) {
    keybinds[macroId] = {
      ...keybindData,
      keybind: formatKeybind(keybindData)
    };
  } else {
    delete keybinds[macroId];
  }

  await game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
}

// Hook into macro updates to refresh keybindings
Hooks.on('updateMacro', (macro, changes, options, userId) => {
  if (userId !== game.user.id) return;

  if (changes.name) {
    const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
    if (keybinds[macro.id]) {
      // Update stored keybind data with new name
      keybinds[macro.id].name = changes.name;
      game.settings.set('macro-keybinds', 'userKeybinds', keybinds);
    }
  }
});

function handleMacroKeybindings(checked) {
  if (checked) {
    // If checked, delete the default macro keybindings
    return deleteMacroKeybindings();
  } else {
    // If unchecked, reset to default macro keybindings
    return resetMacroKeybindings();
  }
}

async function deleteMacroKeybindings() {
  // Iterate through all existing keybindings
  for (let [actionId, bindings] of game.keybindings.bindings) {
    // Check if the action is a core execute macro action
    if (actionId.match(/^core\.executeMacro\d$/)) {
      try {
        // Set the bindings to an empty array, effectively removing them
        await game.keybindings.set('core', actionId.split('.')[1], []);
        console.log(`Deleted keybindings for ${actionId}`);
      } catch (error) {
        console.error(`Error deleting keybindings for ${actionId}:`, error);
      }
    }
  }
}

async function resetMacroKeybindings() {
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
      console.log(`Reset keybindings for core.${action}`);
    } catch (error) {
      console.error(`Error resetting keybindings for core.${action}:`, error);
    }
  }
}
