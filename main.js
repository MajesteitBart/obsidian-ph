// src/main.js
var {
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  SuggestModal
} = require("obsidian");
var { Decoration, ViewPlugin, WidgetType } = require("@codemirror/view");
var { RangeSetBuilder } = require("@codemirror/state");
var PLACEHOLDER_PATTERN = /\{\{(?:ph|placeholder):([^{}\n]+?)\}\}/g;
var DEFAULT_SETTINGS = {
  snippets: [
    {
      name: "Title and body",
      content: "# {{ph:Title}}\n\n{{ph:Body}}"
    },
    {
      name: "Meeting follow-up",
      content: "## {{ph:Topic}}\n\n- Owner: {{ph:Name}}\n- Next step: {{ph:Action}}\n- Due: {{ph:Date}}"
    }
  ]
};
function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}
function getActiveMarkdownView(app) {
  return app.workspace.getActiveViewOfType(MarkdownView);
}
function findFirstPlaceholder(text) {
  const regex = new RegExp(PLACEHOLDER_PATTERN.source, "g");
  return regex.exec(text);
}
function selectRange(editor, fromOffset, toOffset) {
  editor.setSelection(editor.offsetToPos(fromOffset), editor.offsetToPos(toOffset));
}
function insertTextAndSelectFirstPlaceholder(editor, text) {
  const startOffset = editor.posToOffset(editor.getCursor("from"));
  editor.replaceSelection(text);
  const match = findFirstPlaceholder(text);
  if (match) {
    selectRange(editor, startOffset + match.index, startOffset + match.index + match[0].length);
    return;
  }
  editor.setCursor(editor.offsetToPos(startOffset + text.length));
}
function prepareSnippetForInsertion(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const lastContentLine = [...lines].reverse().find((line) => line.trim().length > 0);
  if (lastContentLine?.trimStart().startsWith(">") && !text.endsWith("\n\n")) {
    return `${text.replace(/\s*$/, "")}

`;
  }
  return text;
}
function selectNextPlaceholder(editor) {
  const text = editor.getValue();
  const cursorOffset = editor.posToOffset(editor.getCursor());
  const regex = new RegExp(PLACEHOLDER_PATTERN.source, "g");
  regex.lastIndex = cursorOffset;
  let match = regex.exec(text);
  if (!match && cursorOffset > 0) {
    regex.lastIndex = 0;
    match = regex.exec(text);
  }
  if (!match) {
    new Notice("No placeholders found in this note.");
    return;
  }
  selectRange(editor, match.index, match.index + match[0].length);
}
function selectPlaceholderInView(view, from, to) {
  view.dispatch({
    selection: { anchor: from, head: to },
    scrollIntoView: true
  });
  view.focus();
}
function shouldSkipRenderedNode(node) {
  const parent = node.parentElement;
  if (!parent) {
    return true;
  }
  return Boolean(parent.closest("code, pre, a, style, script, textarea, input, .placeholder-snippet-token"));
}
function getLineStartOffset(editor, line) {
  return editor.posToOffset({ line, ch: 0 });
}
function findTokenInEditor(editor, token, sectionInfo) {
  const value = editor.getValue();
  if (sectionInfo && Number.isInteger(sectionInfo.lineStart) && Number.isInteger(sectionInfo.lineEnd)) {
    const startOffset = getLineStartOffset(editor, sectionInfo.lineStart);
    const lineCount = editor.lineCount();
    const endOffset = sectionInfo.lineEnd + 1 < lineCount ? getLineStartOffset(editor, sectionInfo.lineEnd + 1) : value.length;
    const sectionIndex = value.slice(startOffset, endOffset).indexOf(token);
    if (sectionIndex >= 0) {
      return startOffset + sectionIndex;
    }
  }
  return value.indexOf(token);
}
async function selectRenderedPlaceholder(app, token, ctx, renderedEl) {
  const view = getActiveMarkdownView(app);
  if (!view) {
    new Notice("Open a Markdown note first.");
    return;
  }
  const sectionInfo = ctx?.getSectionInfo?.(renderedEl);
  if (typeof view.getMode === "function" && view.getMode() !== "source") {
    await view.setState({ ...view.getState(), mode: "source" }, { history: false });
  }
  const editor = view.editor;
  if (!editor) {
    new Notice("Open the note in editing mode first.");
    return;
  }
  const startOffset = findTokenInEditor(editor, token, sectionInfo);
  if (startOffset < 0) {
    new Notice("Could not find this placeholder in the note source.");
    return;
  }
  selectRange(editor, startOffset, startOffset + token.length);
  editor.focus();
}
function createRenderedPlaceholder(app, token, label, ctx, renderedEl) {
  const placeholder = document.createElement("span");
  placeholder.className = "placeholder-snippet-token placeholder-snippet-token-rendered";
  placeholder.textContent = label;
  placeholder.setAttribute("role", "button");
  placeholder.setAttribute("tabindex", "0");
  placeholder.setAttribute("contenteditable", "false");
  placeholder.setAttribute("aria-label", `Placeholder: ${label}`);
  placeholder.title = `Click and type to replace "${label}"`;
  const select = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    selectRenderedPlaceholder(app, token, ctx, renderedEl);
  };
  ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick"].forEach((eventName) => {
    placeholder.addEventListener(eventName, select, { capture: true });
  });
  placeholder.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      select(event);
    }
  });
  return placeholder;
}
function renderPlaceholdersInMarkdown(app, el, ctx) {
  const textNodes = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node;
  while (node = walker.nextNode()) {
    if (!shouldSkipRenderedNode(node) && PLACEHOLDER_PATTERN.test(node.nodeValue)) {
      textNodes.push(node);
    }
    PLACEHOLDER_PATTERN.lastIndex = 0;
  }
  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const fragment = document.createDocumentFragment();
    const regex = new RegExp(PLACEHOLDER_PATTERN.source, "g");
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      fragment.appendChild(createRenderedPlaceholder(app, match[0], match[1].trim(), ctx, el));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  });
}
var PlaceholderWidget = class extends WidgetType {
  constructor(label, from, to) {
    super();
    this.label = label;
    this.from = from;
    this.to = to;
  }
  eq(other) {
    return other.label === this.label && other.from === this.from && other.to === this.to;
  }
  toDOM(view) {
    const placeholder = document.createElement("span");
    placeholder.className = "placeholder-snippet-token";
    placeholder.textContent = this.label;
    placeholder.setAttribute("role", "button");
    placeholder.setAttribute("tabindex", "0");
    placeholder.setAttribute("contenteditable", "false");
    placeholder.setAttribute("aria-label", `Placeholder: ${this.label}`);
    placeholder.title = `Click and type to replace "${this.label}"`;
    const select = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      selectPlaceholderInView(view, this.from, this.to);
    };
    ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "auxclick"].forEach((eventName) => {
      placeholder.addEventListener(eventName, select, { capture: true });
    });
    placeholder.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        select(event);
      }
    });
    return placeholder;
  }
  ignoreEvent() {
    return true;
  }
};
function buildPlaceholderDecorations(view) {
  const builder = new RangeSetBuilder();
  for (const visibleRange of view.visibleRanges) {
    const text = view.state.doc.sliceString(visibleRange.from, visibleRange.to);
    const regex = new RegExp(PLACEHOLDER_PATTERN.source, "g");
    let match;
    while ((match = regex.exec(text)) !== null) {
      const from = visibleRange.from + match.index;
      const to = from + match[0].length;
      const label = match[1].trim();
      builder.add(
        from,
        to,
        Decoration.replace({
          widget: new PlaceholderWidget(label, from, to),
          inclusive: false
        })
      );
    }
  }
  return builder.finish();
}
var placeholderExtension = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildPlaceholderDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildPlaceholderDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);
var PlaceholderNameModal = class extends Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Insert placeholder" });
    let value = "Title";
    const input = contentEl.createEl("input", {
      type: "text",
      value,
      attr: {
        placeholder: "Placeholder name"
      }
    });
    input.addClass("placeholder-snippet-modal-input");
    const submit = () => {
      value = input.value.trim();
      if (!value) {
        new Notice("Enter a placeholder name.");
        return;
      }
      this.close();
      this.onSubmit(value);
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submit();
      }
    });
    new Setting(contentEl).addButton(
      (button) => button.setButtonText("Insert").setCta().onClick(submit)
    ).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => this.close())
    );
    input.focus();
    input.select();
  }
};
var SnippetSuggestModal = class extends SuggestModal {
  constructor(app, snippets, onChoose) {
    super(app);
    this.snippets = snippets;
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a snippet to insert");
  }
  getSuggestions(query) {
    const normalizedQuery = query.toLowerCase();
    return this.snippets.filter(
      (snippet) => snippet.name.toLowerCase().includes(normalizedQuery)
    );
  }
  renderSuggestion(snippet, el) {
    el.createEl("div", { text: snippet.name, cls: "placeholder-snippet-suggestion-title" });
    el.createEl("small", {
      text: snippet.content.replace(/\s+/g, " ").slice(0, 120),
      cls: "placeholder-snippet-suggestion-preview"
    });
  }
  onChooseSuggestion(snippet) {
    this.onChoose(snippet);
  }
};
var PlaceholderSnippetsSettingTab = class extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Placeholder snippets" });
    containerEl.createEl("p", {
      text: "Use {{ph:Name}} inside snippets. In Live Preview it becomes a clickable placeholder like [Name]."
    });
    this.plugin.settings.snippets.forEach((snippet, index) => {
      const section = containerEl.createDiv({ cls: "placeholder-snippet-setting-block" });
      new Setting(section).setName("Snippet name").addText(
        (text) => text.setValue(snippet.name).onChange(async (value) => {
          snippet.name = value;
          await this.plugin.saveSettings();
        })
      ).addExtraButton(
        (button) => button.setIcon("trash").setTooltip("Delete snippet").onClick(async () => {
          this.plugin.settings.snippets.splice(index, 1);
          await this.plugin.saveSettings();
          this.display();
        })
      );
      new Setting(section).setName("Snippet content").setDesc("Placeholders use {{ph:Placeholder name}}.").addTextArea((textArea) => {
        textArea.setValue(snippet.content).onChange(async (value) => {
          snippet.content = value;
          await this.plugin.saveSettings();
        });
        textArea.inputEl.rows = 6;
        textArea.inputEl.addClass("placeholder-snippet-setting-textarea");
      });
    });
    new Setting(containerEl).addButton(
      (button) => button.setButtonText("Add snippet").setCta().onClick(async () => {
        this.plugin.settings.snippets.push({
          name: "New snippet",
          content: "{{ph:Title}}"
        });
        await this.plugin.saveSettings();
        this.display();
      })
    ).addButton(
      (button) => button.setButtonText("Restore defaults").onClick(async () => {
        this.plugin.settings = cloneDefaultSettings();
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
};
module.exports = class PlaceholderSnippetsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerEditorExtension(placeholderExtension);
    this.registerMarkdownPostProcessor((el, ctx) => {
      renderPlaceholdersInMarkdown(this.app, el, ctx);
    });
    this.addCommand({
      id: "insert-placeholder",
      name: "Insert placeholder",
      editorCallback: (editor) => {
        new PlaceholderNameModal(this.app, (name) => {
          insertTextAndSelectFirstPlaceholder(editor, `{{ph:${name}}}`);
        }).open();
      }
    });
    this.addCommand({
      id: "insert-title-placeholder",
      name: "Insert title placeholder",
      editorCallback: (editor) => {
        insertTextAndSelectFirstPlaceholder(editor, "{{ph:Title}}");
      }
    });
    this.addCommand({
      id: "insert-snippet",
      name: "Insert snippet",
      editorCallback: (editor) => {
        if (!this.settings.snippets.length) {
          new Notice("No snippets configured.");
          return;
        }
        new SnippetSuggestModal(this.app, this.settings.snippets, (snippet) => {
          insertTextAndSelectFirstPlaceholder(editor, prepareSnippetForInsertion(snippet.content));
        }).open();
      }
    });
    this.addCommand({
      id: "select-next-placeholder",
      name: "Select next placeholder",
      editorCallback: (editor) => {
        selectNextPlaceholder(editor);
      }
    });
    this.addRibbonIcon("text-cursor-input", "Insert placeholder snippet", () => {
      const view = getActiveMarkdownView(this.app);
      if (!view) {
        new Notice("Open a Markdown note first.");
        return;
      }
      if (!this.settings.snippets.length) {
        new Notice("No snippets configured.");
        return;
      }
      new SnippetSuggestModal(this.app, this.settings.snippets, (snippet) => {
        insertTextAndSelectFirstPlaceholder(view.editor, prepareSnippetForInsertion(snippet.content));
      }).open();
    });
    this.addSettingTab(new PlaceholderSnippetsSettingTab(this.app, this));
  }
  async loadSettings() {
    this.settings = Object.assign(cloneDefaultSettings(), await this.loadData());
    if (!Array.isArray(this.settings.snippets)) {
      this.settings.snippets = cloneDefaultSettings().snippets;
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
