import { appFile } from "../../scripts/app-config.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function createElementStub(context, tagName = "div") {
  const listeners = new Map();
  const classes = new Set();
  const descendants = new Map();
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
    selectionDirection: "none",
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelector(selector) {
      if (!descendants.has(selector)) descendants.set(selector, createElementStub(context, "span"));
      return descendants.get(selector);
    },
    setSelectionRange(start, end, direction = "none") {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    },
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
  const filename = options.file || appFile;
  const html = readFileSync(filename, "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)?.[1];
  if (!script) {
    throw new Error("Application script not found");
  }

  const elements = new Map();
  const timers = new Map();
  const windowListeners = new Map();
  let time = 0;
  let timerId = 0;
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
      addEventListener(type, handler) {
        const handlers = windowListeners.get(type) || [];
        handlers.push(handler);
        windowListeners.set(type, handlers);
      },
      dispatchEvent(event) {
        for (const handler of windowListeners.get(event.type) || []) handler(event);
      },
      clearTimeout(id) { timers.delete(id); },
      setTimeout(callback, delay = 0) {
        const id = ++timerId;
        timers.set(id, { callback, at: time + delay });
        return id;
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
    filename: `${filename}<script>`
  });

  return {
    context,
    elements,
    advanceTime(milliseconds) {
      const end = time + milliseconds;
      let pending;
      while ((pending = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0])) {
        time = pending[1].at;
        timers.delete(pending[0]);
        pending[1].callback();
      }
      time = end;
    },
    convertOracleToPostgres: context.convertOracleToPostgres,
    highlightSql: context.highlightSql
  };
}
