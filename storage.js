/**
 * STRATEGYNOTE - Storage & Image Processing Engine
 * IndexedDB + WebP Canvas Compressor + Export/Import
 */

const DB_NAME = 'StrategyNotebookDB';
const DB_VERSION = 1;

class NotebookStorage {
  constructor() {
    this.db = null;
  }

  // Initialize IndexedDB
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        
        // Notebooks store
        if (!db.objectStoreNames.contains('notebooks')) {
          const nbStore = db.createObjectStore('notebooks', { keyPath: 'id' });
          nbStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Pages store
        if (!db.objectStoreNames.contains('pages')) {
          const pageStore = db.createObjectStore('pages', { keyPath: 'id' });
          pageStore.createIndex('notebookId', 'notebookId', { unique: false });
          pageStore.createIndex('pageIndex', 'pageIndex', { unique: false });
        }

        // Compressed Images store
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error('IndexedDB Error:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  // WebP Image Compressor Engine using HTML5 Canvas
  async compressImage(fileOrBlob, maxDimension = 1920, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);

      img.onload = () => {
        URL.revokeObjectURL(url);

        let width = img.width;
        let height = img.height;

        // Resize if exceeds max dimension
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to WebP format
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              // Fallback to JPEG if WebP isn't supported
              canvas.toBlob((jpgBlob) => resolve(jpgBlob), 'image/jpeg', quality);
            }
          },
          'image/webp',
          quality
        );
      };

      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }

  // Save image blob and get image ID
  async saveImage(imageId, blob) {
    const tx = this.db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    await store.put({ id: imageId, blob, createdAt: Date.now() });
  }

  // Get image Blob URL
  async getImageUrl(imageId) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('images', 'readonly');
      const store = tx.objectStore('images');
      const request = store.get(imageId);

      request.onsuccess = () => {
        if (request.result && request.result.blob) {
          resolve(URL.createObjectURL(request.result.blob));
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  // Save Notebook
  async saveNotebook(notebook) {
    const tx = this.db.transaction('notebooks', 'readwrite');
    const store = tx.objectStore('notebooks');
    notebook.updatedAt = Date.now();
    await store.put(notebook);
  }

  // Get All Notebooks
  async getAllNotebooks() {
    return new Promise((resolve) => {
      const tx = this.db.transaction('notebooks', 'readonly');
      const store = tx.objectStore('notebooks');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
  }

  // Save Pages
  async savePages(pages) {
    const tx = this.db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    for (const page of pages) {
      await store.put(page);
    }
  }

  // Get Pages for Notebook
  async getPagesForNotebook(notebookId) {
    return new Promise((resolve) => {
      const tx = this.db.transaction('pages', 'readonly');
      const index = tx.objectStore('pages').index('notebookId');
      const request = index.getAll(notebookId);

      request.onsuccess = () => {
        const pages = request.result || [];
        pages.sort((a, b) => a.pageIndex - b.pageIndex);
        resolve(pages);
      };

      request.onerror = () => resolve([]);
    });
  }

  // Delete Page
  async deletePage(pageId) {
    const tx = this.db.transaction('pages', 'readwrite');
    await tx.objectStore('pages').delete(pageId);
  }

  // Delete Notebook
  async deleteNotebook(notebookId) {
    const pages = await this.getPagesForNotebook(notebookId);
    const tx = this.db.transaction(['notebooks', 'pages'], 'readwrite');
    await tx.objectStore('notebooks').delete(notebookId);
    
    const pageStore = tx.objectStore('pages');
    for (const page of pages) {
      await pageStore.delete(page.id);
    }
  }

  // Pre-fill Clean Initial Notebook on first run & remove sample data
  async seedInitialDataIfEmpty() {
    const notebooks = await this.getAllNotebooks();
    for (const nb of notebooks) {
      if (nb.id === 'nb_elden_ring' || (nb.title && (nb.title.includes('エルデンリング') || nb.title === '新規攻略ノート'))) {
        await this.deleteNotebook(nb.id);
      }
    }

    const remainingNotebooks = await this.getAllNotebooks();
    if (remainingNotebooks.length > 0) return;

    // Create Clean Initial Notebook
    const cleanNb = {
      id: 'nb_' + Date.now(),
      title: '新規ノート',
      icon: 'fa-book',
      createdAt: Date.now()
    };
    await this.saveNotebook(cleanNb);

    const firstPage = {
      id: 'p_' + Date.now(),
      notebookId: cleanNb.id,
      pageIndex: 0,
      bookmarkLabel: '概要',
      isLocked: false,
      blocks: [
        { type: 'note', text: 'ここにスクショや図解、手順説明テキストを配置できます。' }
      ]
    };
    await this.savePages([firstPage]);
  }
}

window.storageEngine = new NotebookStorage();
