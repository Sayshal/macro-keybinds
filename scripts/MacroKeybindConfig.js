const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MacroKeybindConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'macro-keybinds-settings',
    classes: ['mk-app'],
    tag: 'form',
    form: {
      handler: MacroKeybindConfig.formHandler,
      closeOnSubmit: true,
      submitOnChange: false
    },
    position: {
      height: 'auto',
      width: '650'
    },
    window: {
      icon: 'fa-solid fa-keyboard',
      resizable: false
    }
  };

  get title() {
    return 'Macro Keybinds Configuration';
  }

  static PARTS = {
    form: {
      template: 'modules/macro-keybinds/templates/config.hbs',
      id: 'body',
      classes: ['mk-config-popup']
    },
    footer: {
      template: 'templates/generic/form-footer.hbs', // Using Foundry's generic footer
      id: 'footer',
      classes: ['mk-config-footer']
    }
  };

  async _prepareContext(options) {
    // Get all macros
    const macros = game.macros.contents.map((macro) => ({
      id: macro.id,
      name: macro.name,
      keybind: macro.flags?.['macro-keybinds']?.keybind?.key || '',
      userId: macro.flags?.['macro-keybinds']?.keybind?.userId,
      owner: macro.flags?.['macro-keybinds']?.keybind?.userId === game.user.id,
      ownerName: game.users.get(macro.flags?.['macro-keybinds']?.keybind?.userId)?.name || ''
    }));

    return {
      macros,
      isGM: game.user.isGM,
      // Add flag for showing all or just ones with keybinds
      showAll: false // Could make this a setting if desired
    };
  }

  static async formHandler(event, form, formData) {
    try {
      for (const [macroId, keybind] of Object.entries(formData.object)) {
        const macro = game.macros.get(macroId);
        if (!macro) continue;

        if (keybind) {
          await macro.setFlag('macro-keybinds', 'keybind', {
            key: keybind,
            userId: game.user.id
          });
        } else {
          await macro.unsetFlag('macro-keybinds', 'keybind');
        }
      }

      ui.notifications.info('Macro keybinds saved successfully');
    } catch (error) {
      console.error('Macro Keybinds | Error saving keybinds:', error);
      ui.notifications.error('Error saving macro keybinds');
    }
  }
}
