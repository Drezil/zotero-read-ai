import {
  PromptExampleFactory,
  UIExampleFactory,
  CollectionUpdateFactory,
} from "./modules/examples";
import { config } from "../package.json";
import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // BasicExampleFactory.registerPrefs();
  //
  // BasicExampleFactory.registerNotifier();

  // KeyExampleFactory.registerShortcuts();

  await UIExampleFactory.registerExtraColumnWithCustomCell();

  UIExampleFactory.registerItemPaneSection();

  // UIExampleFactory.registerReaderItemPaneSection();

  Zotero.PreferencePanes.register({
    pluginID: 'readai@hu-berlin.de',
    src: 'chrome/content/preferences.xhtml',
    image: 'chrome/content/icons/favicon.svg',
  })

  await onMainWindowLoad(window);
}

async function onMainWindowLoad(win: Window): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  // @ts-ignore This is a moz feature
  window.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-mainWindow.ftl`);

  const popupWin = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  UIExampleFactory.registerStyleSheet();

  UIExampleFactory.registerRightClickMenuItem();

  UIExampleFactory.registerWindowMenu();

  popupWin.changeLine({
    progress: 50,
    text: `[50%] ${getString("startup-begin")}`,
  });

  PromptExampleFactory.registerNormalCommandExample();

  PromptExampleFactory.registerAnonymousCommandExample();

  PromptExampleFactory.registerConditionalCommandExample();

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(5000);

  // addon.hooks.onDialogEvents("dialogExample");
}

async function onMainWindowUnload(win: Window): Promise<void> {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.dialog?.window?.close();
  // Remove addon object
  addon.data.alive = false;
  delete Zotero[config.addonInstance];
}

// /**
//  * This function is just an example of dispatcher for Notify events.
//  * Any operations should be placed in a function to keep this funcion clear.
//  */
// async function onNotify(
//   event: string,
//   type: string,
//   ids: Array<string | number>,
//   extraData: { [key: string]: any },
// ) {
//   // You can add your code to the corresponding notify type
//   ztoolkit.log("notify", event, type, ids, extraData);
//   if (
//     event == "select" &&
//     type == "tab" &&
//     extraData[ids[0]].type == "reader"
//   ) {
//     BasicExampleFactory.exampleNotifierCallback();
//   } else {
//     return;
//   }
// }

/**
 * This function is just an example of dispatcher for Preference UI events.
 * Any operations should be placed in a function to keep this funcion clear.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

// function onShortcuts(type: string) {
//   switch (type) {
//     case "larger":
//       KeyExampleFactory.exampleShortcutLargerCallback();
//       break;
//     case "smaller":
//       KeyExampleFactory.exampleShortcutSmallerCallback();
//       break;
//     default:
//       break;
//   }
// }

// function onDialogEvents(type: string) {
//   switch (type) {
//     case "dialogExample":
//       HelperExampleFactory.dialogExample();
//       break;
//     case "clipboardExample":
//       HelperExampleFactory.clipboardExample();
//       break;
//     case "filePickerExample":
//       HelperExampleFactory.filePickerExample();
//       break;
//     case "progressWindowExample":
//       HelperExampleFactory.progressWindowExample();
//       break;
//     case "vtableExample":
//       HelperExampleFactory.vtableExample();
//       break;
//     default:
//       break;
//   }
// }

async function onUpdate() {
  const popupWin = new ztoolkit.ProgressWindow(config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();
  CollectionUpdateFactory.updateCollection(popupWin);
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  // onNotify,
  onPrefsEvent,
  // onShortcuts,
  // onDialogEvents,
  onUpdate,
};
