import { ProgressWindowHelper } from "zotero-plugin-toolkit/dist/helpers/progressWindow";
import { config } from "../../package.json";
import { getLocaleID, getString } from "../utils/locale";

function example(
  target: any,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) {
  const original = descriptor.value;
  descriptor.value = function(...args: any) {
    try {
      ztoolkit.log(`Calling example ${target.name}.${String(propertyKey)}`);
      return original.apply(this, args);
    } catch (e) {
      ztoolkit.log(`Error in example ${target.name}.${String(propertyKey)}`, e);
      throw e;
    }
  };
  return descriptor;
}

interface ServerAnswer {
  summary: string | undefined;
  error: string | undefined;
}

async function hasPDFAttachment(item: Zotero.Item) {
  let hasAtt = false;
  for (const attID of item.getAttachments()) {
    const att = await Zotero.Items.getAsync(attID);
    if (att.isPDFAttachment()) {
      hasAtt = true;
      break;
    }
  }
  return hasAtt
}

export class CollectionUpdateFactory {
  @example
  static async updateCollection(popupWin: ProgressWindowHelper) {
    const s = new Zotero.Search();
    const zp = Zotero.getActiveZoteroPane();
    s.addCondition("libraryID", "is", zp.getSelectedLibraryID().toString());
    // s.addCondition('collection', 'is', selectedCollection.key);
    s.addCondition("recursive", "true"); // equivalent of "Search subfolders" checked
    s.addCondition("noChildren", "true");
    const itemIDs = await s.search();
    // const selectedCollection = ZoteroPane.getSelectedCollection();
    // let itemIDs = selectedCollection.getChildItems(true);
    let itemNumber = 0;
    for (const itemID of itemIDs) {
      itemNumber += 1;
      ztoolkit.log(itemID);
      const p = Math.floor((itemNumber * 100) / itemIDs.length);
      popupWin.changeLine({
        progress: p,
        text: `[${p}%] ${getString("items-checked")}`,
      });
      const item = await Zotero.Items.getAsync(itemID);
      const noteIDs = item.getNotes();
      let summaryNote = null;
      if (noteIDs.length > 0) {
        for (const noteID of noteIDs) {
          const note = Zotero.Items.get(noteID);
          if (note.hasTag("LLM:Summary")) {
            summaryNote = noteID;
            break;
          }
        }
      }
      const handleDownloadError = function(att: Zotero.Item) {
        if (att.hasTag("LLM:download-error")) {
          att.addTag("LLM:ignore", 0);
          att.removeTag("LLM:download-error");
        } else {
          att.addTag("LLM:download-error", 0);
        }
        return true;
      };

      const hasAtt = await hasPDFAttachment(item)
      Zotero.log("Has Att? " + hasAtt)
      if (!hasAtt && item.getField('url') !== "") {

        // @ts-ignore created in newer api
        const foo = Zotero.Attachments.getFileResolvers(item)
        Zotero.log(JSON.stringify(foo))
        // @ts-ignore created in newer api
        await Zotero.Attachments.addFileFromURLs(item, Zotero.Attachments.getFileResolvers(item, ['doi', 'url', 'oa', 'custom']), { shouldDisplayCaptcha: true, enforceFileType: true })
        Zotero.log("should™ have added.. ")
      }

      let selectedAtt = null;
      if (
        summaryNote === null &&
        !item.hasTag("LLM:no-summary") &&
        !item.isAttachment() &&
        item.itemType !== "book"
      ) {
        const attIDs = item.getAttachments();
        let pdfpath: string | null = null;
        for (const attID of attIDs) {
          const att = await Zotero.Items.getAsync(attID);
          if (att.attachmentContentType === "application/pdf"
            && !att.hasTag("LLM:no-summary")
            && !att.hasTag("LLM:ignore")) {
            const thepath = await att.getFilePathAsync();
            if (thepath) {
              pdfpath = thepath;
              selectedAtt = att;
            } else {
              const tmpDirectory = (
                await Zotero.Attachments.createTemporaryStorageDirectory()
              ).path;
              const tmpFile = PathUtils.join(`${tmpDirectory}`, "file.tmp");

              try {
                const success = await Zotero.Attachments.downloadFirstAvailableFile(
                  Zotero.Attachments.getPDFResolvers(att), // FIXME: getFileResolvers in future versions, zotero-types not up to date.
                  tmpFile,
                  {
                    onBeforeRequest: () => {
                      return;
                    },
                    onAfterRequest: () => {
                      return;
                    },
                    onRequestError: () => { return true },
                  },
                );
                let mime = ""
                if (success) {
                  mime = Zotero.MIME.getMIMETypeFromFile(tmpFile)
                }
                if (mime === "application/pdf") {
                  // if download succeded remove error-tag
                  if (att.hasTag("LLM:download-error")) {
                    att.removeTag("LLM:download-error");
                  }
                  const fileBaseName =
                    Zotero.Attachments.getFileBaseNameFromItem(
                      item,
                      att.getDisplayTitle(),
                    );
                  let filename = await Zotero.File.rename(
                    tmpFile,
                    `${att.key}_${fileBaseName}.pdf`,
                  );
                  filename = filename || `${att.key}_${fileBaseName}.pdf`
                  att.attachmentLinkMode =
                    Zotero.Attachments.LINK_MODE_IMPORTED_URL;
                  att.attachmentPath = `storage:${filename}`;
                  await att.saveTx();
                  // Move file to final location
                  const destDir =
                    Zotero.Attachments.getStorageDirectory(att).path;
                  await OS.File.move(tmpDirectory, destDir);
                  ztoolkit.log(
                    new Error(
                      JSON.stringify([
                        tmpDirectory,
                        tmpFile,
                        fileBaseName,
                        filename,
                        destDir,
                        att,
                      ]),
                    ),
                  );
                  item.setField(
                    "url",
                    item.getField("url") || att.getField("url"),
                  );
                  pdfpath = PathUtils.join(destDir, filename)
                  selectedAtt = att;
                }
                else {
                  handleDownloadError(att)
                }
              } catch (e) {
                ztoolkit.log(
                  new Error(
                    `Could not download ${att.getField("url")}: ${e}`,
                  ),
                );
                ztoolkit.log(new Error(JSON.stringify(att)));
              }
            }
          }
        }

        if (pdfpath !== null) {
          // maybe we have a storage-path, an url - but stuff is not synced correctly
          if (Zotero.MIME.getMIMETypeFromFile(pdfpath) !== "application/pdf"
            && selectedAtt?.getField('url')) {
            await Zotero.Attachments.downloadFile(selectedAtt.getField('url'), pdfpath)
          }
          ztoolkit.log(`pdf found: ${pdfpath}`);
          const response = await fetch("http://localhost:3246", {
            method: "POST",
            body: JSON.stringify({ path: pdfpath }),
          });
          try {
            const data: ServerAnswer =
              (await response.json()) as unknown as ServerAnswer;
            if (data.summary) {
              const note = new Zotero.Item("note");
              note.parentKey = item.key;
              note.setNote(data.summary);
              note.addTag("LLM:Summary");
              note.libraryID = item.libraryID;
              note.saveTx();
              item.removeTag("LLM:Summary-requested");
              await item.saveTx();
              ztoolkit.log("SUMMARY ADDED");
            } else if (data.error) {
              item.removeTag("LLM:Summary-requested");
              selectedAtt?.addTag("LLM:PDF-conversion-error")
              selectedAtt?.saveTx()
              item.saveTx();
            } else {
              item.addTag("LLM:Summary-requested");
              await item.saveTx();
              ztoolkit.log(JSON.stringify(data));
            }
          } catch (e) {
            ztoolkit.log(e);
          }
        } else {
          item.removeTag("LLM:Summary-requested");
          await item.saveTx();
        }
      }
    }
    popupWin.changeLine({
      progress: 100,
      text: `[100%] ${getString("items-checked")}`,
    });
    popupWin.startCloseTimer(5000);
  }
}

