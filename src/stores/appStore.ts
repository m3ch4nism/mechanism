import { create } from "zustand";
import { call } from "../lib/sidecar";

export interface Account {
  id: number;
  email: string;
  password: string;
  imap_host: string;
  imap_port: number;
  use_ssl: boolean;
  imap_user: string | null;
}

export interface Email {
  uid: string;
  subject: string;
  sender: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  flags: string[];
}

export interface AmazonReport {
  email: string;
  cards: any[];
  cardsExpired: any[];
  expiryDates: string[];
  orders: any[];
  subscribeSave: string[];
  digitalSubs: string[];
  accountName: string | null;
  cartInterest: { recommendations: string[]; storeNews: string[] };
  errors: string[];
  sourceEmails: { uid: string; subject: string; sender: string; date: string; bodyText: string; bodyHtml: string; section: string }[];
}

export interface SearchPreset {
  id: number;
  name: string;
  sender: string | null;
  subject: string | null;
  bodyText: string | null;
  folder: string;
  daysBack: number;
}

interface AppState {
  accounts: Account[];
  selectedAccount: string | null;
  selectedFolder: string;
  folders: { name: string; path: string; specialUse: string | null }[];
  emails: Email[];
  selectedEmail: Email | null;
  proxy: string | null;
  connectedAccounts: Set<string>;
  failedAccounts: Set<string>;
  loading: boolean;
  error: string | null;
  amazonReport: AmazonReport | null;
  amazonLoading: boolean;
  presets: SearchPreset[];
  presetResults: Email[] | null;
  presetLoading: boolean;

  init: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  addAccount: (email: string, password: string, host: string, port: number, ssl: boolean, imapUser?: string) => Promise<boolean>;
  removeAccount: (email: string) => Promise<void>;
  selectAccount: (email: string) => Promise<void>;
  selectFolder: (folder: string) => Promise<void>;
  selectEmail: (email: Email | null) => void;
  setProxy: (proxy: string | null) => Promise<void>;
  loadProxy: () => Promise<void>;
  runAmazonCheck: (email: string) => Promise<void>;
  refreshEmails: () => Promise<void>;
  loadPresets: () => Promise<void>;
  addPreset: (preset: Omit<SearchPreset, "id">) => Promise<void>;
  updatePreset: (preset: SearchPreset) => Promise<void>;
  removePreset: (id: number) => Promise<void>;
  runPreset: (email: string, preset: SearchPreset) => Promise<void>;
  verifyAccounts: () => Promise<void>;
  deleteEmails: (uids: string[]) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  accounts: [],
  selectedAccount: null,
  selectedFolder: "INBOX",
  folders: [],
  emails: [],
  selectedEmail: null,
  proxy: null,
  connectedAccounts: new Set<string>(),
  failedAccounts: new Set<string>(),
  loading: false,
  error: null,
  amazonReport: null,
  amazonLoading: false,
  presets: [],
  presetResults: null,
  presetLoading: false,

