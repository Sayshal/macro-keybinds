import { MacroKeybindConfig } from './MacroKeybindConfig.js';

Hooks.on('init', () => {
  // Register the config menu
  game.settings.registerMenu('macro-keybinds', 'config', {
    name: 'Configure Macro Keybinds',
    label: 'Configure',
    hint: 'Configure keybinds for your macros.',
    icon: 'fas fa-keyboard',
    type: MacroKeybindConfig,
    restricted: false
  });

  // Register setting for disabling default hotbar
  game.settings.register('macro-keybinds', 'disableDefaultHotbar', {
    name: 'Disable Default Hotbar Numbers',
    hint: 'Disable the default 1-0 number keys for the macro hotbar.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: false,
    onChange: () => window.location.reload()
  });

  game.settings.register('macro-keybinds', 'userKeybinds', {
    scope: 'client',
    config: false,
    type: Object,
    default: {}
  });

  game.keybindings.register('macro-keybinds', 'execute', {
    name: 'Execute Macro Keybind',
    hint: 'Execute macros based on their configured keybinds',
    editable: [], // No default binding
    onDown: (context) => {
      // Get stored keybinds
      const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');
      const pressedKey = formatKeybind({
        key: context.key,
        modifiers: context.modifiers
      });

      // Find matching macro ID
      const macroId = Object.entries(keybinds).find(([id, data]) => data.keybind === pressedKey)?.[0];

      if (macroId) {
        const macro = game.macros.get(macroId);
        if (macro) macro.execute();
      }
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

  // Get all macros with keybinds
  const macrosWithKeybinds = game.macros.contents.filter((m) => m.flags?.['macro-keybinds']?.keybind?.userId === game.user.id);

  // Get current keybind if any
  const keybind = macro.flags?.['macro-keybinds']?.keybind;
  const currentKeybind = keybind ? formatKeybind(keybind) : '';

  // Create the keybind HTML
  const keybindHtml = `
    <div class="form-group">
      <label>Keybind</label>
      <div class="form-fields">
        <input type="text" name="macro-keybind" value="${currentKeybind}" placeholder="Press keys">
      </div>
      <p class="notes">Press key combination, Delete/Backspace to clear. Supports modifier keys (Ctrl, Alt, Shift)</p>
    </div>
  `;

  // Insert after type selection
  html.find('div.form-group:has(select[name="type"])').after(keybindHtml);

  // Handle keybind input
  const input = html.find('input[name="macro-keybind"]');
  let activeModifiers = new Set();

  input.on('keydown', async (event) => {
    event.preventDefault();
    const key = event.key;

    // Track modifier keys
    if (key === 'Control' || key === 'Alt' || key === 'Shift') {
      activeModifiers.add(key);
      return;
    }

    // Handle deletion
    if (key === 'Delete' || key === 'Backspace') {
      await macro.unsetFlag('macro-keybinds', 'keybind');
      game.keybindings.unregister('macro-keybinds', `execute.${macro.id}`);
      input.val('');
      await updateStoredKeybinds(macro.id);
      return;
    }

    // Ignore function keys and other special keys
    if (key.length > 1 && !key.startsWith('F') && !['Tab', 'Enter', 'Space'].includes(key)) return;

    // Build keybind data
    const keybindData = {
      key,
      modifiers: Array.from(activeModifiers),
      userId: game.user.id
    };

    // Format for display
    const keybindString = formatKeybind(keybindData);

    // Check for existing binding
    const existingMacro = macrosWithKeybinds.find((m) => {
      const flag = m.flags?.['macro-keybinds']?.keybind;
      if (!flag || m.id === macro.id) return false;
      return formatKeybind(flag) === keybindString;
    });

    if (existingMacro) {
      await existingMacro.unsetFlag('macro-keybinds', 'keybind');
      game.keybindings.unregister('macro-keybinds', `execute.${existingMacro.id}`);
      ui.notifications.info(`Removed keybind "${keybindString}" from macro "${existingMacro.name}"`);
    }

    // Set new keybind
    await macro.setFlag('macro-keybinds', 'keybind', keybindData);
    input.val(keybindString);

    // Register the new keybind
    await updateStoredKeybinds(macro.id, keybindData);
  });

  input.on('keyup', (event) => {
    const key = event.key;
    if (key === 'Control' || key === 'Alt' || key === 'Shift') {
      activeModifiers.delete(key);
    }
  });
});

// Format keybind for display
function formatKeybind(keybind) {
  if (!keybind?.key) return '';
  const modifiers = keybind.modifiers || [];
  const parts = [...modifiers, keybind.key];
  return parts.join('+');
}

async function updateStoredKeybinds(macroId, keybindData = null) {
  const keybinds = game.settings.get('macro-keybinds', 'userKeybinds');

  if (keybindData) {
    keybinds[macroId] = {
      keybind: formatKeybind(keybindData),
      userId: game.user.id
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
      // Update stored keybind data if needed
      updateStoredKeybinds(macro.id, macro.flags?.['macro-keybinds']?.keybind);
    }
  }
});

function registerMacroKeybind(macro) {
  const keybind = macro.flags?.['macro-keybinds']?.keybind;
  if (!keybind?.key || keybind.userId !== game.user.id) return;

  game.keybindings.register('macro-keybinds', `execute.${macro.id}`, {
    name: `Execute Macro: ${macro.name}`,
    hint: `Execute the macro "${macro.name}" using ${keybind.key}`,
    editable: [
      {
        key: keybind.key,
        modifiers: keybind.modifiers || []
      }
    ],
    onDown: () => macro.execute(),
    restricted: false, // Allow any user to use the keybind
    precedence: 2 // Higher priority than default hotbar bindings
  });
}
