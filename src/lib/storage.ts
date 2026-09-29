import { PavementData } from '../types';

const DB_NAME = 'RoadDataAnalysisDB';
const DB_VERSION = 1;
const STORE_NAME = 'pavement_data';
const LS_FALLBACK_KEY = 'pavement_data_v1';
const LS_META_KEY = 'pavement_data_meta_v1';

export interface StorageMeta {
  lastSync: number;
  count: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 從 IndexedDB 高速載入道路檢測資料（幾十毫秒內完成，無 localStorage 5MB 限制）
 */
export async function getLocalData(): Promise<{ data: PavementData[]; lastSync: number } | null> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const reqData = store.get('data');
      const reqMeta = store.get('meta');

      tx.oncomplete = () => {
        const data = reqData.result as PavementData[] | undefined;
        const meta = reqMeta.result as StorageMeta | undefined;
        if (data && Array.isArray(data) && data.length > 0) {
          resolve({ data, lastSync: meta?.lastSync || 0 });
        } else {
          resolve(getFromLocalStorage());
        }
      };
      tx.onerror = () => {
        resolve(getFromLocalStorage());
      };
    });
  } catch {
    return getFromLocalStorage();
  }
}

/**
 * 異步持久化到 IndexedDB（背景寫入，不卡頓主執行緒）
 */
export async function saveLocalData(data: PavementData[], lastSync: number = Date.now()): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, 'data');
      store.put({ lastSync, count: data.length }, 'meta');
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        saveToLocalStorage(data, lastSync);
        resolve();
      };
    });
  } catch {
    saveToLocalStorage(data, lastSync);
  }
}

/**
 * 清除所有本地儲存資料
 */
export async function clearLocalDataStorage(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) {}

  try {
    localStorage.removeItem(LS_FALLBACK_KEY);
    localStorage.removeItem(LS_META_KEY);
  } catch (_) {}
}

function getFromLocalStorage(): { data: PavementData[]; lastSync: number } | null {
  try {
    const raw = localStorage.getItem(LS_FALLBACK_KEY);
    if (!raw) return null;
    const metaRaw = localStorage.getItem(LS_META_KEY);
    const lastSync = metaRaw ? Number(metaRaw) : 0;
    return { data: JSON.parse(raw), lastSync };
  } catch {
    return null;
  }
}

function saveToLocalStorage(data: PavementData[], lastSync: number) {
  try {
    localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(data));
    localStorage.setItem(LS_META_KEY, String(lastSync));
  } catch (_) {
    // 空間不足時忽略（已有 IndexedDB 作為主存儲）
  }
}
