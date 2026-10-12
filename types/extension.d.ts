// Minimal typings for the WebExtension APIs the extension uses, and for the
// messages exchanged between its parts. Only what the code uses is declared.

/** What the content script reports about the right-clicked control. */
interface CffVerdict {
  /** Recognized company or address type of the control itself. */
  field: string | null;
  /** Qualification of the block around the control. */
  block: 'company' | 'address' | null;
  /** Whether the frame can undo its last fill. */
  canUndo: boolean;
}

interface CffUndoEntry {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  previous: string;
}

interface CffFavorite {
  company: Company;
  label: string;
}

type CffTheme = 'system' | 'light' | 'dark';

/** Persistent state (storage.local). */
interface CffStoredState {
  schemaVersion: 1;
  last: Company | null;
  history: Company[];
  favorites: CffFavorite[];
  locks: CompanyGroup[];
  theme: CffTheme;
  onboardingDismissed: boolean;
}

/** What the popup and the viewer receive. */
interface CffViewState extends CffStoredState {
  /** Company of the tab the popup was opened on, or of the viewer's target tab. */
  tabCompany: Company | null;
  /** The popup was opened in a private window. */
  incognito: boolean;
  /** Persistent storage failed: the state lives in memory only. */
  storageError: boolean;
}

interface CffEvent<Listener> {
  addListener(listener: Listener): void;
  removeListener?(listener: Listener): void;
}

interface CffMenuProperties {
  id?: string;
  parentId?: string;
  title?: string;
  contexts?: string[];
  visible?: boolean;
}

interface CffMenusApi {
  create(properties: CffMenuProperties, callback?: () => void): void;
  update(id: string, properties: CffMenuProperties): Promise<void>;
  removeAll(): Promise<void>;
  refresh?(): Promise<void>;
  getTargetElement?(targetElementId: number): Element | null;
  onShown?: CffEvent<(info: any, tab: any) => void>;
  onHidden?: CffEvent<() => void>;
  onClicked: CffEvent<(info: any, tab: any) => void>;
}

interface CffStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, any>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  onChanged?: CffEvent<
    (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  >;
}

interface CffTab {
  id?: number;
  windowId?: number;
  incognito?: boolean;
  active?: boolean;
}

interface CffMessageSender {
  tab?: CffTab;
  frameId?: number;
  id?: string;
}

interface CffExtensionApi {
  menus?: CffMenusApi;
  contextMenus?: CffMenusApi;
  dom?: { openOrClosedShadowRoot(element: HTMLElement): ShadowRoot | null };
  i18n: { getMessage(name: string, substitutions?: string | string[]): string };
  runtime: {
    lastError?: unknown;
    id?: string;
    getURL(path: string): string;
    getManifest(): { version: string };
    sendMessage(message: unknown): Promise<any> | undefined;
    onInstalled: CffEvent<(details: { reason: string; previousVersion?: string }) => void>;
    onStartup: CffEvent<() => void>;
    onMessage: CffEvent<
      (
        message: unknown,
        sender: CffMessageSender,
        sendResponse: (response: unknown) => void,
      ) => unknown
    >;
  };
  tabs: {
    sendMessage(tabId: number, message: unknown, options?: { frameId?: number }): Promise<any>;
    query(query: { active?: boolean; currentWindow?: boolean }): Promise<CffTab[]>;
    create(properties: { url: string; active?: boolean }): Promise<CffTab>;
    update(tabId: number, properties: { active?: boolean }): Promise<CffTab>;
    get(tabId: number): Promise<CffTab>;
    getCurrent(): Promise<CffTab | undefined>;
    onActivated: CffEvent<(info: { tabId: number; windowId: number }) => void>;
    onRemoved: CffEvent<(tabId: number) => void>;
  };
  windows?: {
    update(windowId: number, properties: { focused?: boolean }): Promise<unknown>;
  };
  storage: {
    local: CffStorageArea;
    session?: CffStorageArea;
    onChanged: CffEvent<
      (
        changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
        areaName: string,
      ) => void
    >;
  };
}

declare var browser: CffExtensionApi | undefined;
declare var chrome: CffExtensionApi | undefined;
declare function importScripts(...urls: string[]): void;