export class BasicExampleFactory {
  @example
  static registerNotifier() {
    const callback = {
      notify: async (
        event: string,
        type: string,
        ids: number[] | string[],
        extraData: { [key: string]: any },
      ) => {
        if (!addon?.data.alive) {
          this.unregisterNotifier(notifierID);
          return;
        }
        addon.hooks.onNotify(event, type, ids, extraData);
      },
    };

    // Register the callback in Zotero as an item observer
    const notifierID = Zotero.Notifier.registerObserver(callback, [
      "tab",
      "item",
      "file",
    ]);

    // Unregister callback when the window closes (important to avoid a memory leak)
    window.addEventListener(
      "unload",
      (e: Event) => {
        this.unregisterNotifier(notifierID);
      },
      false,
    );
  }

  @example
  static exampleNotifierCallback() {
    new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        text: "Open Tab Detected!",
        type: "success",
        progress: 100,
      })
      .show();
  }

  @example
  private static unregisterNotifier(notifierID: string) {
    Zotero.Notifier.unregisterObserver(notifierID);
  }

  @example
  static registerPrefs() {
    const prefOptions = {
      pluginID: config.addonID,
      src: rootURI + "chrome/content/preferences.xhtml",
      label: getString("prefs-title"),
      image: `chrome://${config.addonRef}/content/icons/favicon.png`,
      defaultXUL: true,
    };
    ztoolkit.PreferencePane.register(prefOptions);
  }
}

