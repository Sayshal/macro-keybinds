import { MODULE } from './constants.mjs';
import { formatKeybind, getStandardizedModifiers, getUserKeybinds, isModifierCode, setUserKeybinds, standardizeModifiers, updateStoredKeybinds } from './keybinds.mjs';

/** @type {Map<string, object>} Keybinds pressed on an unsaved macro, keyed by the config app's temporary id. */
const pendingKeybinds = new Map();

/**
 * Build the keybind form group injected into the macro config.
 * @param {string} value The keybind currently bound to this macro.
 * @param {boolean} isNewMacro Whether the macro has yet to be saved.
 * @returns {HTMLElement} The populated form group.
 */
function createKeybindGroup(value, isNewMacro) {
  const { createFormGroup, createTextInput } = foundry.applications.fields;
  const input = createTextInput({ name: 'macro-keybind', value, placeholder: _loc('MACROKEYBINDS.Config.Placeholder') });
  const group = createFormGroup({
    label: 'MACROKEYBINDS.Config.Label',
    hint: isNewMacro ? 'MACROKEYBINDS.Config.PendingHint' : 'MACROKEYBINDS.Config.Hint',
    input,
    localize: true
  });
  if (isNewMacro) group.querySelector('p.hint').className = 'notification warning';
  return group;
}

/**
 * Record a keypress against the macro being configured, dropping any other macro bound to the same combination.
 * @param {KeyboardEvent} event The keydown raised on the keybind field.
 * @param {object} context The macro being configured and the state of its keybind field.
 * @param {object} context.macro The macro document the config window is editing.
 * @param {string} [context.macroId] The saved macro id, absent until the macro is first saved.
 * @param {string} context.tempId The saved macro id, or a per-window id while the macro is unsaved.
 * @param {boolean} context.isNewMacro Whether the macro has yet to be saved.
 * @param {Set<string>} context.activeModifiers Modifier codes currently held down in the field.
 * @param {HTMLInputElement} context.input The keybind field.
 * @returns {Promise<void>}
 */
async function onKeybindPressed(event, { macro, macroId, tempId, isNewMacro, activeModifiers, input }) {
  event.preventDefault();
  if (isModifierCode(event.code)) {
    activeModifiers.add(event.code);
    return;
  }
  if (event.code === 'Delete' || event.code === 'Backspace') {
    if (isNewMacro) pendingKeybinds.delete(tempId);
    else await updateStoredKeybinds(macroId);
    input.value = '';
    return;
  }
  const keybindData = { key: event.code, simKey: event.key.toUpperCase(), modifiers: getStandardizedModifiers(activeModifiers), name: macro.name };
  const keybindString = formatKeybind(keybindData);
  input.value = keybindString;
  const keybinds = getUserKeybinds();
  for (const [id, data] of Object.entries(keybinds)) {
    if (data.keybind === keybindString && id !== macroId) {
      ATLAS.log(3, `Duplicate keybind removed for macro ${id}`);
      delete keybinds[id];
    }
  }
  for (const [pendingId, pendingData] of pendingKeybinds.entries()) if (pendingData.keybind === keybindString && pendingId !== tempId) pendingKeybinds.delete(pendingId);
  if (isNewMacro) {
    pendingKeybinds.set(tempId, { ...keybindData, keybind: keybindString, timestamp: Date.now() });
    ui.notifications.info('MACROKEYBINDS.Config.PendingHint');
  } else {
    await updateStoredKeybinds(macroId, keybindData);
    ui.notifications.info('MACROKEYBINDS.Notify.Saved');
  }
}

/**
 * Add the keybind field to an open macro config and wire it to the keyboard.
 * @param {foundry.applications.api.ApplicationV2} app The macro config application.
 * @param {HTMLElement} html The rendered application element.
 * @returns {void}
 */
function injectKeybindField(app, html) {
  const macro = app?.document;
  const macroId = macro?.id;
  const isNewMacro = !macroId;
  const tempId = isNewMacro ? `temp-${app.id}` : macroId;
  const currentKeybind = (isNewMacro ? pendingKeybinds.get(tempId)?.keybind : getUserKeybinds()[macroId]?.keybind) || '';
  const typeFormGroup = html.querySelector('select[name="type"]')?.closest('div.form-group');
  if (!typeFormGroup) {
    ATLAS.log(2, 'Could not find type form group');
    return;
  }
  const group = createKeybindGroup(currentKeybind, isNewMacro);
  typeFormGroup.after(group);
  const input = group.querySelector('input[name="macro-keybind"]');
  const activeModifiers = new Set();
  input.addEventListener('keydown', (event) => onKeybindPressed(event, { macro, macroId, tempId, isNewMacro, activeModifiers, input }));
  input.addEventListener('keyup', (event) => {
    if (isModifierCode(event.code)) activeModifiers.delete(event.code);
  });
}

/**
 * Attach the most recent unexpired pending keybind to a macro the moment it is created.
 * @param {Macro} macro The newly created macro.
 * @returns {Promise<void>}
 */
async function claimPendingKeybind(macro) {
  const now = Date.now();
  let mostRecentPending = null;
  let mostRecentKey = null;
  let mostRecentTime = 0;
  for (const [key, pendingData] of pendingKeybinds.entries()) {
    const age = now - (pendingData.timestamp || 0);
    if (age <= MODULE.PENDING_TTL_MS && pendingData.timestamp > mostRecentTime) {
      mostRecentPending = pendingData;
      mostRecentKey = key;
      mostRecentTime = pendingData.timestamp;
    }
  }
  if (!mostRecentPending) return;
  await updateStoredKeybinds(macro.id, { ...mostRecentPending, name: macro.name });
  pendingKeybinds.delete(mostRecentKey);
  ui.notifications.info('MACROKEYBINDS.Notify.Applied', { format: { keybind: mostRecentPending.keybind, name: macro.name } });
}

/**
 * Fold any edit made in Foundry's own Configure Controls window back into the stored keybinds.
 * @returns {Promise<void>}
 */
async function syncFromControlsConfig() {
  const oldKeybinds = getUserKeybinds();
  const updatedKeybinds = {};
  for (const macroId in oldKeybinds) {
    const macro = game.macros.get(macroId);
    if (!macro) continue;
    if (!game.keybindings.actions.has(`${MODULE.ID}.execute.${macroId}`)) {
      updatedKeybinds[macroId] = oldKeybinds[macroId];
      continue;
    }
    const binding = game.keybindings.get(MODULE.ID, `execute.${macroId}`);
    if (!binding?.length) continue;
    const keybindData = { key: binding[0].key, modifiers: standardizeModifiers(binding[0].modifiers), name: macro.name };
    updatedKeybinds[macroId] = { ...keybindData, keybind: formatKeybind(keybindData) };
  }
  if (!foundry.utils.objectsEqual(oldKeybinds, updatedKeybinds)) await setUserKeybinds(updatedKeybinds);
}

/**
 * Wire the macro config field and the three document hooks that keep stored keybinds current.
 * @returns {void}
 */
export function registerHooks() {
  Hooks.on('renderMacroConfig', injectKeybindField);
  Hooks.on('updateMacro', async (macro, changes, _options, userId) => {
    if (userId !== game.user.id || !changes.name) return;
    const keybinds = getUserKeybinds();
    if (!keybinds[macro.id]) return;
    keybinds[macro.id].name = changes.name;
    await setUserKeybinds(keybinds);
  });
  Hooks.on('createMacro', async (macro, _options, userId) => {
    if (userId !== game.user.id) return;
    await claimPendingKeybind(macro);
  });
  Hooks.on('renderControlsConfig', syncFromControlsConfig);
}