  init: async () => {
    try {
      await call("init");
      await get().loadAccounts();
      await get().loadProxy();
      await get().loadPresets();
      // Auto-verify all accounts in background
      get().verifyAccounts();
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadAccounts: async () => {
    const accounts = await call("getAccounts");
    set({ accounts });
  },

  addAccount: async (email, password, host, port, ssl, imapUser) => {
    const ok = await call("addAccount", { email, password, imapHost: host, imapPort: port, useSsl: ssl, imapUser: imapUser || null });
    if (ok) await get().loadAccounts();
    return ok;
  },

  removeAccount: async (email) => {
    await call("removeAccount", { email });
    try { await call("disconnect", { email }); } catch {}
    const connected = new Set(get().connectedAccounts);
    connected.delete(email);
    const state = get();
    if (state.selectedAccount === email) {
      set({ selectedAccount: null, emails: [], folders: [], selectedEmail: null, connectedAccounts: connected });
    } else {
      set({ connectedAccounts: connected });
    }
    await get().loadAccounts();
  },

  selectAccount: async (email) => {
    set({ loading: true, error: null, selectedAccount: email, emails: [], selectedEmail: null, selectedFolder: "INBOX" });
    try {
      const account = get().accounts.find(a => a.email === email);
      if (!account) throw new Error("Account not found");
      let settings = await call("getImapSettings", { email });
      if (!settings) settings = { host: account.imap_host, port: account.imap_port, secure: account.use_ssl };
      await call("connect", { email, password: account.password, ...settings, imapUser: account.imap_user });
      const connected = new Set(get().connectedAccounts);
      connected.add(email);
      const failed = new Set(get().failedAccounts);
      failed.delete(email);
      set({ connectedAccounts: connected, failedAccounts: failed });
      const folders = await call("fetchFolders", { email });
      set({ folders });
      const emails = await call("fetchEmails", { email, folder: "INBOX", limit: 50 });
      set({ emails, loading: false });
    } catch (e: any) {
      const connected = new Set(get().connectedAccounts);
      connected.delete(email);
      const failed = new Set(get().failedAccounts);
      failed.add(email);
      set({ error: e.message, loading: false, connectedAccounts: connected, failedAccounts: failed });
    }
  },

  selectFolder: async (folder) => {
    const email = get().selectedAccount;
    if (!email) return;
    set({ loading: true, selectedFolder: folder, emails: [], selectedEmail: null });
    try {
      const emails = await call("fetchEmails", { email, folder, limit: 50 });
      set({ emails, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  selectEmail: (email) => set({ selectedEmail: email }),

  setProxy: async (proxy) => {
    await call("setProxy", { proxy });
    set({ proxy });
  },

  loadProxy: async () => {
    const proxy = await call("getProxy");
    set({ proxy });
  },

  runAmazonCheck: async (email) => {
    set({ amazonLoading: true, amazonReport: null, error: null });
    try {
      const account = get().accounts.find(a => a.email === email);
      if (!account) throw new Error("Account not found");
      let settings = await call("getImapSettings", { email });
      if (!settings) settings = { host: account.imap_host, port: account.imap_port, secure: account.use_ssl };
      const report = await call("amazonCheck", {
        email, password: account.password, ...settings, imapUser: account.imap_user,
      });
      set({ amazonReport: report, amazonLoading: false });
    } catch (e: any) {
      set({ error: e.message, amazonLoading: false });
    }
  },

  refreshEmails: async () => {
    const { selectedAccount, selectedFolder } = get();
    if (!selectedAccount) return;
    set({ loading: true });
    try {
      const emails = await call("fetchEmails", { email: selectedAccount, folder: selectedFolder, limit: 50 });
      set({ emails, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  loadPresets: async () => {
    const presets = await call("getPresets");
    set({ presets });
  },

  addPreset: async (preset) => {
    await call("addPreset", preset);
    await get().loadPresets();
  },

  updatePreset: async (preset) => {
    await call("updatePreset", preset);
    await get().loadPresets();
  },

  removePreset: async (id) => {
    await call("removePreset", { id });
    await get().loadPresets();
  },

  verifyAccounts: async () => {
    const accounts = get().accounts;
    if (!accounts.length) return;
    for (const acc of accounts) {
      try {
        let settings = await call("getImapSettings", { email: acc.email });
        if (!settings) settings = { host: acc.imap_host, port: acc.imap_port, secure: acc.use_ssl };
        const res = await call("verifyAccount", { email: acc.email, password: acc.password, ...settings, imapUser: acc.imap_user });
        const connected = new Set(get().connectedAccounts);
        const failed = new Set(get().failedAccounts);
        if (res.status === "ok") {
          connected.add(acc.email);
          failed.delete(acc.email);
        } else {
          connected.delete(acc.email);
          failed.add(acc.email);
        }
        set({ connectedAccounts: connected, failedAccounts: failed });
      } catch {
        const failed = new Set(get().failedAccounts);
        failed.add(acc.email);
        set({ failedAccounts: failed });
      }
    }
  },

  deleteEmails: async (uids) => {
    const { selectedAccount, selectedFolder } = get();
    if (!selectedAccount || !uids.length) return;
    await call("deleteEmails", { email: selectedAccount, folder: selectedFolder, uids });
    // Refresh email list after deletion
    await get().refreshEmails();
  },

  runPreset: async (email, preset) => {
    set({ presetLoading: true, presetResults: null, error: null });
    try {
      const account = get().accounts.find(a => a.email === email);
      if (!account) throw new Error("Account not found");
      let settings = await call("getImapSettings", { email });
      if (!settings) settings = { host: account.imap_host, port: account.imap_port, secure: account.use_ssl };
      const results = await call("runPreset", {
        email, password: account.password, ...settings, preset, imapUser: account.imap_user,
      });
      set({ presetResults: results, presetLoading: false });
    } catch (e: any) {
      set({ error: e.message, presetLoading: false });
    }
  },
}));