// export class KeyExampleFactory {
//   @example
//   static registerShortcuts() {
//     // Register an event key for Alt+L
//     ztoolkit.Keyboard.register((ev, keyOptions) => {
//       ztoolkit.log(ev, keyOptions.keyboard);
//       if (keyOptions.keyboard?.equals("shift,l")) {
//         addon.hooks.onShortcuts("larger");
//       }
//       if (ev.shiftKey && ev.key === "S") {
//         addon.hooks.onShortcuts("smaller");
//       }
//     });
//
//     new ztoolkit.ProgressWindow(config.addonName)
//       .createLine({
//         text: "Example Shortcuts: Alt+L/S/C",
//         type: "success",
//       })
//       .show();
//   }
//
//   @example
//   static exampleShortcutLargerCallback() {
//     new ztoolkit.ProgressWindow(config.addonName)
//       .createLine({
//         text: "Larger!",
//         type: "default",
//       })
//       .show();
//   }
//
//   @example
//   static exampleShortcutSmallerCallback() {
//     new ztoolkit.ProgressWindow(config.addonName)
//       .createLine({
//         text: "Smaller!",
//         type: "default",
//       })
//       .show();
//   }
// }

export class UIExampleFactory {
  @example
  static registerStyleSheet() {
    const styles = ztoolkit.UI.createElement(document, "link", {
      properties: {
        type: "text/css",
        rel: "stylesheet",
        href: `chrome://${config.addonRef}/content/zoteroPane.css`,
      },
    });
    document.documentElement.appendChild(styles);
  }

  @example
  static registerRightClickMenuItem() {
    const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    // item menuitem with icon
    ztoolkit.Menu.register("collection", {
      tag: "menuitem",
      id: "zotero-collectionmenu-readai-check",
      label: getString("menuitem-label"),
      commandListener: () => addon.hooks.onUpdate(),
      icon: menuIcon,
    });
  }

  @example
  static registerWindowMenu() {
    const menuIcon = `chrome://${config.addonRef}/content/icons/favicon@0.5x.png`;
    ztoolkit.Menu.register("menuTools", {
      tag: "menuitem",
      id: "zotero-toolmenu-readai-check",
      label: getString("menuitem-toolmenulabel"),
      commandListener: () => addon.hooks.onUpdate(),
      icon: menuIcon,
    });
  }

  @example
  static async registerExtraColumnWithCustomCell() {
    const field = "test2";
    await Zotero.ItemTreeManager.registerColumns({
      pluginID: config.addonID,
      dataKey: field,
      label: "custom column",
      dataProvider: (item: Zotero.Item, dataKey: string) => {
        return field + String(item.id);
      },
      renderCell(index, data, column) {
        ztoolkit.log("Custom column cell is rendered!");
        const span = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        span.className = `cell ${column.className}`;
        span.style.background = "#0dd068";
        span.innerText = "⭐" + data;
        return span;
      },
    });
  }

