import { readFileSync } from "node:fs";
import vm from "node:vm";

function createElementStub(context, tagName = "div") {
  const listeners = new Map();
  const classes = new Set();
  return {
    tagName: tagName.toUpperCase(),
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    children: [],
    attributes: new Map(),
    dataset: {},
    scrollTop: 0,
    scrollLeft: 0,
    selectionStart: 0,
    selectionEnd: 0,
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      }
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(event.type) || [];
      handlers.forEach((handler) => handler.call(this, event));
      return !event.defaultPrevented;
    },
    focus() {
      context.document.activeElement = this;
    },
    setRangeText(replacement, start = this.selectionStart, end = this.selectionEnd, selectionMode = "preserve") {
      this.value = `${this.value.slice(0, start)}${replacement}${this.value.slice(end)}`;
      if (selectionMode === "end") {
        this.selectionStart = start + replacement.length;
        this.selectionEnd = this.selectionStart;
      }
    },
    getListeners(type) {
      return listeners.get(type) || [];
    }
  };
}

export function loadApp(options = {}) {
  const html = readFileSync("index.html", "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)?.[1];
  if (!script) {
    throw new Error("Application script not found");
  }

  const elements = new Map();
  const context = {
    console,
    navigator: {
      clipboard: {
        async writeText(value) {
          context.__copiedText = value;
        }
      }
    },
    window: {
      clearTimeout() {},
      setTimeout() {
        return 1;
      },
      getSelection() {
        return {
          removeAllRanges() {},
          addRange() {}
        };
      }
    }
  };

  context.document = {
    activeElement: null,
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElementStub(context));
      }
      return elements.get(id);
    },
    createElement(tagName) {
      return createElementStub(context, tagName);
    },
    createRange() {
      return {
        selectNodeContents() {}
      };
    },
    execCommand() {
      return true;
    }
  };

  vm.createContext(context);
  vm.runInContext(options.mutateScript ? options.mutateScript(script) : script, context, {
    filename: "index.html<script>"
  });

  return {
    context,
    elements,
    convertOracleToPostgres: context.convertOracleToPostgres,
    highlightSql: context.highlightSql
  };
}
