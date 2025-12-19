// ============================================
// РАБОТА С IndexedDB
// ============================================

const DB_NAME = 'well_sampling_db';
const DB_VERSION = 1;

class DatabaseManager {
  constructor() {
    this.db = null;
  }

  // Инициализация БД
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('DB Error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('Database initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store для скважин
        if (!db.objectStoreNames.contains('wells')) {
          const wellStore = db.createObjectStore('wells', { keyPath: 'well_id' });
          wellStore.createIndex('status', 'sampling_status', { unique: false });
          wellStore.createIndex('synced', 'synced', { unique: false });
          wellStore.createIndex('name', 'well_name', { unique: false });
        }

        // Store для дубликатов
        if (!db.objectStoreNames.contains('duplicates')) {
          const dupStore = db.createObjectStore('duplicates', { keyPath: 'duplicate_id' });
          dupStore.createIndex('original', 'original_sample_id', { unique: false });
          dupStore.createIndex('synced', 'synced', { unique: false });
        }

        // Store для логов
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Store для настроек
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        console.log('Database schema created');
      };
    });
  }

  // ===== ОПЕРАЦИИ СО СКВАЖИНАМИ =====

  async addWells(wellsData) {
    const tx = this.db.transaction('wells', 'readwrite');
    const store = tx.objectStore('wells');

    return new Promise((resolve, reject) => {
      let added = 0;

      wellsData.forEach(well => {
        const wellRecord = {
          ...well,
          sampling_status: 'not_sampled',
          synced: 0,
          created_at: Date.now(),
          sampled_at: null,
          sampled_by: null
        };

        const request = store.add(wellRecord);
        request.onsuccess = () => added++;
        request.onerror = () => console.error('Error adding well:', well.well_id);
      });

      tx.oncomplete = () => {
        console.log(`Added ${added} wells`);
        resolve(added);
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllWells() {
    const tx = this.db.transaction('wells', 'readonly');
    const store = tx.objectStore('wells');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getWellsByStatus(status) {
    const tx = this.db.transaction('wells', 'readonly');
    const index = tx.objectStore('wells').index('status');

    return new Promise((resolve, reject) => {
      const request = index.getAll(status);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async searchWells(query) {
    const tx = this.db.transaction('wells', 'readonly');
    const store = tx.objectStore('wells');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result.filter(well => 
          well.well_id.toLowerCase().includes(query.toLowerCase()) ||
          well.well_name.toLowerCase().includes(query.toLowerCase())
        );
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateWellStatus(wellId, status, userName) {
    const tx = this.db.transaction('wells', 'readwrite');
    const store = tx.objectStore('wells');

    return new Promise((resolve, reject) => {
      const request = store.get(wellId);

      request.onsuccess = () => {
        const well = request.result;
        if (well) {
          well.sampling_status = status;
          well.sampled_at = Date.now();
          well.sampled_by = userName;
          well.synced = 0;

          const updateRequest = store.put(well);
          updateRequest.onsuccess = () => {
            console.log(`Updated well ${wellId} status to ${status}`);
            resolve(well);
          };
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          reject(new Error(`Well ${wellId} not found`));
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== ОПЕРАЦИИ С ДУБЛИКАТАМИ =====

  async addDuplicate(duplicate) {
    const tx = this.db.transaction('duplicates', 'readwrite');
    const store = tx.objectStore('duplicates');

    return new Promise((resolve, reject) => {
      const duplicateRecord = {
        ...duplicate,
        synced: 0,
        created_at: Date.now()
      };

      const request = store.add(duplicateRecord);
      request.onsuccess = () => resolve(duplicateRecord);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDuplicates() {
    const tx = this.db.transaction('duplicates', 'readonly');
    const store = tx.objectStore('duplicates');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDuplicate(duplicateId) {
    const tx = this.db.transaction('duplicates', 'readwrite');
    const store = tx.objectStore('duplicates');

    return new Promise((resolve, reject) => {
      const request = store.delete(duplicateId);
      request.onsuccess = () => {
        console.log(`Deleted duplicate ${duplicateId}`);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ===== ОПЕРАЦИИ С ЛОГАМИ =====

  async addLog(wellId, wellName, userName, action = 'scan') {
    const tx = this.db.transaction('logs', 'readwrite');
    const store = tx.objectStore('logs');

    const logEntry = {
      wellId,
      wellName,
      userName,
      action,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const request = store.add(logEntry);
      request.onsuccess = () => resolve(logEntry);
      request.onerror = () => reject(request.error);
    });
  }

  async getLogs(limit = 100) {
    const tx = this.db.transaction('logs', 'readonly');
    const store = tx.objectStore('logs');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const logs = request.result
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);
        resolve(logs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ===== СТАТИСТИКА =====

  async getStatistics() {
    const wells = await this.getAllWells();
    const sampled = wells.filter(w => w.sampling_status === 'sampled').length;
    const unsampled = wells.length - sampled;
    const completion = wells.length > 0 ? (sampled / wells.length) * 100 : 0;

    return {
      totalWells: wells.length,
      sampledWells: sampled,
      unsampledWells: unsampled,
      completionPercentage: completion.toFixed(1)
    };
  }

  // ===== СИНХРОНИЗАЦИЯ =====

  async markAsUnsynced(wellId) {
    const tx = this.db.transaction('wells', 'readwrite');
    const store = tx.objectStore('wells');

    return new Promise((resolve, reject) => {
      const request = store.get(wellId);
      request.onsuccess = () => {
        const well = request.result;
        well.synced = 0;
        store.put(well);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve();
    });
  }

  async getUnsyncedWells() {
    const tx = this.db.transaction('wells', 'readonly');
    const index = tx.objectStore('wells').index('synced');

    return new Promise((resolve, reject) => {
      const request = index.getAll(0);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ===== ОЧИСТКА =====

  async clearAllData() {
    const tx = this.db.transaction(['wells', 'duplicates', 'logs', 'settings'], 'readwrite');

    return new Promise((resolve, reject) => {
      tx.objectStore('wells').clear();
      tx.objectStore('duplicates').clear();
      tx.objectStore('logs').clear();
      tx.objectStore('settings').clear();

      tx.oncomplete = () => {
        console.log('All data cleared');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async exportToJSON() {
    const wells = await this.getAllWells();
    const duplicates = await this.getAllDuplicates();
    const logs = await this.getLogs(1000);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      wells,
      duplicates,
      logs
    };
  }

  async importFromJSON(data) {
    await this.clearAllData();
    
    if (data.wells && data.wells.length > 0) {
      await this.addWells(data.wells);
    }

    if (data.duplicates && data.duplicates.length > 0) {
      const tx = this.db.transaction('duplicates', 'readwrite');
      const store = tx.objectStore('duplicates');
      data.duplicates.forEach(dup => store.add(dup));
    }

    console.log('Data imported successfully');
  }
}

// Создание глобального экземпляра
const db = new DatabaseManager();