  @example
  static async registerCustomItemBoxRow() {
    await ztoolkit.ItemBox.register(
      "itemBoxFieldEditable",
      "Editable Custom Field",
      (field, unformatted, includeBaseMapped, item, original) => {
        return (
          ztoolkit.ExtraField.getExtraField(item, "itemBoxFieldEditable") || ""
        );
      },
      {
        editable: true,
        setFieldHook: (field, value, loadIn, item, original) => {
          window.alert("Custom itemBox value is changed and saved to extra!");
          ztoolkit.ExtraField.setExtraField(
            item,
            "itemBoxFieldEditable",
            value,
          );
          return true;
        },
        index: 1,
      },
    );

    await ztoolkit.ItemBox.register(
      "itemBoxFieldNonEditable",
      "Non-Editable Custom Field",
      (field, unformatted, includeBaseMapped, item, original) => {
        return (
          "[CANNOT EDIT THIS]" + (item.getField("title") as string).slice(0, 10)
        );
      },
      {
        editable: false,
        index: 2,
      },
    );
  }

  @example
  static registerItemPaneSection() {
    Zotero.ItemPaneManager.registerSection({
      paneID: "example",
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID("item-section-example1-head-text"),
        icon: "chrome://zotero/skin/16/universal/book.svg",
      },
      sidenav: {
        l10nID: getLocaleID("item-section-example1-sidenav-tooltip"),
        icon: "chrome://zotero/skin/20/universal/save.svg",
      },
      onRender: ({ body, item, editable, tabType }) => {
        body.textContent = JSON.stringify({
          id: item?.id,
          editable,
          tabType,
        });
      },
    });
  }

  @example
  static async registerReaderItemPaneSection() {
    Zotero.ItemPaneManager.registerSection({
      paneID: "reader-example",
      pluginID: config.addonID,
      header: {
        l10nID: getLocaleID("item-section-example2-head-text"),
        // Optional
        l10nArgs: `{"status": "Initialized"}`,
        // Can also have a optional dark icon
        icon: "chrome://zotero/skin/16/universal/book.svg",
      },
      sidenav: {
        l10nID: getLocaleID("item-section-example2-sidenav-tooltip"),
        icon: "chrome://zotero/skin/20/universal/save.svg",
      },
      // Optional
      bodyXHTML: '<html:h1 id="test">THIS IS TEST</html:h1>',
      // Optional, Called when the section is first created, must be synchronous
      onInit: ({ item }) => {
        ztoolkit.log("Section init!", item?.id);
      },
      // Optional, Called when the section is destroyed, must be synchronous
      onDestroy: (props) => {
        ztoolkit.log("Section destroy!");
      },
      // Optional, Called when the section data changes (setting item/mode/tabType/inTrash), must be synchronous. return false to cancel the change
      onItemChange: ({ item, setEnabled, tabType }) => {
        ztoolkit.log(`Section item data changed to ${item?.id}`);
        setEnabled(tabType === "reader");
        return true;
      },
      // Called when the section is asked to render, must be synchronous.
      onRender: ({
        body,
        item,
        setL10nArgs,
        setSectionSummary,
        setSectionButtonStatus,
      }) => {
        ztoolkit.log("Section rendered!", item?.id);
        const title = body.querySelector("#test") as HTMLElement;
        title.style.color = "red";
        title.textContent = "LOADING";
        setL10nArgs(`{ "status": "Loading" }`);
        setSectionSummary("loading!");
        setSectionButtonStatus("test", { hidden: true });
      },
      // Optional, can be asynchronous.
      onAsyncRender: async ({
        body,
        item,
        setL10nArgs,
        setSectionSummary,
        setSectionButtonStatus,
      }) => {
        ztoolkit.log("Section secondary render start!", item?.id);
        await Zotero.Promise.delay(1000);
        ztoolkit.log("Section secondary render finish!", item?.id);
        const title = body.querySelector("#test") as HTMLElement;
        title.style.color = "green";
        title.textContent = item.getField("title");
        setL10nArgs(`{ "status": "Loaded" }`);
        setSectionSummary("rendered!");
        setSectionButtonStatus("test", { hidden: false });
      },
      // Optional, Called when the section is toggled. Can happen anytime even if the section is not visible or not rendered
      onToggle: ({ item }) => {
        ztoolkit.log("Section toggled!", item?.id);
      },
      // Optional, Buttons to be shown in the section header
      sectionButtons: [
        {
          type: "test",
          icon: "chrome://zotero/skin/16/universal/empty-trash.svg",
          l10nID: getLocaleID("item-section-example2-button-tooltip"),
          onClick: ({ item, paneID }) => {
            ztoolkit.log("Section clicked!", item?.id);
            Zotero.ItemPaneManager.unregisterSection(paneID);
          },
        },
      ],
    });
  }
}

export class PromptExampleFactory {
  @example
  static registerNormalCommandExample() {
    ztoolkit.Prompt.register([
      {
        name: "Normal Command Test",
        label: "Plugin Template",
        callback(prompt) {
          ztoolkit.getGlobal("alert")("Command triggered!");
        },
      },
    ]);
  }

  @example
  static registerAnonymousCommandExample() {
    ztoolkit.Prompt.register([
      {
        id: "search",
        callback: async (prompt) => {
          // https://github.com/zotero/zotero/blob/7262465109c21919b56a7ab214f7c7a8e1e63909/chrome/content/zotero/integration/quickFormat.js#L589
          function getItemDescription(item: Zotero.Item) {
            const nodes = [];
            let str = "";
            let author,
              authorDate = "";
            if (item.firstCreator) {
              author = authorDate = item.firstCreator;
            }
            let date = item.getField("date", true, true) as string;
            if (date && (date = date.substr(0, 4)) !== "0000") {
              authorDate += " (" + parseInt(date) + ")";
            }
            authorDate = authorDate.trim();
            if (authorDate) nodes.push(authorDate);

            const publicationTitle = item.getField(
              "publicationTitle",
              false,
              true,
            );
            if (publicationTitle) {
              nodes.push(`<i>${publicationTitle}</i>`);
            }
            let volumeIssue = item.getField("volume");
            const issue = item.getField("issue");
            if (issue) volumeIssue += "(" + issue + ")";
            if (volumeIssue) nodes.push(volumeIssue);

            const publisherPlace = [];
            let field;
            if ((field = item.getField("publisher")))
              publisherPlace.push(field);
            if ((field = item.getField("place"))) publisherPlace.push(field);
            if (publisherPlace.length) nodes.push(publisherPlace.join(": "));

            const pages = item.getField("pages");
            if (pages) nodes.push(pages);

            if (!nodes.length) {
              const url = item.getField("url");
              if (url) nodes.push(url);
            }

            // compile everything together
            for (let i = 0, n = nodes.length; i < n; i++) {
              const node = nodes[i];

              if (i != 0) str += ", ";

              if (typeof node === "object") {
                const label = document.createElement("label");
                label.setAttribute("value", str);
                label.setAttribute("crop", "end");
                str = "";
              } else {
                str += node;
              }
            }
            return str;
          }
          function filter(ids: number[]) {
            ids = ids.filter(async (id) => {
              const item = (await Zotero.Items.getAsync(id)) as Zotero.Item;
              return item.isRegularItem() && !(item as any).isFeedItem;
            });
            return ids;
          }
          const text = prompt.inputNode.value;
          prompt.showTip("Searching...");
          const s = new Zotero.Search();
          s.addCondition("quicksearch-titleCreatorYear", "contains", text);
          s.addCondition("itemType", "isNot", "attachment");
          let ids = await s.search();
          // prompt.exit will remove current container element.
          // @ts-ignore ignore
          prompt.exit();
          const container = prompt.createCommandsContainer();
          container.classList.add("suggestions");
          ids = filter(ids);
          console.log(ids.length);
          if (ids.length == 0) {
            const s = new Zotero.Search();
            const operators = [
              "is",
              "isNot",
              "true",
              "false",
              "isInTheLast",
              "isBefore",
              "isAfter",
              "contains",
              "doesNotContain",
              "beginsWith",
            ];
            let hasValidCondition = false;
            let joinMode = "all";
            if (/\s*\|\|\s*/.test(text)) {
              joinMode = "any";
            }
            text.split(/\s*(&&|\|\|)\s*/g).forEach((conditinString: string) => {
              const conditions = conditinString.split(/\s+/g);
              if (
                conditions.length == 3 &&
                operators.indexOf(conditions[1]) != -1
              ) {
                hasValidCondition = true;
                s.addCondition(
                  "joinMode",
                  joinMode as Zotero.Search.Operator,
                  "",
                );
                s.addCondition(
                  conditions[0] as string,
                  conditions[1] as Zotero.Search.Operator,
                  conditions[2] as string,
                );
              }
            });
            if (hasValidCondition) {
              ids = await s.search();
            }
          }
          ids = filter(ids);
          console.log(ids.length);
          if (ids.length > 0) {
            ids.forEach((id: number) => {
              const item = Zotero.Items.get(id);
              const title = item.getField("title");
              const ele = ztoolkit.UI.createElement(document, "div", {
                namespace: "html",
                classList: ["command"],
                listeners: [
                  {
                    type: "mousemove",
                    listener: function() {
                      // @ts-ignore ignore
                      prompt.selectItem(this);
                    },
                  },
                  {
                    type: "click",
                    listener: () => {
                      prompt.promptNode.style.display = "none";
                      Zotero_Tabs.select("zotero-pane");
                      ZoteroPane.selectItem(item.id);
                    },
                  },
                ],
                styles: {
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "start",
                },
                children: [
                  {
                    tag: "span",
                    styles: {
                      fontWeight: "bold",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                    properties: {
                      innerText: title,
                    },
                  },
                  {
                    tag: "span",
                    styles: {
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    },
                    properties: {
                      innerHTML: getItemDescription(item),
                    },
                  },
                ],
              });
              container.appendChild(ele);
            });
          } else {
            // @ts-ignore ignore
            prompt.exit();
            prompt.showTip("Not Found.");
          }
        },
      },
    ]);
  }

  @example
  static registerConditionalCommandExample() {
    ztoolkit.Prompt.register([
      {
        name: "Conditional Command Test",
        label: "Plugin Template",
        // The when function is executed when Prompt UI is woken up by `Shift + P`, and this command does not display when false is returned.
        when: () => {
          const items = ZoteroPane.getSelectedItems();
          return items.length > 0;
        },
        callback(prompt) {
          prompt.inputNode.placeholder = "Hello World!";
          const items = ZoteroPane.getSelectedItems();
          ztoolkit.getGlobal("alert")(
            `You select ${items.length} items!\n\n${items
              .map(
                (item, index) =>
                  String(index + 1) + ". " + item.getDisplayTitle(),
              )
              .join("\n")}`,
          );
        },
      },
    ]);
  }
}

// export class HelperExampleFactory {
//   @example
//   static async dialogExample() {
//     const dialogData: { [key: string | number]: any } = {
//       inputValue: "test",
//       checkboxValue: true,
//       loadCallback: () => {
//         ztoolkit.log(dialogData, "Dialog Opened!");
//       },
//       unloadCallback: () => {
//         ztoolkit.log(dialogData, "Dialog closed!");
//       },
//     };
//     const dialogHelper = new ztoolkit.Dialog(10, 2)
//       .addCell(0, 0, {
//         tag: "h1",
//         properties: { innerHTML: "Helper Examples" },
//       })
//       .addCell(1, 0, {
//         tag: "h2",
//         properties: { innerHTML: "Dialog Data Binding" },
//       })
//       .addCell(2, 0, {
//         tag: "p",
//         properties: {
//           innerHTML:
//             "Elements with attribute 'data-bind' are binded to the prop under 'dialogData' with the same name.",
//         },
//         styles: {
//           width: "200px",
//         },
//       })
//       .addCell(3, 0, {
//         tag: "label",
//         namespace: "html",
//         attributes: {
//           for: "dialog-checkbox",
//         },
//         properties: { innerHTML: "bind:checkbox" },
//       })
//       .addCell(
//         3,
//         1,
//         {
//           tag: "input",
//           namespace: "html",
//           id: "dialog-checkbox",
//           attributes: {
//             "data-bind": "checkboxValue",
//             "data-prop": "checked",
//             type: "checkbox",
//           },
//           properties: { label: "Cell 1,0" },
//         },
//         false,
//       )
//       .addCell(4, 0, {
//         tag: "label",
//         namespace: "html",
//         attributes: {
//           for: "dialog-input",
//         },
//         properties: { innerHTML: "bind:input" },
//       })
//       .addCell(
//         4,
//         1,
//         {
//           tag: "input",
//           namespace: "html",
//           id: "dialog-input",
//           attributes: {
//             "data-bind": "inputValue",
//             "data-prop": "value",
//             type: "text",
//           },
//         },
//         false,
//       )
//       .addCell(5, 0, {
//         tag: "h2",
//         properties: { innerHTML: "Toolkit Helper Examples" },
//       })
//       .addCell(
//         6,
//         0,
//         {
//           tag: "button",
//           namespace: "html",
//           attributes: {
//             type: "button",
//           },
//           listeners: [
//             {
//               type: "click",
//               listener: (e: Event) => {
//                 addon.hooks.onDialogEvents("clipboardExample");
//               },
//             },
//           ],
//           children: [
//             {
//               tag: "div",
//               styles: {
//                 padding: "2.5px 15px",
//               },
//               properties: {
//                 innerHTML: "example:clipboard",
//               },
//             },
//           ],
//         },
//         false,
//       )
//       .addCell(
//         7,
//         0,
//         {
//           tag: "button",
//           namespace: "html",
//           attributes: {
//             type: "button",
//           },
//           listeners: [
//             {
//               type: "click",
//               listener: (e: Event) => {
//                 addon.hooks.onDialogEvents("filePickerExample");
//               },
//             },
//           ],
//           children: [
//             {
//               tag: "div",
//               styles: {
//                 padding: "2.5px 15px",
//               },
//               properties: {
//                 innerHTML: "example:filepicker",
//               },
//             },
//           ],
//         },
//         false,
//       )
//       .addCell(
//         8,
//         0,
//         {
//           tag: "button",
//           namespace: "html",
//           attributes: {
//             type: "button",
//           },
//           listeners: [
//             {
//               type: "click",
//               listener: (e: Event) => {
//                 addon.hooks.onDialogEvents("progressWindowExample");
//               },
//             },
//           ],
//           children: [
//             {
//               tag: "div",
//               styles: {
//                 padding: "2.5px 15px",
//               },
//               properties: {
//                 innerHTML: "example:progressWindow",
//               },
//             },
//           ],
//         },
//         false,
//       )
//       .addCell(
//         9,
//         0,
//         {
//           tag: "button",
//           namespace: "html",
//           attributes: {
//             type: "button",
//           },
//           listeners: [
//             {
//               type: "click",
//               listener: (e: Event) => {
//                 addon.hooks.onDialogEvents("vtableExample");
//               },
//             },
//           ],
//           children: [
//             {
//               tag: "div",
//               styles: {
//                 padding: "2.5px 15px",
//               },
//               properties: {
//                 innerHTML: "example:virtualized-table",
//               },
//             },
//           ],
//         },
//         false,
//       )
//       .addButton("Confirm", "confirm")
//       .addButton("Cancel", "cancel")
//       .addButton("Help", "help", {
//         noClose: true,
//         callback: (e) => {
//           dialogHelper.window?.alert(
//             "Help Clicked! Dialog will not be closed.",
//           );
//         },
//       })
//       .setDialogData(dialogData)
//       .open("Dialog Example");
//     addon.data.dialog = dialogHelper;
//     await dialogData.unloadLock.promise;
//     addon.data.dialog = undefined;
//     addon.data.alive &&
//       ztoolkit.getGlobal("alert")(
//         `Close dialog with ${dialogData._lastButtonId}.\nCheckbox: ${dialogData.checkboxValue}\nInput: ${dialogData.inputValue}.`,
//       );
//     ztoolkit.log(dialogData);
//   }
//
//   @example
//   static clipboardExample() {
//     new ztoolkit.Clipboard()
//       .addText(
//         "![Plugin Template](https://github.com/windingwind/zotero-plugin-template)",
//         "text/unicode",
//       )
//       .addText(
//         '<a href="https://github.com/windingwind/zotero-plugin-template">Plugin Template</a>',
//         "text/html",
//       )
//       .copy();
//     ztoolkit.getGlobal("alert")("Copied!");
//   }
//
//   @example
//   static async filePickerExample() {
//     const path = await new ztoolkit.FilePicker(
//       "Import File",
//       "open",
//       [
//         ["PNG File(*.png)", "*.png"],
//         ["Any", "*.*"],
//       ],
//       "image.png",
//     ).open();
//     ztoolkit.getGlobal("alert")(`Selected ${path}`);
//   }
//
//   @example
//   static progressWindowExample() {
//     new ztoolkit.ProgressWindow(config.addonName)
//       .createLine({
//         text: "ProgressWindow Example!",
//         type: "success",
//         progress: 100,
//       })
//       .show();
//   }
//
//   @example
//   static vtableExample() {
//     ztoolkit.getGlobal("alert")("See src/modules/preferenceScript.ts");
//   }
// }
