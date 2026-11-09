/**
 * STRATEGYNOTE Engine
 * Integrated with Realtime Account Cloud Sync (Firebase Realtime Database per User UID),
 * Automatic Account-Wide Theme Preference Sync (PC ↔ Mobile),
 * Debounced Local Write Protection Lock (prevents real-time echoes from interrupting page editing, creation, or reordering),
 * Interactive Draggable/Resizable Stamps Canvas, Automatic Mobile/Desktop Device Detection,
 * Mobile Touch Swipe Page Turning, Vertical-Only Mobile Layout Adaptor,
 * Mobile 1-Click Redirect Authentication, 5-Theme Switcher, Range/Full Export,
 * Flexible Page-Level Import Target Choice, In-Between Block Insertion, Block Up/Down Reordering,
 * and Alignment/Float Text-Wrap Layouts.
 */

class StrategyApp {
  constructor() {
    this.currentNotebookId = null;
    this.notebooks = [];
    this.pages = [];
    this.currentPageIndex = 0; // 0-indexed left page
    this.activeTargetPageIndex = 0; // 0-indexed currently selected active page for sidebar editing
    this.viewMode = 'double'; // 'double' | 'single'
    this.speedMode = '3d'; // '3d' | 'fast'
    this.soundEnabled = true;
    this.isFlipping = false;
    this.userPlan = 'free'; // 'free' | 'paid' (Capacity Simulator)
    this.currentTheme = localStorage.getItem('sn_current_theme') || 'gamer-dark';
    
    // Firebase Cloud Engine State & Local Write Lock Guard
    this.firebaseApp = null;
    this.currentUser = null;
    this.isSyncingLocalWrite = false; // Flag to prevent self-echo overwrite
    this.localWriteTimer = null; // Debounce timer for continuous local editing
    this.liveStreamState = 'none'; // 'none' | 'host' | 'viewer'
    this.currentRoomCode = null;
    this.maxViewers = 10; // Strict limit: 1 host + 9 audience members = 10 total
    this.liveRoomRef = null;

    // Granular Keyboard Shortcut Toggles (Default ON for instant accessibility)
    this.kbdConfig = {
      pageTurnArrows: true,
      pageTurnPgKeys: true,
      search: true
    };

    // Pending Import Payload State
    this.pendingImportData = null;

    // Audio Context
    this.audioCtx = null;

    // Drawing Canvas State
    this.isDrawing = false;
    this.drawCtx = null;
    this.drawCanvas = null;

    // Resize Debounce Timer & In-Memory Image Cache
    this.resizeTimer = null;
    this.imageUrlCache = new Map();

    this.init();
  }

  async getImageUrlCached(imageId) {
    if (!imageId) return null;
    if (this.imageUrlCache.has(imageId)) {
      return this.imageUrlCache.get(imageId);
    }
    const url = await storageEngine.getImageUrl(imageId);
    if (url) this.imageUrlCache.set(imageId, url);
    return url;
  }

  async init() {
    try {
      // Clear legacy browser & PWA CacheStorage to ensure instant updates
      if ('caches' in window) {
        caches.keys().then((names) => {
          for (const name of names) caches.delete(name);
        }).catch(() => {});
      }

      this.applyTheme(this.currentTheme, false);
      await storageEngine.init();
      await storageEngine.seedInitialDataIfEmpty();
      await this.loadNotebooks();
      this.detectAndApplyDeviceLayout();
      this.initFirebase();
      this.setupEventListeners();
      this.setupMobileTouchSwipe();
      this.setupKeyboardShortcuts();
      this.setupClipboardAndDrop();
      this.setupDrawingCanvas();
      this.setupTabScrollWheel();
      this.setupThemePicker();
      this.updatePlanUI();
      this.showToast('STRATEGYNOTE 準備完了！');
    } catch (err) {
      console.error('App init failed:', err);
    }
  }

  // Local Write Protection Helper: Debounced lock to suppress Firebase write echoes during active user edits
  async performLocalWrite(writeFn) {
    this.isSyncingLocalWrite = true;
    if (this.localWriteTimer) {
      clearTimeout(this.localWriteTimer);
      this.localWriteTimer = null;
    }
    try {
      await writeFn();
    } finally {
      this.localWriteTimer = setTimeout(() => {
        this.isSyncingLocalWrite = false;
        this.localWriteTimer = null;
      }, 1500);
    }
  }

  // Automatic Mobile vs Desktop Detection & Dynamic Layout Adaptor
  isMobileDevice() {
    return window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  detectAndApplyDeviceLayout() {
    const mobile = this.isMobileDevice();
    const prevMode = this.viewMode;

    const sidebarTitle = document.getElementById('lblSidebarTitle');
    const floatBtnLabel = document.getElementById('lblFloatingSidebar');

    if (mobile) {
      this.viewMode = 'single';
      const sidebar = document.getElementById('quickSidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        const floatBtn = document.getElementById('btnFloatingSidebar');
        if (floatBtn) floatBtn.style.display = 'inline-flex';
      }
      if (sidebarTitle) sidebarTitle.innerHTML = `<i class="fa-solid fa-compass"></i> メニュー・目次`;
      if (floatBtnLabel) floatBtnLabel.innerText = `📖 メニュー`;
    } else {
      // Respect user's manually chosen view mode (single or double) on window resize
      if (this.userViewModePreference) {
        this.viewMode = this.userViewModePreference;
      } else {
        this.viewMode = 'double';
      }

      const sidebar = document.getElementById('quickSidebar');
      if (sidebar) {
        sidebar.classList.remove('collapsed');
        const floatBtn = document.getElementById('btnFloatingSidebar');
        if (floatBtn) floatBtn.style.display = 'none';
      }
      if (sidebarTitle) sidebarTitle.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> 編集ツール`;
      if (floatBtnLabel) floatBtnLabel.innerText = `編集ツール`;
    }

    const icon = document.getElementById('iconMode');
    if (icon) icon.className = this.viewMode === 'double' ? 'fa-solid fa-book-open' : 'fa-solid fa-file';

    if (prevMode !== this.viewMode && this.pages.length > 0) {
      this.renderNotebookView();
    }
  }

  // Theme Management (5 Color Themes) - Saves Locally & Syncs to Google Account Cloud
  applyTheme(themeName, syncToCloud = true) {
    const body = document.getElementById('appBody');
    if (!body) return;

    body.className = themeName;
    this.currentTheme = themeName;
    localStorage.setItem('sn_current_theme', themeName);

    document.querySelectorAll('.theme-card').forEach((card) => {
      if (card.dataset.theme === themeName) card.classList.add('active');
      else card.classList.remove('active');
    });

    if (syncToCloud && this.currentUser && window.firebase && window.firebase.database) {
      try {
        firebase.database().ref(`users/${this.currentUser.uid}/settings/theme`).set(themeName);
      } catch (err) {
        console.warn('Cloud sync theme warning:', err);
      }
    }
  }

  setupThemePicker() {
    document.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const theme = card.dataset.theme;
        this.applyTheme(theme, true);
        this.closeModal('modalThemePicker');
        this.showToast(`🎨 テーマを変更しました！`);
      });
    });
  }

  // Horizontal Mouse Wheel Scroll for Top Tabs (Up to 30 Notebooks)
  setupTabScrollWheel() {
    const tabsScroll = document.getElementById('tabsScroll');
    if (tabsScroll) {
      tabsScroll.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          tabsScroll.scrollLeft += e.deltaY;
        }
      });
    }
  }

  // Initialize Official Firebase SDK & Auth Listener & Realtime Cloud Sync
  initFirebase() {
    try {
      if (window.firebase && window.firebaseConfig && window.firebaseConfig.apiKey !== 'YOUR_API_KEY') {
        this.firebaseApp = firebase.initializeApp(window.firebaseConfig);
        console.log('Firebase initialized successfully!');

        // Listen for Auth Redirect Result (Mobile & Pop-up blocked fallbacks)
        firebase.auth().getRedirectResult().then((result) => {
          if (result && result.user) {
            this.currentUser = result.user;
            this.showToast(`✨ Googleログイン完了: ${result.user.displayName || result.user.email}`);
            this.syncCloudDataOnLogin(result.user);
          }
        }).catch((err) => {
          console.warn('Redirect auth result warning:', err);
        });

        firebase.auth().onAuthStateChanged(async (user) => {
          this.currentUser = user;
          const lblAuth = document.getElementById('lblGoogleAuth');
          const sidebarSync = document.getElementById('sidebarCloudSyncStatus');

          if (user) {
            if (lblAuth) {
              lblAuth.title = `ログイン中: ${user.email || user.displayName}`;
              lblAuth.innerHTML = `<i class="fa-solid fa-user-check" style="color:var(--accent-green);"></i> ${this.escapeHtml(user.displayName || user.email)}`;
            }
            if (sidebarSync) {
              sidebarSync.title = user.email || '';
              sidebarSync.innerHTML = `☁️ クラウド同期ON<br><small style="font-size:0.68rem; color:var(--accent-cyan); font-weight:normal;">${this.escapeHtml(user.email || '')}</small>`;
              sidebarSync.className = 'status-value highlight-green';
            }
            await this.syncCloudDataOnLogin(user);

            // Listen for Realtime Cloud Updates across devices (Desktop ↔ Mobile)
            const uid = user.uid;
            const userRef = firebase.database().ref('users/' + uid);

            // Granular listeners to avoid downloading entire user tree on every change
            userRef.child('pages').on('value', async (snapshot) => {
              if (this.isSyncingLocalWrite) return;
              const val = snapshot.val();
              if (val) {
                const deletedPageIds = this.getDeletedPageIds();
                const deletedNbIds = this.getDeletedNotebookIds();
                const cloudPages = Object.values(val).filter((p) => !deletedPageIds.has(p.id) && !deletedNbIds.has(p.notebookId));
                await storageEngine.savePages(cloudPages);
                if (this.currentNotebookId) {
                  const updatedPages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
                  this.pages = updatedPages;
                  await this.renderNotebookView();
                }
              }
            });

            userRef.child('notebooks').on('value', async (snapshot) => {
              if (this.isSyncingLocalWrite) return;
              const val = snapshot.val();
              if (val) {
                const deletedNbIds = this.getDeletedNotebookIds();
                const cloudNbs = Object.values(val).filter((nb) => !deletedNbIds.has(nb.id));
                for (const nb of cloudNbs) {
                  await storageEngine.saveNotebook(nb);
                }
                await this.loadNotebooks();
              }
            });

            // Real-time synchronization of notebook deletions from other devices
            userRef.child('deletedNotebooks').on('child_added', async (snapshot) => {
              const deletedNbId = snapshot.key;
              if (!deletedNbId) return;
              this.recordDeletedNotebookId(deletedNbId);
              const localNbs = await storageEngine.getAllNotebooks();
              if (localNbs.some((n) => n.id === deletedNbId)) {
                await storageEngine.deleteNotebook(deletedNbId);
                if (this.currentNotebookId === deletedNbId) {
                  this.currentNotebookId = null;
                }
                await this.loadNotebooks();
                if (this.currentNotebookId) {
                  this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
                  await this.renderNotebookView();
                }
              }
            });

            userRef.child('notebooks').on('child_removed', async (snapshot) => {
              const removedNbId = snapshot.key;
              if (!removedNbId) return;
              this.recordDeletedNotebookId(removedNbId);
              const localNbs = await storageEngine.getAllNotebooks();
              if (localNbs.some((n) => n.id === removedNbId)) {
                await storageEngine.deleteNotebook(removedNbId);
                if (this.currentNotebookId === removedNbId) {
                  this.currentNotebookId = null;
                }
                await this.loadNotebooks();
                if (this.currentNotebookId) {
                  this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
                  await this.renderNotebookView();
                }
              }
            });

            userRef.child('deletedPages').on('child_added', async (snapshot) => {
              const deletedPageId = snapshot.key;
              if (!deletedPageId) return;
              this.recordDeletedPageId(deletedPageId);
              await storageEngine.deletePage(deletedPageId);
              if (this.currentNotebookId) {
                this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
                if (this.currentPageIndex >= this.pages.length) {
                  this.currentPageIndex = Math.max(0, this.pages.length - 1);
                }
                await this.renderNotebookView();
              }
            });

            userRef.child('images').on('value', async (snapshot) => {
              const val = snapshot.val();
              if (val) {
                for (const [imgId, base64Str] of Object.entries(val)) {
                  if (base64Str) {
                    const exists = await storageEngine.hasImage(imgId);
                    if (!exists) {
                      const blob = await this.base64ToBlob(base64Str);
                      await storageEngine.saveImage(imgId, blob);
                    }
                  }
                }
              }
            });

            userRef.child('settings/theme').on('value', (snapshot) => {
              const cloudTheme = snapshot.val();
              if (cloudTheme && cloudTheme !== this.currentTheme) {
                this.applyTheme(cloudTheme, false);
              }
            });
          } else {
            if (lblAuth) lblAuth.innerHTML = 'Google ログイン';
            if (sidebarSync) {
              sidebarSync.innerText = '📱 ローカル保存のみ';
              sidebarSync.className = 'status-value';
            }
          }
        });
      }
    } catch (err) {
      console.warn('Firebase init notice:', err);
    }
  }

  // Tombstone Deletion Sync Helpers (Prevents Zombie Resurrections across devices)
  getDeletedNotebookIds() {
    try {
      const stored = localStorage.getItem('sn_deleted_notebooks');
      if (!stored) return new Set();
      const arr = JSON.parse(stored);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  recordDeletedNotebookId(notebookId) {
    if (!notebookId) return;
    try {
      const set = this.getDeletedNotebookIds();
      set.add(notebookId);
      localStorage.setItem('sn_deleted_notebooks', JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn('Failed to record deleted notebook id', e);
    }
  }

  getDeletedPageIds() {
    try {
      const stored = localStorage.getItem('sn_deleted_pages');
      if (!stored) return new Set();
      const arr = JSON.parse(stored);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) {
      return new Set();
    }
  }

  recordDeletedPageId(pageId) {
    if (!pageId) return;
    try {
      const set = this.getDeletedPageIds();
      set.add(pageId);
      localStorage.setItem('sn_deleted_pages', JSON.stringify(Array.from(set)));
    } catch (e) {
      console.warn('Failed to record deleted page id', e);
    }
  }

  // Manual Cloud Sync Trigger Engine
  async forceManualCloudSync() {
    if (!this.currentUser) {
      this.showToast('ℹ️ 手動同期を行うにはGoogleログインが必要です');
      return;
    }

    const icon = document.getElementById('iconManualSync');
    if (icon) icon.classList.add('fa-spin');

    this.showToast('☁️ クラウドデータを同期中...');

    try {
      // 1. Fetch and merge latest cloud data into local storage (purges deleted notebooks/pages first!)
      await this.syncCloudDataOnLogin(this.currentUser);
      // 2. Immediately refresh current notebook view
      await this.loadNotebooks();
      if (this.currentNotebookId) {
        this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
        await this.renderNotebookView();
        await this.updatePlanUI();
      }
      this.showToast('✨ クラウド同期が最新化されました！');
    } catch (err) {
      console.warn('Manual sync error:', err);
      this.showToast('✨ クラウド同期完了！');
    } finally {
      if (icon) {
        setTimeout(() => icon.classList.remove('fa-spin'), 300);
      }
    }
  }

  // Account Cloud Sync Engine: Fetch & Bidirectionally Merge Data on Login
  async syncCloudDataOnLogin(user) {
    if (!user || !window.firebase || !window.firebase.database) return;

    await this.performLocalWrite(async () => {
      try {
        const uid = user.uid;
        const userRef = firebase.database().ref('users/' + uid);

        // Race snapshot fetch with a 5-second timeout guard to prevent infinite spinning
        const fetchPromise = userRef.once('value');
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
        const snapshot = await Promise.race([fetchPromise, timeoutPromise]);

        const val = snapshot ? snapshot.val() : null;

        if (val) {
          // 0. Synchronize Tombstones (Deleted Notebooks & Pages)
          const deletedNbSet = this.getDeletedNotebookIds();
          if (val.deletedNotebooks) {
            for (const delNbId of Object.keys(val.deletedNotebooks)) {
              deletedNbSet.add(delNbId);
            }
            localStorage.setItem('sn_deleted_notebooks', JSON.stringify(Array.from(deletedNbSet)));
          }

          const deletedPageSet = this.getDeletedPageIds();
          if (val.deletedPages) {
            for (const delPageId of Object.keys(val.deletedPages)) {
              deletedPageSet.add(delPageId);
            }
            localStorage.setItem('sn_deleted_pages', JSON.stringify(Array.from(deletedPageSet)));
          }

          // Purge any locally stored notebooks that have been deleted
          const currentLocalNbs = await storageEngine.getAllNotebooks();
          for (const nb of currentLocalNbs) {
            if (deletedNbSet.has(nb.id)) {
              await storageEngine.deleteNotebook(nb.id);
            }
          }

          // Purge any ghost notebook/page records in cloud if they exist in tombstones
          const cloudDeletes = {};
          if (val.notebooks) {
            for (const nbId of Object.keys(val.notebooks)) {
              if (deletedNbSet.has(nbId)) {
                cloudDeletes[`notebooks/${nbId}`] = null;
              }
            }
          }
          if (val.pages) {
            for (const pId of Object.keys(val.pages)) {
              if (deletedPageSet.has(pId) || (val.pages[pId] && deletedNbSet.has(val.pages[pId].notebookId))) {
                cloudDeletes[`pages/${pId}`] = null;
              }
            }
          }
          if (Object.keys(cloudDeletes).length > 0) {
            userRef.update(cloudDeletes).catch((e) => console.warn(e));
          }

          // 1. Sync & Merge Cloud Notebooks (ignoring deleted)
          if (val.notebooks) {
            const cloudNbs = Object.values(val.notebooks).filter((nb) => !deletedNbSet.has(nb.id));
            if (cloudNbs.length > 0) {
              // If local only has default placeholder "新規ノート", remove it so cloud notebooks cleanly take precedence!
              const remainingLocalNbs = await storageEngine.getAllNotebooks();
              if (remainingLocalNbs.length === 1 && (remainingLocalNbs[0].title === '新規ノート' || remainingLocalNbs[0].title.startsWith('新規ノート '))) {
                await storageEngine.deleteNotebook(remainingLocalNbs[0].id);
              }
            }
            for (const nb of cloudNbs) {
              await storageEngine.saveNotebook(nb);
            }
            // Keep current notebook if valid, otherwise select first cloud notebook
            const hasCurrent = cloudNbs.some((n) => n.id === this.currentNotebookId);
            if (!hasCurrent && cloudNbs.length > 0) {
              this.currentNotebookId = cloudNbs[0].id;
            }
          }

          // 2. Sync & Merge Cloud Pages (ignoring deleted)
          if (val.pages) {
            const cloudPages = Object.values(val.pages).filter((p) => !deletedPageSet.has(p.id) && !deletedNbSet.has(p.notebookId));
            await storageEngine.savePages(cloudPages);
          }

          // 3. On-Demand Image Sync (Only download images missing from IndexedDB)
          if (val.images) {
            for (const [imgId, base64Str] of Object.entries(val.images)) {
              if (base64Str) {
                try {
                  const exists = await storageEngine.hasImage(imgId);
                  if (!exists) {
                    const blob = this.base64ToBlob(base64Str);
                    if (blob) {
                      await storageEngine.saveImage(imgId, blob);
                    }
                  }
                } catch (imgErr) {
                  console.warn('Image sync error for:', imgId, imgErr);
                }
              }
            }
          }

          // 4. Batch Upload Any Local Notebooks / Pages Missing From Cloud (Skipping Deleted!)
          const localNbs = await storageEngine.getAllNotebooks();
          const missingNbsMap = {};
          const missingPagesMap = {};

          for (const localNb of localNbs) {
            if (deletedNbSet.has(localNb.id)) {
              await storageEngine.deleteNotebook(localNb.id);
              continue;
            }
            if (!val.notebooks || !val.notebooks[localNb.id]) {
              // Do not upload placeholder "新規ノート" if cloud already has existing notebooks
              if (localNb.title === '新規ノート' && val.notebooks && Object.keys(val.notebooks).length > 0) {
                continue;
              }
              missingNbsMap[localNb.id] = localNb;
            }
            const pgs = await storageEngine.getPagesForNotebook(localNb.id);
            if (pgs && pgs.length > 0) {
              for (const p of pgs) {
                if (deletedPageSet.has(p.id)) {
                  await storageEngine.deletePage(p.id);
                  continue;
                }
                if (!val.pages || !val.pages[p.id]) {
                  missingPagesMap[p.id] = p;
                }
              }
            }
          }

          if (Object.keys(missingNbsMap).length > 0) {
            firebase.database().ref(`users/${uid}/notebooks`).update(missingNbsMap).catch((err) => console.warn(err));
          }
          if (Object.keys(missingPagesMap).length > 0) {
            firebase.database().ref(`users/${uid}/pages`).update(missingPagesMap).catch((err) => console.warn(err));
          }

          // 5. Sync Cloud Theme Settings
          if (val.settings && val.settings.theme) {
            this.applyTheme(val.settings.theme, false);
          } else if (this.currentTheme) {
            firebase.database().ref(`users/${uid}/settings/theme`).set(this.currentTheme);
          }

          await this.loadNotebooks();
          if (this.currentNotebookId) {
            this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
            await this.renderNotebookView();
            await this.updatePlanUI();
          }
          this.showToast(`☁️ クラウド同期完了！ (${user.displayName || user.email})`);
        } else {
          // First login for this account: upload existing local notebooks & theme to cloud
          await this.syncAllLocalToCloud(user);
          await this.loadNotebooks();
          if (this.currentNotebookId) {
            this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
            await this.renderNotebookView();
            await this.updatePlanUI();
          }
          this.showToast(`☁️ アカウント初期化完了: ローカルノートをクラウドへ同期しました`);
        }
      } catch (err) {
        console.warn('Cloud sync error:', err);
      }
    });
  }

  async syncAllLocalToCloud(user) {
    if (!user || !window.firebase || !window.firebase.database) return;
    try {
      const uid = user.uid;
      const nbs = await storageEngine.getAllNotebooks();
      const deletedNbSet = this.getDeletedNotebookIds();
      const deletedPageSet = this.getDeletedPageIds();

      const nbsMap = {};
      const pagesMap = {};
      const imagesMap = {};

      for (const nb of nbs) {
        if (deletedNbSet.has(nb.id)) continue;
        // Skip dummy empty notebook if user has real notebooks
        if (nb.title === '新規ノート' && nbs.length > 1) continue;
        nbsMap[nb.id] = nb;
        const pgs = await storageEngine.getPagesForNotebook(nb.id);
        for (const p of pgs) {
          if (deletedPageSet.has(p.id)) continue;
          pagesMap[p.id] = p;
          if (p.blocks) {
            for (const b of p.blocks) {
              if ((b.type === 'image' || b.type === 'drawing') && b.imageId) {
                try {
                  const blobUrl = await storageEngine.getImageUrl(b.imageId);
                  if (blobUrl) {
                    const blob = await fetch(blobUrl).then((r) => r.blob());
                    const compressedBlob = await storageEngine.compressImage(blob, 1600, 0.8);
                    const base64 = await this.blobToBase64(compressedBlob);
                    imagesMap[b.imageId] = base64;
                  }
                } catch (imgErr) {
                  console.warn('Image sync to cloud warning for:', b.imageId, imgErr);
                }
              }
            }
          }
        }
      }

      const updates = {};
      if (Object.keys(nbsMap).length > 0) updates['notebooks'] = nbsMap;
      if (Object.keys(pagesMap).length > 0) updates['pages'] = pagesMap;
      if (Object.keys(imagesMap).length > 0) updates['images'] = imagesMap;
      updates['settings'] = { theme: this.currentTheme };
      updates['updatedAt'] = Date.now();

      await firebase.database().ref('users/' + uid).update(updates);
    } catch (err) {
      console.warn('Sync all local to cloud error:', err);
    }
  }

  async syncNotebookToCloud(notebook) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      await firebase.database().ref(`users/${this.currentUser.uid}/notebooks/${notebook.id}`).set(notebook);
    } catch (err) {
      console.warn('Cloud sync notebook warning:', err);
    }
  }

  async syncPagesToCloud(pages) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      const pagesMap = {};
      for (const p of pages) {
        pagesMap[p.id] = p;
      }
      await firebase.database().ref(`users/${this.currentUser.uid}/pages`).update(pagesMap);
    } catch (err) {
      console.warn('Cloud sync pages warning:', err);
    }
  }

  async syncImageToCloud(imageId, blob) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      // Compress image before converting to Base64 to prevent payload bloat & network lag
      const compressedBlob = await storageEngine.compressImage(blob, 1600, 0.80);
      const base64 = await this.blobToBase64(compressedBlob);
      await firebase.database().ref(`users/${this.currentUser.uid}/images/${imageId}`).set(base64);
    } catch (err) {
      console.warn('Cloud sync image warning:', err);
    }
  }

  async deleteNotebookFromCloud(notebookId, pageIds = []) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      const uid = this.currentUser.uid;
      const updates = {};
      updates[`notebooks/${notebookId}`] = null;
      updates[`deletedNotebooks/${notebookId}`] = Date.now();
      if (pageIds && pageIds.length > 0) {
        for (const pid of pageIds) {
          updates[`pages/${pid}`] = null;
          updates[`deletedPages/${pid}`] = Date.now();
        }
      }
      await firebase.database().ref(`users/${uid}`).update(updates);
    } catch (err) {
      console.warn('Cloud delete notebook warning:', err);
    }
  }

  async deletePageFromCloud(pageId) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      const uid = this.currentUser.uid;
      const updates = {};
      updates[`pages/${pageId}`] = null;
      updates[`deletedPages/${pageId}`] = Date.now();
      await firebase.database().ref(`users/${uid}`).update(updates);
    } catch (err) {
      console.warn('Cloud delete page warning:', err);
    }
  }

  // Handle Google OAuth 1-Click Login (Auto-Redirect on Mobile to bypass popup blockers)
  async handleGoogleAuth() {
    if (!window.firebase || !window.firebase.auth) {
      alert('Firebase SDKの読み込み準備中です');
      return;
    }

    if (this.currentUser) {
      if (confirm(`現在 「${this.currentUser.displayName || this.currentUser.email}」 としてログインしています。\nログアウトしますか？`)) {
        await firebase.auth().signOut();
        this.showToast('ログアウトしました');
      }
      return;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      provider.setCustomParameters({ prompt: 'select_account' });

      // Try popup first (works smoothly on modern mobile Safari/Chrome without redirect state loss)
      try {
        await firebase.auth().signInWithPopup(provider);
        return;
      } catch (popupErr) {
        console.warn('Popup login attempt notice:', popupErr.code, popupErr.message);
        // If popup was blocked or failed on mobile, proceed to redirect
        this.showToast('Googleログイン画面へ移動します...');
        await firebase.auth().signInWithRedirect(provider);
      }
    } catch (err) {
      console.warn('Google Auth Error:', err);
      if (err.code === 'auth/unauthorized-domain') {
        alert('Firebase承認ドメイン設定が必要です。\nFirebase Console -> Authentication -> Settings -> Authorized domains に 「strategy-notebook-app.web.app」 を追加してください。');
      } else if (err.code === 'auth/operation-not-allowed') {
        alert('Firebase ConsoleでGoogleログインプロバイダが有効化されていません。');
      } else if (err.code === 'auth/popup-closed-by-user') {
        this.showToast('ログインがキャンセルされました');
      } else {
        alert(`Googleログインエラー: ${err.message || err.code || err}\n※LINEやTwitterアプリ内のブラウザではGoogleログインがブロックされるため、SafariまたはChromeで開いてください。`);
      }
    }
  }

  // Live Stream Broadcasting & Viewer Synchronized Viewing Engine
  startLiveStreamHost() {
    const randomCode = 'LIVE-' + Math.floor(1000 + Math.random() * 9000);
    this.currentRoomCode = randomCode;
    this.liveStreamState = 'host';
    this.maxViewers = 10; // Enforce strict 10 total limit

    const hostBox = document.getElementById('hostRoomBox');
    const hostDisplay = document.getElementById('hostRoomCodeDisplay');
    const lblBtn = document.getElementById('lblLiveStreamBtn');

    if (hostBox) hostBox.style.display = 'block';
    if (hostDisplay) hostDisplay.innerText = randomCode;
    if (lblBtn) lblBtn.innerHTML = `<span style="color:var(--accent-red); font-weight:bold;">📡 配信中 (${randomCode})</span>`;

    // Publish to Firebase Realtime Database
    this.broadcastHostPageToCloud();

    this.showToast(`📡 Firebase 配信を開始しました！(部屋コード: ${randomCode} / 上限: 配信者含め10名)`);
  }

  // Stop Live Broadcast Host Mode
  stopLiveStreamHost() {
    if (this.liveStreamState !== 'host' && !this.currentRoomCode) {
      this.showToast('現在配信を行っていません');
      return;
    }

    if (confirm(`配信ルーム 【${this.currentRoomCode || ''}】 を解散して配信を終了しますか？`)) {
      if (window.firebase && window.firebase.database && this.currentRoomCode) {
        try {
          firebase.database().ref('rooms/' + this.currentRoomCode).remove();
        } catch (err) {
          console.warn('Realtime DB remove error:', err);
        }
      }

      this.liveStreamState = 'none';
      const oldCode = this.currentRoomCode;
      this.currentRoomCode = null;

      const hostBox = document.getElementById('hostRoomBox');
      const lblBtn = document.getElementById('lblLiveStreamBtn');

      if (hostBox) hostBox.style.display = 'none';
      if (lblBtn) lblBtn.innerHTML = `📡 ライブ連動`;

      this.closeModal('modalLiveStream');
      this.showToast(`🛑 配信ルーム (${oldCode}) を解散し、配信を終了しました`);
    }
  }

  copyRoomCodeToClipboard() {
    if (!this.currentRoomCode) return;
    navigator.clipboard.writeText(this.currentRoomCode).then(() => {
      const lbl = document.getElementById('lblCopyRoomCode');
      if (lbl) {
        lbl.innerText = '✅ コピー完了！';
        setTimeout(() => (lbl.innerText = '部屋コードをコピー'), 2000);
      }
      this.showToast(`📋 部屋コード 【${this.currentRoomCode}】 をクリップボードにコピーしました！`);
    }).catch((err) => {
      console.error('Copy failed:', err);
      this.showToast(`部屋コード: ${this.currentRoomCode}`);
    });
  }

  broadcastHostPageToCloud() {
    if (this.liveStreamState === 'host' && this.currentRoomCode && window.firebase && window.firebase.database) {
      try {
        const roomRef = firebase.database().ref('rooms/' + this.currentRoomCode);
        roomRef.set({
          pageIndex: this.currentPageIndex,
          notebookId: this.currentNotebookId,
          maxViewers: 10,
          timestamp: Date.now()
        });
      } catch (err) {
        console.warn('Realtime DB write warning:', err);
      }
    }
  }

  joinLiveStreamViewer() {
    const inputEl = document.getElementById('inputViewerRoomCode');
    const codeInput = inputEl ? inputEl.value.trim().toUpperCase() : '';
    if (!codeInput) {
      alert('部屋コードを入力してください (例: LIVE-8849)');
      return;
    }

    this.currentRoomCode = codeInput;
    this.liveStreamState = 'viewer';

    const lblBtn = document.getElementById('lblLiveStreamBtn');
    if (lblBtn) lblBtn.innerHTML = `<span style="color:var(--accent-cyan); font-weight:bold;">📡 視聴連動中 (${codeInput})</span>`;
    this.closeModal('modalLiveStream');

    // Subscribe to Firebase Realtime Database Stream
    if (window.firebase && window.firebase.database) {
      try {
        if (this.liveRoomRef) this.liveRoomRef.off();
        this.liveRoomRef = firebase.database().ref('rooms/' + codeInput);
        this.liveRoomRef.on('value', (snapshot) => {
          const val = snapshot.val();
          if (val && typeof val.pageIndex === 'number') {
            if (val.pageIndex !== this.currentPageIndex) {
              this.jumpToPage(val.pageIndex);
              this.showToast(`📡 配信者が P.${val.pageIndex + 1} へめくりました！`);
            }
          }
        });
      } catch (err) {
        console.warn('Realtime DB listener warning:', err);
      }
    }

    this.showToast(`📡 Firebase 配信 (${codeInput}) に連動参加しました！(閲覧専用・自動めくり連動中)`);
  }

  // Stop Watching Live Stream (Leave Viewer Mode)
  leaveLiveStreamViewer() {
    if (this.liveStreamState !== 'viewer' && !this.liveRoomRef) {
      this.showToast('現在配信を視聴していません');
      return;
    }

    if (confirm(`配信の視聴連動を解除して退出しますか？`)) {
      if (this.liveRoomRef) {
        try {
          this.liveRoomRef.off();
        } catch (err) {
          console.warn('Realtime DB listener off error:', err);
        }
        this.liveRoomRef = null;
      }

      this.liveStreamState = 'none';
      const oldCode = this.currentRoomCode;
      this.currentRoomCode = null;

      const lblBtn = document.getElementById('lblLiveStreamBtn');
      if (lblBtn) lblBtn.innerHTML = `📡 ライブ連動`;

      this.closeModal('modalLiveStream');
      this.showToast(`🛑 配信 (${oldCode}) の視聴連動を解除（退出）しました`);
    }
  }

  // Toggle Plan Simulator (Free vs Paid Tier Test)
  toggleUserPlanSimulator(forcePlan = null) {
    if (forcePlan) {
      this.userPlan = forcePlan;
    } else {
      this.userPlan = this.userPlan === 'free' ? 'paid' : 'free';
    }

    this.updatePlanUI();

    if (this.userPlan === 'paid') {
      this.showToast('👑 有料プランに切り替えました！（広告非表示・作成上限30冊）');
    } else {
      this.showToast('🆓 無料プランに切り替えました（最大10冊/合計30P制限）');
    }
  }

  async updatePlanUI() {
    const btnBadge = document.getElementById('btnPlanSimulator');
    const lblBadge = document.getElementById('lblPlanBadge');
    const iconPlan = document.getElementById('iconPlan');
    const adBar = document.getElementById('adBannerBar');

    const sidebarPlanName = document.getElementById('sidebarPlanName');
    const sidebarNbUsage = document.getElementById('sidebarNbUsage');
    const sidebarPageUsage = document.getElementById('sidebarPageUsage');

    const totalPagesCount = await this.calculateTotalPagesAllNotebooks();

    if (this.userPlan === 'paid') {
      if (btnBadge) btnBadge.className = 'btn-plan-badge paid-plan';
      if (iconPlan) iconPlan.className = 'fa-solid fa-crown';
      if (lblBadge) lblBadge.innerText = '👑 有料プラン (30冊)';
      if (adBar) adBar.style.display = 'none';

      if (sidebarPlanName) sidebarPlanName.innerText = '👑 有料プラン';
      if (sidebarNbUsage) sidebarNbUsage.innerText = `${this.notebooks.length} / 30 冊`;
      if (sidebarPageUsage) sidebarPageUsage.innerText = `${totalPagesCount} ページ`;
    } else {
      if (btnBadge) btnBadge.className = 'btn-plan-badge free-plan';
      if (iconPlan) iconPlan.className = 'fa-solid fa-seedling';
      if (lblBadge) lblBadge.innerText = '🆓 無料 (10冊/30P)';
      if (adBar) adBar.style.display = 'flex';

      if (sidebarPlanName) sidebarPlanName.innerText = '🆓 無料プラン';
      if (sidebarNbUsage) sidebarNbUsage.innerText = `${this.notebooks.length} / 10 冊`;
      if (sidebarPageUsage) sidebarPageUsage.innerText = `${totalPagesCount} / 30 ページ`;
    }
  }

  async calculateTotalPagesAllNotebooks() {
    let count = 0;
    for (const nb of this.notebooks) {
      const pgs = await storageEngine.getPagesForNotebook(nb.id);
      count += pgs.length;
    }
    return count;
  }

  // Web Audio Synthetic Paper Sound Generator
  playPageFlipSound() {
    if (!this.soundEnabled) return;
    try {
      if (!this.audioCtx) {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const bufferSize = this.audioCtx.sampleRate * 0.15;
      const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const output = buffer.getChannelData(0);

      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11;
        b6 = white * 0.115926;
      }

      const whiteNoise = this.audioCtx.createBufferSource();
      whiteNoise.buffer = buffer;

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, this.audioCtx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(300, this.audioCtx.currentTime + 0.15);

      const gainNode = this.audioCtx.createGain();
      gainNode.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.15);

      whiteNoise.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);

      whiteNoise.start();
    } catch (err) {
      console.warn('Audio play error:', err);
    }
  }

  // Load Notebooks & Tabs
  async loadNotebooks() {
    this.notebooks = await storageEngine.getAllNotebooks();
    if (this.notebooks.length === 0) {
      await storageEngine.seedInitialDataIfEmpty();
      this.notebooks = await storageEngine.getAllNotebooks();
    }
    if (this.notebooks.length === 0) return;

    if (!this.currentNotebookId || !this.notebooks.some((n) => n.id === this.currentNotebookId)) {
      this.currentNotebookId = this.notebooks[0].id;
    }

    this.renderTabs();
    await this.loadCurrentNotebookPages();
    await this.updatePlanUI();
  }

  // Render Top Notebook Tabs with Auto-Scroll & Rename Icon
  renderTabs() {
    const tabsScroll = document.getElementById('tabsScroll');
    if (!tabsScroll) return;

    tabsScroll.innerHTML = '';

    this.notebooks.forEach((nb) => {
      const isCurrent = nb.id === this.currentNotebookId;
      const tabEl = document.createElement('div');
      tabEl.className = `tab-item ${isCurrent ? 'active' : ''}`;
      tabEl.title = 'ダブルクリックまたは鉛筆アイコンで名前を変更';
      tabEl.innerHTML = `
        <i class="fa-solid ${nb.icon || 'fa-book'}"></i>
        <span class="tab-title">${this.escapeHtml(nb.title)}</span>
        <i class="fa-solid fa-pen tab-rename" data-id="${nb.id}" title="ノート名を変更"></i>
        ${this.notebooks.length > 1 ? `<i class="fa-solid fa-xmark tab-close" data-id="${nb.id}"></i>` : ''}
      `;

      if (isCurrent) {
        setTimeout(() => {
          tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 60);
      }

      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')) {
          e.stopPropagation();
          this.deleteNotebook(nb.id);
          return;
        }
        if (e.target.classList.contains('tab-rename')) {
          e.stopPropagation();
          this.renameNotebook(nb.id);
          return;
        }
        this.switchNotebook(nb.id);
      });

      tabEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.renameNotebook(nb.id);
      });

      tabsScroll.appendChild(tabEl);
    });

    const activeNb = this.getActiveNotebook();
    const titleEl = document.getElementById('activeNotebookTitle');
    if (activeNb && titleEl) {
      titleEl.innerText = activeNb.title;
    }
  }

  // Rename Notebook Title Engine with Local Write Protection Lock
  async renameNotebook(notebookId = null) {
    const targetId = notebookId || this.currentNotebookId;
    const nb = this.notebooks.find((n) => n.id === targetId);
    if (!nb) return;

    const newTitle = prompt('ノートの新しい名前（タイトル）を入力してください:', nb.title);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === nb.title) return;

    await this.performLocalWrite(async () => {
      nb.title = newTitle.trim();
      await storageEngine.saveNotebook(nb);
      this.renderTabs();
      const activeNb = this.getActiveNotebook();
      const titleEl = document.getElementById('activeNotebookTitle');
      if (activeNb && titleEl) {
        titleEl.innerText = activeNb.title;
      }
      this.showToast(`✨ ノート名を 「${nb.title}」 に変更しました！`);
      this.syncNotebookToCloud(nb).catch(err => console.warn(err));
    });
  }

  async switchNotebook(notebookId) {
    this.currentNotebookId = notebookId;
    this.currentPageIndex = 0;
    this.activeTargetPageIndex = 0;
    this.renderTabs();
    await this.loadCurrentNotebookPages();
    this.showToast(`ノート切替: ${this.getActiveNotebook().title}`);
  }

  // Create New Notebook Engine with Local Write Protection Lock & Instant Zero-Latency Creation
  async createNewNotebook() {
    const maxNbLimit = this.userPlan === 'paid' ? 30 : 10;

    if (this.notebooks.length >= maxNbLimit) {
      if (this.userPlan === 'free') {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ノート作成上限（10冊）に達しました';
        if (descEl) descEl.innerHTML = '無料プランで作成できるノートは<b>最大10冊</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
      } else {
        alert('👑 ノート作成上限（30冊）に達しました。');
      }
      return;
    }

    const defaultTitle = `新規ノート ${this.notebooks.length + 1}`;
    let rawTitle = prompt('新しいノートのタイトルを入力してください:', defaultTitle);
    
    // User explicitly clicked Cancel in prompt dialog
    if (rawTitle === null) return;

    const title = (rawTitle && rawTitle.trim()) ? rawTitle.trim() : defaultTitle;

    await this.performLocalWrite(async () => {
      const newNb = {
        id: 'nb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        title: title,
        icon: 'fa-book',
        createdAt: Date.now()
      };

      const firstPage = {
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        notebookId: newNb.id,
        pageIndex: 0,
        bookmarkLabel: '概要',
        isLocked: false,
        blocks: [
          { type: 'note', text: 'ここにスクショや図解、手順説明テキストを配置できます。' }
        ]
      };

      // 1. Save to local IndexedDB first for instant UI creation
      await storageEngine.saveNotebook(newNb);
      await storageEngine.savePages([firstPage]);

      this.currentNotebookId = newNb.id;
      this.currentPageIndex = 0;
      this.activeTargetPageIndex = 0;

      // 2. Render UI tabs and switch to new notebook immediately
      await this.loadNotebooks();
      this.showToast(`✨ 新しいノート 「${newNb.title}」 を作成しました！`);

      // 3. Sync to cloud asynchronously in background without delaying UI
      this.syncNotebookToCloud(newNb).catch(err => console.warn(err));
      this.syncPagesToCloud([firstPage]).catch(err => console.warn(err));
    });
  }

  async deleteNotebook(notebookId) {
    const targetNb = this.notebooks.find((n) => n.id === notebookId);
    const title = targetNb ? targetNb.title : 'このノート';
    if (!confirm(`「${title}」と含まれる全ページを削除しますか？\n（連携しているすべての端末・クラウドからも完全に削除されます）`)) return;

    await this.performLocalWrite(async () => {
      this.recordDeletedNotebookId(notebookId);
      const localPages = await storageEngine.getPagesForNotebook(notebookId);
      const pageIds = (localPages || []).map((p) => p.id);
      for (const pid of pageIds) {
        this.recordDeletedPageId(pid);
      }

      await storageEngine.deleteNotebook(notebookId);
      if (this.currentNotebookId === notebookId) {
        this.currentNotebookId = null;
      }
      await this.loadNotebooks();
      if (this.currentNotebookId) {
        this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
        await this.renderNotebookView();
      }
      this.showToast(`🗑️ 「${title}」を削除しました（他端末にも同期されます）`);
      this.deleteNotebookFromCloud(notebookId, pageIds).catch((err) => console.warn(err));
    });
  }

  async loadCurrentNotebookPages() {
    this.pages = await storageEngine.getPagesForNotebook(this.currentNotebookId);
    if (this.pages.length === 0) {
      const emptyPage = {
        id: 'p_' + Date.now(),
        notebookId: this.currentNotebookId,
        pageIndex: 0,
        bookmarkLabel: '',
        isLocked: false,
        blocks: []
      };
      await storageEngine.savePages([emptyPage]);
      await this.syncPagesToCloud([emptyPage]);
      this.pages = [emptyPage];
    }

    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = Math.max(0, this.pages.length - 1);
    }
    this.activeTargetPageIndex = this.currentPageIndex;

    await this.renderNotebookView();
  }

  // Set Active Target Page for Sidebar Editing
  setActiveTargetPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= this.pages.length) return;
    this.activeTargetPageIndex = pageIndex;
    this.updateActivePageSelectionUI();
  }

  updateActivePageSelectionUI() {
    const activePageNum = this.activeTargetPageIndex + 1;

    this.renderSidebarPageTargetSelector();

    const lblFile = document.getElementById('lblSelectFileBtn');
    const lblBm = document.getElementById('lblSetBookmarkBtn');
    const lblIns = document.getElementById('lblInsertPageBtn');
    const lblDup = document.getElementById('lblDuplicatePageBtn');
    const lblDel = document.getElementById('lblDeletePageBtn');

    if (lblFile) lblFile.innerText = `P.${activePageNum} に画像ファイル選択`;
    if (lblBm) lblBm.innerText = `P.${activePageNum} にインデックスをつける`;
    if (lblIns) lblIns.innerText = `P.${activePageNum} の後ろにページ挿入`;
    if (lblDup) lblDup.innerText = `P.${activePageNum} を複製 (ページコピー)`;
    if (lblDel) lblDel.innerText = `P.${activePageNum} を削除`;

    const lblSnip = document.getElementById('lblSnippingBtn');
    if (lblSnip) lblSnip.innerText = `✂️ P.${activePageNum} に画面スニッピング`;
    const lblConfirmSnip = document.getElementById('lblConfirmSnipBtn');
    if (lblConfirmSnip) lblConfirmSnip.innerText = `📥 この範囲を P.${activePageNum} に貼り付ける`;

    document.querySelectorAll('.notebook-page').forEach((pageEl) => {
      const idx = parseInt(pageEl.dataset.index);
      if (idx === this.activeTargetPageIndex) {
        pageEl.classList.add('is-active-target');
      } else {
        pageEl.classList.remove('is-active-target');
      }
    });

    this.updatePageLockSidebarButton();
  }

  renderSidebarPageTargetSelector() {
    const container = document.getElementById('pageTargetButtons');
    if (!container) return;

    container.innerHTML = '';

    const leftIdx = this.currentPageIndex;
    const rightIdx = leftIdx + 1;

    const btnLeft = document.createElement('button');
    btnLeft.className = `btn-page-target ${this.activeTargetPageIndex === leftIdx ? 'active' : ''}`;
    btnLeft.innerHTML = `<i class="fa-solid fa-file"></i> P.${leftIdx + 1} (左)`;
    btnLeft.addEventListener('click', () => this.setActiveTargetPage(leftIdx));
    container.appendChild(btnLeft);

    if (this.viewMode === 'double' && rightIdx < this.pages.length) {
      const btnRight = document.createElement('button');
      btnRight.className = `btn-page-target ${this.activeTargetPageIndex === rightIdx ? 'active' : ''}`;
      btnRight.innerHTML = `<i class="fa-solid fa-file"></i> P.${rightIdx + 1} (右)`;
      btnRight.addEventListener('click', () => this.setActiveTargetPage(rightIdx));
      container.appendChild(btnRight);
    }
  }

  // Render Notebook View
  async renderNotebookView() {
    const isMobile = this.isMobileDevice();
    if (isMobile) {
      this.viewMode = 'single';
    }

    const bookWrapper = document.getElementById('bookWrapper');
    if (bookWrapper) bookWrapper.className = `book-wrapper mode-${this.viewMode}`;

    this.renderPageBookmarksBar();

    const bookContainer = document.getElementById('bookContainer');
    if (!bookContainer) return;

    bookContainer.className = `book-container mode-${this.viewMode}`;
    bookContainer.innerHTML = '';

    const totalPages = this.pages.length;
    const countEl = document.getElementById('totalPagesCount');
    const inputEl = document.getElementById('pageNumberInput');

    if (countEl) countEl.innerText = `/ ${totalPages} ページ`;
    if (inputEl) {
      inputEl.value = this.currentPageIndex + 1;
      inputEl.max = totalPages;
    }

    if (this.viewMode === 'double' && !isMobile) {
      const leftIndex = this.currentPageIndex;
      const rightIndex = leftIndex + 1;

      const leftPageEl = await this.createPageElement(leftIndex, 'left');
      bookContainer.appendChild(leftPageEl);

      if (rightIndex < totalPages) {
        const rightPageEl = await this.createPageElement(rightIndex, 'right');
        bookContainer.appendChild(rightPageEl);
      } else {
        const emptyRight = document.createElement('div');
        emptyRight.className = 'notebook-page empty-page';
        emptyRight.innerHTML = `
          <div class="empty-placeholder">
            <i class="fa-solid fa-book-medical"></i>
            <p style="font-weight:bold; color:var(--text-main);">【ノートの末尾】</p>
            <small style="color:var(--text-dim);">次のページを作成してめくります</small>
            <button class="btn-primary" onclick="app.addNewPage()"><i class="fa-solid fa-plus"></i> 末尾にページ追加</button>
          </div>
        `;
        bookContainer.appendChild(emptyRight);
      }
    } else {
      const pageEl = await this.createPageElement(this.currentPageIndex, 'single');
      bookContainer.appendChild(pageEl);
    }

    this.updateActivePageSelectionUI();
    this.broadcastHostPageToCloud();
  }

  // Sidebar Page Lock Sync for Currently Active Target Page
  updatePageLockSidebarButton() {
    const targetPage = this.pages[this.activeTargetPageIndex];
    const isLocked = targetPage ? !!targetPage.isLocked : false;

    const iconLock = document.getElementById('iconLockBtn');
    const lblLock = document.getElementById('lblLockBtn');
    const btnLock = document.getElementById('btnTogglePageLock');
    const pNum = this.activeTargetPageIndex + 1;

    if (btnLock) {
      if (isLocked) {
        if (iconLock) iconLock.className = 'fa-solid fa-lock';
        if (lblLock) lblLock.innerText = `P.${pNum} ロック解除`;
        btnLock.style.borderColor = 'var(--accent-green)';
        btnLock.style.color = 'var(--accent-green)';
      } else {
        if (iconLock) iconLock.className = 'fa-solid fa-lock-open';
        if (lblLock) lblLock.innerText = `P.${pNum} を編集ロック`;
        btnLock.style.borderColor = 'var(--accent-amber)';
        btnLock.style.color = 'var(--accent-amber)';
      }
    }
  }

  async togglePageLock(targetPageIndex = null) {
    const idx = targetPageIndex !== null ? targetPageIndex : this.activeTargetPageIndex;
    const pageObj = this.pages[idx];
    if (!pageObj) return;

    await this.performLocalWrite(async () => {
      pageObj.isLocked = !pageObj.isLocked;
      await this.saveCurrentPagesState();
      await this.renderNotebookView();

      if (pageObj.isLocked) {
        this.showToast(`🔒 P.${idx + 1} を編集ロックしました`);
      } else {
        this.showToast(`🔓 P.${idx + 1} のロックを解除しました`);
      }
    });
  }

  // Render Page Chapter Bookmark Tabs
  renderPageBookmarksBar() {
    const bar = document.getElementById('pageBookmarksBar');
    if (!bar) return;

    bar.innerHTML = '';

    this.pages.forEach((p, idx) => {
      if (!p.bookmarkLabel || !p.bookmarkLabel.trim()) return;

      const labelText = p.bookmarkLabel.trim();
      const tab = document.createElement('div');
      tab.className = `bookmark-tab ${idx === this.currentPageIndex || (this.viewMode === 'double' && idx === this.currentPageIndex + 1) ? 'active' : ''}`;
      tab.innerText = labelText;
      tab.title = `P.${idx + 1}: 「${labelText}」 にジャンプ`;

      tab.addEventListener('click', () => {
        this.jumpToPage(idx);
      });

      bar.appendChild(tab);
    });
  }

  async setBookmarkLabelForCurrentPage() {
    const targetPage = this.pages[this.activeTargetPageIndex];
    if (!targetPage) return;
    if (targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const currentLabel = targetPage.bookmarkLabel || '';
    const label = prompt(`P.${this.activeTargetPageIndex + 1} のインデックス見出しを入力してください:`, currentLabel);

    if (label === null) return;

    await this.performLocalWrite(async () => {
      targetPage.bookmarkLabel = label.trim().substring(0, 6);
      await this.saveCurrentPagesState();
      this.renderPageBookmarksBar();

      if (targetPage.bookmarkLabel) {
        this.showToast(`P.${this.activeTargetPageIndex + 1} にインデックス 「${targetPage.bookmarkLabel}」 をつけました`);
      } else {
        this.showToast('インデックスを解除しました');
      }
    });
  }

  async removeBookmarkLabelForCurrentPage() {
    const targetPage = this.pages[this.activeTargetPageIndex];
    if (!targetPage) return;
    if (targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    await this.performLocalWrite(async () => {
      targetPage.bookmarkLabel = '';
      await this.saveCurrentPagesState();
      this.renderPageBookmarksBar();
      this.showToast(`P.${this.activeTargetPageIndex + 1} のインデックスを解除しました`);
    });
  }

  // Create Page Element with Alignment, Floating Layouts & In-Between Divider Insertion
  async createPageElement(pageIndex, side = 'single') {
    const pageData = this.pages[pageIndex];
    const isLocked = pageData ? !!pageData.isLocked : false;
    const isActiveTarget = pageIndex === this.activeTargetPageIndex;

    const pageEl = document.createElement('div');
    pageEl.className = `notebook-page ${isLocked ? 'is-locked' : ''} ${isActiveTarget ? 'is-active-target' : ''}`;
    pageEl.dataset.index = pageIndex;

    pageEl.addEventListener('click', (e) => {
      if (e.target.closest('.btn-page-lock-toggle') || e.target.closest('.page-corner-curl-left') || e.target.closest('.page-corner-curl-right')) {
        return;
      }
      this.setActiveTargetPage(pageIndex);
    });

    pageEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      pageEl.style.borderColor = 'var(--accent-cyan)';
    });

    pageEl.addEventListener('dragleave', () => {
      if (pageIndex !== this.activeTargetPageIndex) {
        pageEl.style.borderColor = 'transparent';
      }
    });

    pageEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setActiveTargetPage(pageIndex);

      if (isLocked) {
        this.showToast('⚠️ このページは編集ロックされています');
        return;
      }

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        for (const file of e.dataTransfer.files) {
          if (file.type.startsWith('image/')) {
            await this.processAndInsertImageToTargetPage(file, pageIndex);
          }
        }
      }
    });

    if (isActiveTarget) {
      const activeBadge = document.createElement('div');
      activeBadge.className = 'page-active-badge';
      activeBadge.innerHTML = `<i class="fa-solid fa-pen"></i> 選択中 (P.${pageIndex + 1})`;
      pageEl.appendChild(activeBadge);
    }

    if (side === 'left' || side === 'single') {
      const cornerCurlLeft = document.createElement('div');
      cornerCurlLeft.className = 'page-corner-curl-left';
      cornerCurlLeft.title = '前のページへ戻る';
      cornerCurlLeft.addEventListener('click', () => this.prevPage());
      pageEl.appendChild(cornerCurlLeft);
    }

    if (side === 'right' || side === 'single') {
      const cornerCurlRight = document.createElement('div');
      cornerCurlRight.className = 'page-corner-curl-right';
      cornerCurlRight.title = '次のページへめくる';
      cornerCurlRight.addEventListener('click', () => this.nextPage());
      pageEl.appendChild(cornerCurlRight);
    }

    const contentScrollEl = document.createElement('div');
    contentScrollEl.className = 'page-content-scroll';

    if (!pageData || !pageData.blocks || pageData.blocks.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-placeholder';
      emptyDiv.style.margin = 'auto';
      emptyDiv.innerHTML = `
        <i class="fa-solid fa-paste"></i>
        <p style="font-weight:bold; color:var(--accent-cyan);">ページ ${pageIndex + 1} （未編集）</p>
        <small style="color:var(--text-dim); margin-bottom:8px;">「Ctrl + V」でスクショ貼り付け または ここへドラッグ＆ドロップ</small>
        ${!isLocked ? `<button class="btn-secondary btn-sm" onclick="app.addTextBlock()"><i class="fa-solid fa-font"></i> メモ文字を追加</button>` : ''}
      `;
      contentScrollEl.appendChild(emptyDiv);
    } else {
      for (let i = 0; i < pageData.blocks.length; i++) {
        const block = pageData.blocks[i];

        // In-Between Insertion Divider Bar (Insert Before Element)
        if (!isLocked) {
          const dividerEl = document.createElement('div');
          dividerEl.className = 'block-insert-divider';
          dividerEl.title = 'ここに新しい要素を挿入';
          dividerEl.innerHTML = `<button class="btn-insert-here"><i class="fa-solid fa-plus"></i> ここに挿入</button>`;
          dividerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.promptInsertBlockAtIndex(pageIndex, i);
          });
          contentScrollEl.appendChild(dividerEl);
        }

        const blockEl = document.createElement('div');
        const alignClass = block.alignClass || 'align-center';
        blockEl.className = `page-block ${alignClass}`;

        if (!isLocked) {
          const actionsEl = document.createElement('div');
          actionsEl.className = 'block-actions';

          // Up / Down Reorder Buttons
          actionsEl.innerHTML = `
            <button class="btn-subtle btn-up" title="上へ移動"><i class="fa-solid fa-chevron-up"></i></button>
            <button class="btn-subtle btn-down" title="下へ移動"><i class="fa-solid fa-chevron-down"></i></button>
          `;

          // Alignment / Floating Buttons for Images, Drawings & Text Blocks
          const currentSize = block.sizeClass || 'size-large';
          if (block.type === 'image' || block.type === 'drawing') {
            actionsEl.innerHTML += `
              <button class="size-btn ${currentSize === 'size-small' ? 'active' : ''}" title="小 (45%)" data-size="size-small">小</button>
              <button class="size-btn ${currentSize === 'size-medium' ? 'active' : ''}" title="中 (72%)" data-size="size-medium">中</button>
              <button class="size-btn ${currentSize === 'size-large' ? 'active' : ''}" title="大 (100%)" data-size="size-large">大</button>
              <button class="align-btn ${alignClass === 'align-left' ? 'active' : ''}" title="左寄せ" data-align="align-left"><i class="fa-solid fa-align-left"></i></button>
              <button class="align-btn ${alignClass === 'align-center' ? 'active' : ''}" title="中央寄せ" data-align="align-center"><i class="fa-solid fa-align-center"></i></button>
              <button class="align-btn ${alignClass === 'align-right' ? 'active' : ''}" title="右寄せ" data-align="align-right"><i class="fa-solid fa-align-right"></i></button>
              <button class="align-btn ${alignClass === 'align-float' ? 'active' : ''}" title="文字回り込み(左配置)" data-align="align-float"><i class="fa-solid fa-indent"></i> 回り込み</button>
              <button class="btn-subtle btn-del-block" title="削除"><i class="fa-solid fa-trash" style="color:#ef4444;"></i></button>
            `;
          } else {
            actionsEl.innerHTML += `
              <button class="size-btn ${currentSize === 'size-small' ? 'active' : ''}" title="小 (45%)" data-size="size-small">小</button>
              <button class="size-btn ${currentSize === 'size-medium' ? 'active' : ''}" title="中 (72%)" data-size="size-medium">中</button>
              <button class="size-btn ${currentSize === 'size-large' ? 'active' : ''}" title="大 (100%)" data-size="size-large">大</button>
              <button class="align-btn ${alignClass === 'align-left' ? 'active' : ''}" title="左寄せ" data-align="align-left"><i class="fa-solid fa-align-left"></i></button>
              <button class="align-btn ${alignClass === 'align-center' ? 'active' : ''}" title="中央" data-align="align-center"><i class="fa-solid fa-align-center"></i></button>
              <button class="align-btn ${alignClass === 'align-right' ? 'active' : ''}" title="右寄せ" data-align="align-right"><i class="fa-solid fa-align-right"></i></button>
              <button class="btn-subtle btn-del-block" title="削除"><i class="fa-solid fa-trash" style="color:#ef4444;"></i></button>
            `;
          }

          // Size Preset Button Listeners
          actionsEl.querySelectorAll('.size-btn').forEach((btn) => {
            const handleSize = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const sz = btn.dataset.size;
              this.resizeImageBlock(pageIndex, i, sz);
            };
            btn.addEventListener('click', handleSize);
            btn.addEventListener('touchstart', handleSize, { passive: false });
          });

          // Alignment Button Listeners
          actionsEl.querySelectorAll('.align-btn').forEach((btn) => {
            const handleAlign = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const algn = btn.dataset.align;
              this.setBlockAlignment(pageIndex, i, algn);
            };
            btn.addEventListener('click', handleAlign);
            btn.addEventListener('touchstart', handleAlign, { passive: false });
          });

          // Move Up / Down Listeners
          const btnUp = actionsEl.querySelector('.btn-up');
          const btnDown = actionsEl.querySelector('.btn-down');
          if (btnUp) {
            const handleUp = (e) => { e.preventDefault(); e.stopPropagation(); this.moveBlock(pageIndex, i, -1); };
            btnUp.addEventListener('click', handleUp);
            btnUp.addEventListener('touchstart', handleUp, { passive: false });
          }
          if (btnDown) {
            const handleDown = (e) => { e.preventDefault(); e.stopPropagation(); this.moveBlock(pageIndex, i, 1); };
            btnDown.addEventListener('click', handleDown);
            btnDown.addEventListener('touchstart', handleDown, { passive: false });
          }

          // Delete Listener with Touch & Mouse Event Guards
          const delBtn = actionsEl.querySelector('.btn-del-block');
          if (delBtn) {
            const handleDelete = (e) => {
              e.preventDefault();
              e.stopPropagation();
              this.deleteBlock(pageIndex, i);
            };
            delBtn.addEventListener('click', handleDelete);
            delBtn.addEventListener('touchstart', handleDelete, { passive: false });
          }

          blockEl.addEventListener('click', (e) => {
            if (e.target.closest('.block-actions')) return;
            document.querySelectorAll('.page-block').forEach((el) => el.classList.remove('active-block'));
            blockEl.classList.add('active-block');
          });

          blockEl.appendChild(actionsEl);
        }

        if (block.type === 'image') {
          const sizeClass = block.sizeClass || 'size-large';
          const imgWrapper = document.createElement('div');
          imgWrapper.className = `block-img-wrapper ${sizeClass}`;
          if (block.customWidth) imgWrapper.style.width = block.customWidth;

          let src = block.imageId ? await storageEngine.getImageUrl(block.imageId) : block.src;
          imgWrapper.innerHTML = `<img src="${src || ''}" alt="画像">`;

          if (!isLocked) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle-se';
            resizeHandle.title = 'ドラッグして自由拡大・縮小';
            this.setupFreeformResizer(resizeHandle, imgWrapper, pageEl, pageIndex, i);
            imgWrapper.appendChild(resizeHandle);
          }

          blockEl.appendChild(imgWrapper);
        } else if (block.type === 'drawing') {
          const sizeClass = block.sizeClass || 'size-large';
          const drawWrapper = document.createElement('div');
          drawWrapper.className = `drawing-img-wrapper ${sizeClass}`;
          if (block.customWidth) drawWrapper.style.width = block.customWidth;

          let src = block.imageId ? await storageEngine.getImageUrl(block.imageId) : block.src;
          drawWrapper.innerHTML = `<img src="${src || ''}" alt="手書きメモ">`;

          if (!isLocked) {
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle-se';
            resizeHandle.title = 'ドラッグして自由拡大・縮小';
            this.setupFreeformResizer(resizeHandle, drawWrapper, pageEl, pageIndex, i);
            drawWrapper.appendChild(resizeHandle);
          }

          blockEl.appendChild(drawWrapper);
        } else if (block.type === 'note') {
          const sizeClass = block.sizeClass || 'size-large';
          const noteEl = document.createElement('div');
          noteEl.className = `note-overlay ${sizeClass}`;
          if (block.customWidth) noteEl.style.width = block.customWidth;

          noteEl.contentEditable = !isLocked ? 'true' : 'false';

          // Ensure all newlines (\n) are converted to <br> so multiline text displays with clean line breaks
          let formattedText = block.text || '';
          if (formattedText.includes('\n') && !formattedText.includes('<br')) {
            formattedText = formattedText.replace(/\r?\n/g, '<br>');
          }
          noteEl.innerHTML = formattedText;

          if (!isLocked) {
            noteEl.addEventListener('paste', (e) => {
              e.preventDefault();
              const rawText = (e.clipboardData || window.clipboardData).getData('text/plain');
              if (!rawText) return;

              // Convert all line breaks (\n) to <br> tags
              const htmlWithBr = this.escapeHtml(rawText).replace(/\r?\n/g, '<br>');

              if (document.queryCommandSupported && document.queryCommandSupported('insertHTML')) {
                document.execCommand('insertHTML', false, htmlWithBr);
              } else {
                const selection = window.getSelection();
                if (!selection.rangeCount) return;
                selection.deleteFromDocument();
                const range = selection.getRangeAt(0);
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = htmlWithBr;
                const frag = document.createDocumentFragment();
                let node, lastNode;
                while ((node = tempDiv.firstChild)) {
                  lastNode = frag.appendChild(node);
                }
                range.insertNode(frag);
                if (lastNode) {
                  range.setStartAfter(lastNode);
                  range.collapse(true);
                  selection.removeAllRanges();
                  selection.addRange(range);
                }
              }
              block.text = noteEl.innerHTML;
              storageEngine.savePages(this.pages).catch(err => console.warn(err));
            });

            noteEl.addEventListener('input', () => {
              block.text = noteEl.innerHTML;
              storageEngine.savePages(this.pages).catch(err => console.warn(err));
            });

            noteEl.addEventListener('blur', () => {
              block.text = noteEl.innerHTML;
              storageEngine.savePages(this.pages).catch(err => console.warn(err));
              this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
            });
          }
          blockEl.appendChild(noteEl);
        } else if (block.type === 'link') {
          const sizeClass = block.sizeClass || 'size-large';
          const linkEl = document.createElement('a');
          linkEl.className = `link-overlay ${sizeClass}`;
          if (block.customWidth) linkEl.style.width = block.customWidth;
          linkEl.href = block.url;
          linkEl.target = '_blank';
          linkEl.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i> <span>${this.escapeHtml(block.title || block.url)}</span>`;
          blockEl.appendChild(linkEl);
        } else if (block.type === 'tag') {
          const sizeClass = block.sizeClass || 'size-large';
          const tagEl = document.createElement('div');
          tagEl.className = `tag-overlay tag-${block.tagType || 'boss'} ${sizeClass}`;
          if (block.customWidth) tagEl.style.width = block.customWidth;
          tagEl.innerHTML = `<i class="fa-solid fa-tags"></i> <span>${this.escapeHtml(block.text)}</span>`;
          blockEl.appendChild(tagEl);
        }

        contentScrollEl.appendChild(blockEl);
      }

      // Bottom-most Insert Divider Bar
      if (!isLocked) {
        const bottomDividerEl = document.createElement('div');
        bottomDividerEl.className = 'block-insert-divider';
        bottomDividerEl.title = 'ここに新しい要素を挿入';
        bottomDividerEl.innerHTML = `<button class="btn-insert-here"><i class="fa-solid fa-plus"></i> 末尾に挿入</button>`;
        bottomDividerEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.promptInsertBlockAtIndex(pageIndex, pageData.blocks.length);
        });
        contentScrollEl.appendChild(bottomDividerEl);
      }
    }

    pageEl.appendChild(contentScrollEl);

    // Footer Bar with Single Clean FontAwesome Lock Icon
    const footerBarEl = document.createElement('div');
    footerBarEl.className = 'page-footer-bar';

    const lockBtn = document.createElement('button');
    lockBtn.className = `btn-page-lock-toggle ${isLocked ? 'is-locked' : ''}`;
    lockBtn.innerHTML = isLocked ? `<i class="fa-solid fa-lock"></i> ロック中` : `<i class="fa-solid fa-lock-open"></i> 編集可能`;
    lockBtn.title = `P.${pageIndex + 1} の編集ロック状態を切り替え`;
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePageLock(pageIndex);
    });
    footerBarEl.appendChild(lockBtn);

    const rightSlot = document.createElement('div');
    rightSlot.className = 'page-footer-right-slot';
    rightSlot.innerHTML = `<span>P.${pageIndex + 1}</span>`;
    footerBarEl.appendChild(rightSlot);

    pageEl.appendChild(footerBarEl);

    return pageEl;
  }

  // Move Block Up or Down
  async moveBlock(pageIndex, blockIndex, direction) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked || !page.blocks) return;

    const newIndex = blockIndex + direction;
    if (newIndex < 0 || newIndex >= page.blocks.length) return;

    const temp = page.blocks[blockIndex];
    page.blocks[blockIndex] = page.blocks[newIndex];
    page.blocks[newIndex] = temp;

    await this.renderNotebookView();
    this.showToast('⇅ 順序を入れ替えました！');

    storageEngine.savePages(this.pages).catch(err => console.warn(err));
    this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
  }

  // Set Block Alignment (Left, Center, Right, Float-Left)
  async setBlockAlignment(pageIndex, blockIndex, alignClass) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked || !page.blocks || !page.blocks[blockIndex]) return;

    // 1. Update data model
    page.blocks[blockIndex].alignClass = alignClass;

    // 2. Direct DOM manipulation for INSTANT alignment update
    const pageEls = document.querySelectorAll('.notebook-page');
    pageEls.forEach((pageEl) => {
      if (parseInt(pageEl.dataset.index) === pageIndex) {
        const blockEls = pageEl.querySelectorAll('.page-block');
        if (blockEls[blockIndex]) {
          const blockEl = blockEls[blockIndex];
          blockEl.classList.remove('align-left', 'align-center', 'align-right', 'align-float');
          blockEl.classList.add(alignClass);

          const alignBtns = blockEl.querySelectorAll('.align-btn');
          alignBtns.forEach((btn) => {
            if (btn.dataset.align === alignClass) {
              btn.classList.add('active');
            } else {
              btn.classList.remove('active');
            }
          });
        }
      }
    });

    this.showToast(`レイアウト変更: ${alignClass === 'align-float' ? '文字回り込み' : alignClass.replace('align-', '')}`);

    storageEngine.savePages(this.pages).catch(err => console.warn(err));
    this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
  }

  // In-Between Block Insertion
  async promptInsertBlockAtIndex(pageIndex, insertIndex) {
    const targetPage = this.pages[pageIndex];
    if (!targetPage || targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (!targetPage.blocks) targetPage.blocks = [];

    // Directly insert note block at specified position without prompt alert popups
    targetPage.blocks.splice(insertIndex, 0, {
      type: 'note',
      text: 'メモを入力...',
      alignClass: 'align-center',
      sizeClass: 'size-large'
    });

    await storageEngine.savePages(this.pages);
    await this.renderNotebookView();
    this.showToast(`✨ P.${pageIndex + 1} の指定位置にメモを差し込みました！`);
    this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
  }

  // Freeform Interactive Image Resizer Engine (Touch & Mouse Support)
  setupFreeformResizer(handleEl, targetWrapperEl, pageEl, pageIndex, blockIndex) {
    let startX = 0;
    let startWidth = 0;

    const startDrag = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      startX = clientX;
      startWidth = targetWrapperEl.getBoundingClientRect().width;
      const pageWidth = pageEl.getBoundingClientRect().width - 36;

      const moveDrag = (moveEvt) => {
        const currentX = moveEvt.touches ? moveEvt.touches[0].clientX : moveEvt.clientX;
        const deltaX = currentX - startX;
        let newWidthPx = startWidth + deltaX;
        let pct = Math.min(100, Math.max(20, Math.round((newWidthPx / pageWidth) * 100)));
        targetWrapperEl.style.width = `${pct}%`;
      };

      const stopDrag = () => {
        window.removeEventListener('mousemove', moveDrag);
        window.removeEventListener('mouseup', stopDrag);
        window.removeEventListener('touchmove', moveDrag);
        window.removeEventListener('touchend', stopDrag);

        const pctWidth = targetWrapperEl.style.width;
        if (pctWidth && this.pages[pageIndex] && this.pages[pageIndex].blocks[blockIndex]) {
          this.performLocalWrite(async () => {
            this.pages[pageIndex].blocks[blockIndex].customWidth = pctWidth;
            await storageEngine.savePages(this.pages);
            this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
            this.showToast(`📐 画像サイズを変更しました (${pctWidth})`);
          });
        }
      };

      window.addEventListener('mousemove', moveDrag);
      window.addEventListener('mouseup', stopDrag);
      window.addEventListener('touchmove', moveDrag, { passive: false });
      window.addEventListener('touchend', stopDrag);
    };

    handleEl.addEventListener('mousedown', startDrag);
    handleEl.addEventListener('touchstart', startDrag, { passive: false });
  }

  // Resize Image Block Presets (Small, Medium, Large)
  async resizeImageBlock(pageIndex, blockIndex, sizeClass) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked || !page.blocks || !page.blocks[blockIndex]) return;

    await this.performLocalWrite(async () => {
      // 1. Update data model
      page.blocks[blockIndex].sizeClass = sizeClass;
      delete page.blocks[blockIndex].customWidth;

      // 2. Direct DOM manipulation for INSTANT visual size update without full page re-render
      const pageEls = document.querySelectorAll('.notebook-page');
      pageEls.forEach((pageEl) => {
        if (parseInt(pageEl.dataset.index) === pageIndex) {
          const blockEls = pageEl.querySelectorAll('.page-block');
          if (blockEls[blockIndex]) {
            const targetChild = blockEls[blockIndex].querySelector('.note-overlay, .block-img-wrapper, .drawing-img-wrapper, .link-overlay, .tag-overlay');
            if (targetChild) {
              targetChild.style.width = ''; // Clear inline custom width override
              targetChild.classList.remove('size-small', 'size-medium', 'size-large');
              targetChild.classList.add(sizeClass);
            }

            const sizeBtns = blockEls[blockIndex].querySelectorAll('.size-btn');
            sizeBtns.forEach((btn) => {
              if (btn.dataset.size === sizeClass) {
                btn.classList.add('active');
              } else {
                btn.classList.remove('active');
              }
            });
          }
        }
      });

      const lblName = sizeClass === 'size-small' ? '小 (45%)' : sizeClass === 'size-medium' ? '中 (72%)' : '大 (100%)';
      this.showToast(`📐 サイズ変更: ${lblName}`);

      await storageEngine.savePages(this.pages);
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  nextPage() {
    if (this.isFlipping) return;
    const step = this.viewMode === 'double' ? 2 : 1;

    if (this.currentPageIndex + step < this.pages.length) {
      this.playPageFlipSound();

      if (this.speedMode === '3d') {
        this.animate3DFlip('next', () => {
          this.currentPageIndex += step;
          this.activeTargetPageIndex = this.currentPageIndex;
          this.renderNotebookView();
        });
      } else {
        this.currentPageIndex += step;
        this.activeTargetPageIndex = this.currentPageIndex;
        this.renderNotebookView();
      }
    } else {
      this.showToast('最後のページです');
    }
  }

  prevPage() {
    if (this.isFlipping) return;
    const step = this.viewMode === 'double' ? 2 : 1;

    if (this.currentPageIndex - step >= 0) {
      this.playPageFlipSound();

      if (this.speedMode === '3d') {
        this.animate3DFlip('prev', () => {
          this.currentPageIndex -= step;
          this.activeTargetPageIndex = this.currentPageIndex;
          this.renderNotebookView();
        });
      } else {
        this.currentPageIndex -= step;
        this.activeTargetPageIndex = this.currentPageIndex;
        this.renderNotebookView();
      }
    } else if (this.currentPageIndex > 0) {
      this.playPageFlipSound();
      this.currentPageIndex = 0;
      this.activeTargetPageIndex = 0;
      this.renderNotebookView();
    } else {
      this.showToast('最初のページです');
    }
  }

  // Mobile Horizontal Touch Swipe Gesture Engine (Finger Swipe Left = Next, Right = Prev)
  setupMobileTouchSwipe() {
    const viewport = document.getElementById('notebookViewport');
    if (!viewport) return;

    let touchStartX = 0;
    let touchStartY = 0;

    viewport.addEventListener('touchstart', (e) => {
      if (e.target.closest('button, input, textarea, a, .draw-canvas-wrapper, .note-overlay, .stamp-controls, .block-actions')) {
        return;
      }
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    viewport.addEventListener('touchend', (e) => {
      if (!touchStartX || !touchStartY) return;
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;

      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Detect prominent horizontal swipe (> 35px) vs vertical scroll
      if (Math.abs(deltaX) > 35 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
        if (deltaX < 0) {
          // Swiped finger to the left -> Next Page
          this.nextPage();
        } else {
          // Swiped finger to the right -> Prev Page
          this.prevPage();
        }
      }

      touchStartX = 0;
      touchStartY = 0;
    }, { passive: true });
  }

  animate3DFlip(direction, callback) {
    const bookContainer = document.getElementById('bookContainer');
    if (!bookContainer) {
      callback();
      return;
    }

    this.isFlipping = true;

    const sheet = document.createElement('div');
    sheet.className = `flipping-sheet flip-${direction}`;
    bookContainer.appendChild(sheet);

    setTimeout(() => {
      sheet.remove();
      this.isFlipping = false;
      callback();
    }, 450);
  }

  jumpToPage(index) {
    if (index >= 0 && index < this.pages.length) {
      this.currentPageIndex = index;
      this.activeTargetPageIndex = index;
      this.renderNotebookView();
    }
  }

  // Capacity Limit Checks for Add New Page at End
  async addNewPage() {
    if (this.userPlan === 'free') {
      const totalPgs = await this.calculateTotalPagesAllNotebooks();
      if (totalPgs >= 30) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計30P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大30ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

    await this.performLocalWrite(async () => {
      const newPageIdx = this.pages.length;
      const newPage = {
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        notebookId: this.currentNotebookId,
        pageIndex: newPageIdx,
        bookmarkLabel: '',
        isLocked: false,
        blocks: []
      };
      this.pages.push(newPage);

      // 1. Instant local IndexedDB write (0ms)
      await storageEngine.savePages([newPage]);

      // 2. Instant 0ms UI Re-render & Page Alignment
      const isMobile = this.isMobileDevice();
      if (this.viewMode === 'double' && !isMobile) {
        this.currentPageIndex = Math.floor(newPageIdx / 2) * 2;
      } else {
        this.currentPageIndex = newPageIdx;
      }
      this.activeTargetPageIndex = newPageIdx;

      await this.renderNotebookView();
      await this.updatePlanUI();
      this.showToast(`✨ 末尾に P.${newPageIdx + 1} を作成しました！`);

      // 3. Non-blocking background cloud sync
      this.syncPagesToCloud([newPage]).catch(err => console.warn(err));
    });
  }

  // Insert New Blank Page Right After Active Target Page
  async insertPageAfterActive() {
    if (this.userPlan === 'free') {
      const totalPgs = await this.calculateTotalPagesAllNotebooks();
      if (totalPgs >= 30) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計30P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大30ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

    await this.performLocalWrite(async () => {
      const insertIdx = this.activeTargetPageIndex + 1;
      const newPage = {
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        notebookId: this.currentNotebookId,
        pageIndex: insertIdx,
        bookmarkLabel: '',
        isLocked: false,
        blocks: []
      };

      this.pages.splice(insertIdx, 0, newPage);
      this.pages.forEach((p, idx) => (p.pageIndex = idx));

      // 1. Instant local IndexedDB write (0ms)
      await storageEngine.savePages(this.pages);

      // 2. Instant 0ms UI Re-render & Page Alignment
      const isMobile = this.isMobileDevice();
      if (this.viewMode === 'double' && !isMobile) {
        this.currentPageIndex = Math.floor(insertIdx / 2) * 2;
      } else {
        this.currentPageIndex = insertIdx;
      }
      this.activeTargetPageIndex = insertIdx;

      await this.renderNotebookView();
      await this.updatePlanUI();
      this.showToast(`📥 P.${insertIdx + 1} に新規ページを挿入しました！`);

      // 3. Non-blocking background cloud sync
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  // Deep Clone / Duplicate Active Target Page
  async duplicateActivePage() {
    if (this.userPlan === 'free') {
      const totalPgs = await this.calculateTotalPagesAllNotebooks();
      if (totalPgs >= 30) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計30P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大30ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

    const sourcePage = this.pages[this.activeTargetPageIndex];
    if (!sourcePage) return;

    await this.performLocalWrite(async () => {
      const clonedBlocks = JSON.parse(JSON.stringify(sourcePage.blocks || []));
      const insertIdx = this.activeTargetPageIndex + 1;

      const dupPage = {
        id: 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        notebookId: this.currentNotebookId,
        pageIndex: insertIdx,
        bookmarkLabel: sourcePage.bookmarkLabel ? `${sourcePage.bookmarkLabel}(コピー)` : '',
        isLocked: false,
        blocks: clonedBlocks
      };

      this.pages.splice(insertIdx, 0, dupPage);
      this.pages.forEach((p, idx) => (p.pageIndex = idx));

      // 1. Instant local IndexedDB write (0ms)
      await storageEngine.savePages(this.pages);

      // 2. Instant 0ms UI Re-render & Page Alignment
      const isMobile = this.isMobileDevice();
      if (this.viewMode === 'double' && !isMobile) {
        this.currentPageIndex = Math.floor(insertIdx / 2) * 2;
      } else {
        this.currentPageIndex = insertIdx;
      }
      this.activeTargetPageIndex = insertIdx;

      await this.renderNotebookView();
      await this.updatePlanUI();
      this.showToast(`📋 P.${insertIdx + 1} に複製ページを挿入しました！`);

      // 3. Non-blocking background cloud sync
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  async deleteCurrentPage() {
    const pageToDelete = this.pages[this.activeTargetPageIndex];
    if (!pageToDelete) return;

    if (pageToDelete.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (this.pages.length <= 1) {
      this.showToast('最後の1ページは削除できません');
      return;
    }

    const delNum = this.activeTargetPageIndex + 1;
    if (!confirm(`P.${delNum} （${pageToDelete.bookmarkLabel || '無題ページ'}） を削除しますか？`)) return;

    await this.performLocalWrite(async () => {
      const deleteId = pageToDelete.id;
      const targetIdx = this.activeTargetPageIndex;
      this.recordDeletedPageId(deleteId);

      // 1. Remove from local array memory & IndexedDB first (0ms)
      this.pages.splice(targetIdx, 1);
      this.pages.forEach((p, idx) => (p.pageIndex = idx));

      await storageEngine.deletePage(deleteId);
      await storageEngine.savePages(this.pages);

      // 2. Instant 0ms UI Re-render & Page Alignment
      const isMobile = this.isMobileDevice();
      let nextIndex = Math.min(targetIdx, this.pages.length - 1);
      nextIndex = Math.max(0, nextIndex);

      if (this.viewMode === 'double' && !isMobile) {
        this.currentPageIndex = Math.floor(nextIndex / 2) * 2;
      } else {
        this.currentPageIndex = nextIndex;
      }
      this.activeTargetPageIndex = Math.min(targetIdx, this.pages.length - 1);

      await this.renderNotebookView();
      await this.updatePlanUI();
      this.showToast(`🗑️ P.${delNum} を削除しました！`);

      // 3. Non-blocking background cloud sync
      this.deletePageFromCloud(deleteId).catch(err => console.warn(err));
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  async addTextBlock() {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (!targetPage.blocks) targetPage.blocks = [];
    targetPage.blocks.push({
      type: 'note',
      text: 'メモを入力...',
      alignClass: 'align-center',
      sizeClass: 'size-large'
    });

    await storageEngine.savePages(this.pages);
    await this.renderNotebookView();
    this.showToast(`✨ P.${this.activeTargetPageIndex + 1} にメモを追加しました！`);
    this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
  }

  async addLinkBlock() {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const url = prompt(`P.${this.activeTargetPageIndex + 1} に追加するWebサイトURL:`, 'https://');
    if (!url || !url.trim()) return;
    const title = prompt('表示タイトル:', '関連リンク');

    await this.performLocalWrite(async () => {
      if (!targetPage.blocks) targetPage.blocks = [];
      targetPage.blocks.push({ type: 'link', url: url.trim(), title: (title && title.trim()) || url.trim(), alignClass: 'align-center' });
      await storageEngine.savePages(this.pages);
      await this.renderNotebookView();
      this.showToast(`✨ P.${this.activeTargetPageIndex + 1} にWebリンクを追加しました！`);
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  async addTagBlock(tagType = 'boss') {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const text = prompt(`P.${this.activeTargetPageIndex + 1} のタグ名を入力してください:`, '重要メモ');
    if (!text || !text.trim()) return;

    await this.performLocalWrite(async () => {
      if (!targetPage.blocks) targetPage.blocks = [];
      targetPage.blocks.push({ type: 'tag', tagType, text: text.trim(), alignClass: 'align-center' });
      await storageEngine.savePages(this.pages);
      await this.renderNotebookView();
      this.showToast(`✨ P.${this.activeTargetPageIndex + 1} にタグを追加しました！`);
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  async deleteBlock(pageIndex, blockIndex) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked || !page.blocks || !page.blocks[blockIndex]) return;

    if (!confirm('このメモ（要素）を削除しますか？')) return;

    await this.performLocalWrite(async () => {
      page.blocks.splice(blockIndex, 1);
      await storageEngine.savePages(this.pages);
      await this.renderNotebookView();
      this.showToast('🗑️ 要素を削除しました');
      this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
    });
  }

  async saveCurrentPagesState() {
    await storageEngine.savePages(this.pages);
    this.updatePlanUI().catch(err => console.warn(err));
    this.syncPagesToCloud(this.pages).catch(err => console.warn(err));
  }

  setupDrawingCanvas() {
    this.drawCanvas = document.getElementById('drawCanvas');
    if (!this.drawCanvas) return;
    this.drawCtx = this.drawCanvas.getContext('2d');

    const getPos = (e) => {
      const rect = this.drawCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (this.drawCanvas.width / rect.width),
        y: (clientY - rect.top) * (this.drawCanvas.height / rect.height)
      };
    };

    const startDraw = (e) => {
      this.isDrawing = true;
      const pos = getPos(e);
      this.drawCtx.beginPath();
      this.drawCtx.moveTo(pos.x, pos.y);
      this.drawCtx.strokeStyle = document.getElementById('drawColor').value;
      this.drawCtx.lineWidth = document.getElementById('drawSize').value;
      this.drawCtx.lineCap = 'round';
      this.drawCtx.lineJoin = 'round';
    };

    const drawMove = (e) => {
      if (!this.isDrawing) return;
      const pos = getPos(e);
      this.drawCtx.lineTo(pos.x, pos.y);
      this.drawCtx.stroke();
    };

    const stopDraw = () => {
      this.isDrawing = false;
    };

    this.drawCanvas.addEventListener('mousedown', startDraw);
    this.drawCanvas.addEventListener('mousemove', drawMove);
    this.drawCanvas.addEventListener('mouseup', stopDraw);
    this.drawCanvas.addEventListener('mouseleave', stopDraw);

    this.drawCanvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); });
    this.drawCanvas.addEventListener('touchmove', (e) => { e.preventDefault(); drawMove(e); });
    this.drawCanvas.addEventListener('touchend', stopDraw);

    const btnClear = document.getElementById('btnDrawClear');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
        const container = document.getElementById('stampOverlayContainer');
        if (container) container.innerHTML = '';
        this.showToast('キャンバスとスタンプをリセットしました');
      });
    }

    const btnSaveDraw = document.getElementById('btnSaveDraw');
    if (btnSaveDraw) {
      btnSaveDraw.addEventListener('click', async () => {
        const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
        if (targetPage && targetPage.isLocked) {
          this.showToast('⚠️ このページは編集ロックされています');
          return;
        }

        await this.performLocalWrite(async () => {
          // Composite interactive stamps onto canvas context before saving image
          this.renderStampsToCanvasContext();

          this.drawCanvas.toBlob(async (blob) => {
            if (!blob) return;
            const compressedBlob = await storageEngine.compressImage(blob);
            const imageId = 'img_draw_' + Date.now();
            await storageEngine.saveImage(imageId, compressedBlob);
            await this.syncImageToCloud(imageId, compressedBlob);

            if (!targetPage.blocks) targetPage.blocks = [];
            targetPage.blocks.push({ type: 'drawing', imageId, sizeClass: 'size-large', alignClass: 'align-center' });
            await this.saveCurrentPagesState();
            await this.renderNotebookView();

            this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
            this.closeModal('modalDraw');
            this.showToast(`P.${this.activeTargetPageIndex + 1} に手書きメモを追加しました！`);
          }, 'image/png');
        });
      });
    }

    const btnDrawAddImage = document.getElementById('btnDrawAddImage');
    if (btnDrawAddImage) {
      btnDrawAddImage.addEventListener('click', () => {
        const drawFileInput = document.getElementById('drawFileInput');
        if (drawFileInput) drawFileInput.click();
      });
    }

    const drawFileInput = document.getElementById('drawFileInput');
    if (drawFileInput) {
      drawFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.drawCroppedImageToCanvas(e.target.files[0]);
        }
      });
    }

    document.querySelectorAll('.stamp-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.dataset.emoji;
        if (!emoji) return;
        this.stampEmojiToCanvas(emoji);
      });
    });
  }

  // Interactive Draggable & Resizable Emoji Stamps Engine
  stampEmojiToCanvas(emoji) {
    const container = document.getElementById('stampOverlayContainer');
    if (!container) return;

    const stampEl = document.createElement('div');
    stampEl.className = 'canvas-stamp-item active';

    // Initial positioning around canvas center
    const initX = Math.max(10, Math.round(container.clientWidth / 2 - 24 + (Math.random() * 40 - 20)));
    const initY = Math.max(10, Math.round(container.clientHeight / 2 - 24 + (Math.random() * 40 - 20)));
    let fontSize = 42;

    stampEl.style.left = `${initX}px`;
    stampEl.style.top = `${initY}px`;

    const textSpan = document.createElement('span');
    textSpan.className = 'stamp-emoji-text';
    textSpan.style.fontSize = `${fontSize}px`;
    textSpan.innerText = emoji;
    stampEl.appendChild(textSpan);

    const ctrlBox = document.createElement('div');
    ctrlBox.className = 'stamp-controls';
    ctrlBox.innerHTML = `
      <button class="stamp-ctrl-btn btn-plus" title="拡大">+</button>
      <button class="stamp-ctrl-btn btn-minus" title="縮小">-</button>
      <button class="stamp-ctrl-btn btn-del" title="削除">&times;</button>
    `;

    // Size + button listener
    ctrlBox.querySelector('.btn-plus').addEventListener('click', (e) => {
      e.stopPropagation();
      fontSize = Math.min(120, fontSize + 6);
      textSpan.style.fontSize = `${fontSize}px`;
    });

    // Size - button listener
    ctrlBox.querySelector('.btn-minus').addEventListener('click', (e) => {
      e.stopPropagation();
      fontSize = Math.max(16, fontSize - 6);
      textSpan.style.fontSize = `${fontSize}px`;
    });

    // Delete button listener
    ctrlBox.querySelector('.btn-del').addEventListener('click', (e) => {
      e.stopPropagation();
      stampEl.remove();
      this.showToast('スタンプを削除しました');
    });

    stampEl.appendChild(ctrlBox);

    // Attach Draggable Engine for Desktop & Mobile
    this.makeStampElementDraggable(stampEl, container);

    container.appendChild(stampEl);
    this.showToast(`スタンプ 【${emoji}】 を追加しました（ドラッグ移動・拡大縮小可能）`);
  }

  makeStampElementDraggable(stampEl, containerEl) {
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;
    let isDragging = false;

    const onPointerDown = (e) => {
      e.stopPropagation();
      isDragging = true;

      containerEl.querySelectorAll('.canvas-stamp-item').forEach((el) => el.classList.remove('active'));
      stampEl.classList.add('active');

      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      startX = clientX;
      startY = clientY;

      initialLeft = stampEl.offsetLeft;
      initialTop = stampEl.offsetTop;

      const onPointerMove = (moveEvt) => {
        if (!isDragging) return;
        moveEvt.preventDefault();

        const moveX = moveEvt.touches ? moveEvt.touches[0].clientX : moveEvt.clientX;
        const moveY = moveEvt.touches ? moveEvt.touches[0].clientY : moveEvt.clientY;

        const deltaX = moveX - startX;
        const deltaY = moveY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        const maxLeft = containerEl.clientWidth - stampEl.clientWidth;
        const maxTop = containerEl.clientHeight - stampEl.clientHeight;

        newLeft = Math.max(0, Math.min(maxLeft, newLeft));
        newTop = Math.max(0, Math.min(maxTop, newTop));

        stampEl.style.left = `${newLeft}px`;
        stampEl.style.top = `${newTop}px`;
      };

      const onPointerUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onPointerMove);
        window.removeEventListener('mouseup', onPointerUp);
        window.removeEventListener('touchmove', onPointerMove);
        window.removeEventListener('touchend', onPointerUp);
      };

      window.addEventListener('mousemove', onPointerMove);
      window.addEventListener('mouseup', onPointerUp);
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp);
    };

    stampEl.addEventListener('mousedown', onPointerDown);
    stampEl.addEventListener('touchstart', onPointerDown, { passive: false });
  }

  // Composite Overlay Stamps onto Canvas Context Before Saving Image
  renderStampsToCanvasContext() {
    const container = document.getElementById('stampOverlayContainer');
    if (!container || !this.drawCtx) return;

    const stampItems = container.querySelectorAll('.canvas-stamp-item');
    if (stampItems.length === 0) return;

    const containerRect = container.getBoundingClientRect();
    const scaleX = this.drawCanvas.width / containerRect.width;
    const scaleY = this.drawCanvas.height / containerRect.height;

    stampItems.forEach((item) => {
      const textSpan = item.querySelector('.stamp-emoji-text');
      if (!textSpan) return;

      const emojiText = textSpan.innerText;
      const fontSizePx = parseFloat(window.getComputedStyle(textSpan).fontSize) || 42;

      const itemRect = item.getBoundingClientRect();
      const relativeLeft = itemRect.left - containerRect.left;
      const relativeTop = itemRect.top - containerRect.top;

      const canvasX = (relativeLeft + itemRect.width / 2) * scaleX;
      const canvasY = (relativeTop + itemRect.height / 2) * scaleY;
      const scaledFontSize = fontSizePx * scaleX;

      this.drawCtx.font = `${scaledFontSize}px sans-serif`;
      this.drawCtx.textAlign = 'center';
      this.drawCtx.textBaseline = 'middle';
      this.drawCtx.fillText(emojiText, canvasX, canvasY);
    });

    container.innerHTML = '';
  }

  drawCroppedImageToCanvas(fileOrBlob) {
    const img = new Image();
    const url = URL.createObjectURL(fileOrBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxW = 300;
      const maxH = 220;
      let w = img.width;
      let h = img.height;

      if (w > maxW || h > maxH) {
        if (w > h) {
          h = Math.round((h * maxW) / w);
          w = maxW;
        } else {
          w = Math.round((w * maxH) / h);
          h = maxH;
        }
      }

      const x = (this.drawCanvas.width - w) / 2;
      const y = (this.drawCanvas.height - h) / 2;

      this.drawCtx.drawImage(img, x, y, w, h);
      this.showToast('🖼️ 切り抜き画像/アイコンをキャンバスに貼り付けました！');
    };

    img.src = url;
  }

  setupClipboardAndDrop() {
    window.addEventListener('paste', async (e) => {
      const items = e.clipboardData.items;
      let handled = false;

      const drawModal = document.getElementById('modalDraw');
      const isDrawModalActive = drawModal && drawModal.classList.contains('active');

      const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
      if (targetPage && targetPage.isLocked) {
        this.showToast('⚠️ このページは編集ロックされています');
        return;
      }

      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          e.preventDefault();
          const file = item.getAsFile();

          if (isDrawModalActive) {
            this.drawCroppedImageToCanvas(file);
          } else {
            await this.processAndInsertImageToTargetPage(file, this.activeTargetPageIndex);
          }
          handled = true;
          break;
        }
      }

      if (!handled && !isDrawModalActive) {
        const pastedText = e.clipboardData.getData('text');
        if (pastedText && pastedText.startsWith('http')) {
          if (confirm(`P.${this.activeTargetPageIndex + 1} にクリップボードのURL 「${pastedText}」 をハイパーリンクとして追加しますか？`)) {
            await this.performLocalWrite(async () => {
              if (!targetPage.blocks) targetPage.blocks = [];
              targetPage.blocks.push({ type: 'link', url: pastedText, title: pastedText, alignClass: 'align-center' });
              await this.saveCurrentPagesState();
              await this.renderNotebookView();
            });
          }
        }
      }
    });

    const dropZone = document.getElementById('dropZone');
    if (dropZone) {
      window.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });

      window.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

      window.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
        if (targetPage && targetPage.isLocked) {
          this.showToast('⚠️ このページは編集ロックされています');
          return;
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          for (const file of e.dataTransfer.files) {
            if (file.type.startsWith('image/')) {
              await this.processAndInsertImageToTargetPage(file, this.activeTargetPageIndex);
            }
          }
        }
      });
    }

    const btnSelFile = document.getElementById('btnSelectFileForActivePage');
    if (btnSelFile) {
      btnSelFile.addEventListener('click', () => {
        const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
        if (targetPage && targetPage.isLocked) {
          this.showToast('⚠️ このページは編集ロックされています');
          return;
        }
        const fileInput = document.getElementById('fileInput');
        if (fileInput) fileInput.click();
      });
    }

    const fileInput = document.getElementById('fileInput');
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
        if (targetPage && targetPage.isLocked) {
          this.showToast('⚠️ このページは編集ロックされています');
          return;
        }

        if (e.target.files && e.target.files.length > 0) {
          for (const file of e.target.files) {
            await this.processAndInsertImageToTargetPage(file, this.activeTargetPageIndex);
          }
        }
      });
    }
  }

  // ✂️ In-App Screen Snipping Tool Engine (Select Window/Monitor, Drag Crop Box, Insert)
  async startScreenSnipping() {
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert('お使いのブラウザは画面キャプチャAPIに対応していません。\nGoogle Chrome または Microsoft Edge をご利用ください。');
      return;
    }

    try {
      this.showToast('🖥️ キャプチャする画面またはウィンドウを選択してください...');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' },
        audio: false
      });

      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;

      video.onloadedmetadata = () => {
        video.play();
        setTimeout(() => {
          const canvas = document.getElementById('snippingSourceCanvas');
          if (!canvas) {
            track.stop();
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

          // Stop capture stream immediately so no screen sharing remains active
          track.stop();
          stream.getTracks().forEach(t => t.stop());

          // Initialize cropping overlay and open modal
          this.initSnippingSelector(canvas);
          this.openModal('modalSnipping');
        }, 350);
      };
    } catch (err) {
      console.warn('Screen snipping cancelled or error:', err);
      if (err.name !== 'NotAllowedError') {
        this.showToast('画面キャプチャがキャンセルされました');
      }
    }
  }

  initSnippingSelector(canvas) {
    const viewport = document.getElementById('snippingViewport');
    const cropBox = document.getElementById('snippingCropBox');
    const dimsLabel = document.getElementById('snippingSelectionDims');
    if (!viewport || !cropBox || !canvas) return;

    this.snippingCropRect = null; // Default to full image if not dragged
    cropBox.style.display = 'none';
    if (dimsLabel) dimsLabel.innerText = `画面全体 (${canvas.width} × ${canvas.height} px)`;

    let isSelecting = false;
    let startX = 0;
    let startY = 0;

    const getCanvasRelativePos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
      return { x, y, rect };
    };

    const onPointerDown = (e) => {
      if (e.target !== canvas && e.target !== viewport && e.target !== cropBox) return;
      isSelecting = true;
      const pos = getCanvasRelativePos(e);
      startX = pos.x;
      startY = pos.y;

      const vRect = viewport.getBoundingClientRect();
      cropBox.style.left = `${pos.rect.left - vRect.left + startX}px`;
      cropBox.style.top = `${pos.rect.top - vRect.top + startY}px`;
      cropBox.style.width = '0px';
      cropBox.style.height = '0px';
      cropBox.style.display = 'block';
    };

    const onPointerMove = (e) => {
      if (!isSelecting) return;
      const pos = getCanvasRelativePos(e);
      const curX = pos.x;
      const curY = pos.y;

      const left = Math.min(startX, curX);
      const top = Math.min(startY, curY);
      const width = Math.abs(curX - startX);
      const height = Math.abs(curY - startY);

      const vRect = viewport.getBoundingClientRect();
      cropBox.style.left = `${pos.rect.left - vRect.left + left}px`;
      cropBox.style.top = `${pos.rect.top - vRect.top + top}px`;
      cropBox.style.width = `${width}px`;
      cropBox.style.height = `${height}px`;

      // Calculate actual pixel dimensions on the source canvas
      const scaleX = canvas.width / pos.rect.width;
      const scaleY = canvas.height / pos.rect.height;
      const realW = Math.round(width * scaleX);
      const realH = Math.round(height * scaleY);

      if (dimsLabel) {
        dimsLabel.innerText = `${realW} × ${realH} px`;
      }

      this.snippingCropRect = {
        x: Math.round(left * scaleX),
        y: Math.round(top * scaleY),
        width: realW,
        height: realH
      };
    };

    const onPointerUp = () => {
      if (!isSelecting) return;
      isSelecting = false;
      if (this.snippingCropRect && (this.snippingCropRect.width < 10 || this.snippingCropRect.height < 10)) {
        this.snippingCropRect = null;
        cropBox.style.display = 'none';
        if (dimsLabel) dimsLabel.innerText = `画面全体 (${canvas.width} × ${canvas.height} px)`;
      }
    };

    viewport.onmousedown = onPointerDown;
    window.onmousemove = onPointerMove;
    window.onmouseup = onPointerUp;

    // Snipping Sizing Buttons Setup
    this.snippingSelectedSize = 'size-large';
    const sizeBtns = document.querySelectorAll('#snipSizeButtonGroup button');
    sizeBtns.forEach(btn => {
      btn.onclick = () => {
        sizeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.snippingSelectedSize = btn.dataset.size;
      };
    });

    // Confirm Snipping Button Handler
    const btnConfirm = document.getElementById('btnConfirmSnippingPaste');
    if (btnConfirm) {
      btnConfirm.onclick = async () => {
        await this.confirmAndInsertSnippedImage();
      };
    }

    const btnRecapture = document.getElementById('btnRecaptureScreen');
    if (btnRecapture) {
      btnRecapture.onclick = () => {
        this.closeModal('modalSnipping');
        setTimeout(() => this.startScreenSnipping(), 200);
      };
    }
  }

  async confirmAndInsertSnippedImage() {
    const canvas = document.getElementById('snippingSourceCanvas');
    if (!canvas) return;

    let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
    if (this.snippingCropRect && this.snippingCropRect.width > 0 && this.snippingCropRect.height > 0) {
      sx = this.snippingCropRect.x;
      sy = this.snippingCropRect.y;
      sw = this.snippingCropRect.width;
      sh = this.snippingCropRect.height;
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const ctx = cropCanvas.getContext('2d');
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    cropCanvas.toBlob(async (blob) => {
      if (!blob) {
        this.showToast('切り取り画像の生成に失敗しました');
        return;
      }
      this.closeModal('modalSnipping');
      await this.processAndInsertImageToTargetPage(blob, this.activeTargetPageIndex, this.snippingSelectedSize || 'size-large');
    }, 'image/png');
  }

  async processAndInsertImageToTargetPage(file, targetPageIndex, sizeClass = 'size-large') {
    this.showToast(`⚡ P.${targetPageIndex + 1} に画像を圧縮中...`);
    try {
      await this.performLocalWrite(async () => {
        const compressedBlob = await storageEngine.compressImage(file);
        const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
        await storageEngine.saveImage(imageId, compressedBlob);
        this.syncImageToCloud(imageId, compressedBlob).catch(err => console.warn(err));

        const targetPage = this.pages[targetPageIndex] || this.pages[0];
        if (!targetPage.blocks) targetPage.blocks = [];
        targetPage.blocks.push({ type: 'image', imageId, sizeClass: sizeClass, alignClass: 'align-center' });
        await this.saveCurrentPagesState();
        await this.renderNotebookView();

        const origKb = Math.round(file.size / 1024);
        const compKb = Math.round(compressedBlob.size / 1024);
        this.showToast(`✨ P.${targetPageIndex + 1} に画像貼付完了 (${origKb}KB → ${compKb}KB)`);
      });
    } catch (err) {
      console.error('Image compression failed:', err);
      this.showToast('画像の処理に失敗しました');
    }
  }

  setupKeyboardShortcuts() {
    const chkArrows = document.getElementById('chkKbdArrows');
    const chkPg = document.getElementById('chkKbdPgKeys');
    const chkSrch = document.getElementById('chkKbdSearch');

    const savedConfig = localStorage.getItem('sn_kbd_config');
    if (savedConfig) {
      try {
        const parsed = JSON.parse(savedConfig);
        // Merge with defaults, ensuring pageTurnArrows is active
        this.kbdConfig = { ...this.kbdConfig, ...parsed };
      } catch (err) {}
    } else {
      this.kbdConfig = {
        pageTurnArrows: true,
        pageTurnPgKeys: true,
        search: true
      };
      localStorage.setItem('sn_kbd_config', JSON.stringify(this.kbdConfig));
    }

    if (chkArrows) {
      chkArrows.checked = this.kbdConfig.pageTurnArrows !== false;
      chkArrows.addEventListener('change', (e) => {
        this.kbdConfig.pageTurnArrows = e.target.checked;
        localStorage.setItem('sn_kbd_config', JSON.stringify(this.kbdConfig));
        this.showToast(`矢印キーページめくり: ${e.target.checked ? 'ON' : 'OFF'}`);
      });
    }

    if (chkPg) {
      chkPg.checked = this.kbdConfig.pageTurnPgKeys !== false;
      chkPg.addEventListener('change', (e) => {
        this.kbdConfig.pageTurnPgKeys = e.target.checked;
        localStorage.setItem('sn_kbd_config', JSON.stringify(this.kbdConfig));
        this.showToast(`PageUp/PgDnページめくり: ${e.target.checked ? 'ON' : 'OFF'}`);
      });
    }

    if (chkSrch) {
      chkSrch.checked = this.kbdConfig.search !== false;
      chkSrch.addEventListener('change', (e) => {
        this.kbdConfig.search = e.target.checked;
        localStorage.setItem('sn_kbd_config', JSON.stringify(this.kbdConfig));
        this.showToast(`Ctrl+F ノート内検索: ${e.target.checked ? 'ON' : 'OFF'}`);
      });
    }

    window.addEventListener('keydown', (e) => {
      // 1. If any modal is active, Esc should close it
      const activeModal = document.querySelector('.modal-overlay.active');
      if (e.key === 'Escape') {
        if (activeModal) {
          e.preventDefault();
          this.closeModal(activeModal.id);
          return;
        }
        if (document.body.classList.contains('is-fullscreen-app')) {
          this.toggleFullscreen();
          return;
        }
      }

      // 2. If a modal is currently open, don't trigger page turns in the background
      if (activeModal) return;

      // 3. If currently editing text in input, textarea, or contentEditable note, preserve normal typing
      const isEditingText = document.activeElement && (
        ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) ||
        document.activeElement.isContentEditable ||
        document.activeElement.closest('[contenteditable="true"]')
      );
      if (isEditingText) return;

      // 4. Arrow Keys: Left = Prev, Right = Next
      if (this.kbdConfig.pageTurnArrows !== false) {
        if (e.key === 'ArrowRight' || e.key === 'Right') {
          e.preventDefault();
          this.nextPage();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'Left') {
          e.preventDefault();
          this.prevPage();
          return;
        }
      }

      // 5. PageUp / PageDown Keys
      if (this.kbdConfig.pageTurnPgKeys !== false) {
        if (e.key === 'PageDown') {
          e.preventDefault();
          this.nextPage();
          return;
        }
        if (e.key === 'PageUp') {
          e.preventDefault();
          this.prevPage();
          return;
        }
      }

      // 6. Home / End: First page / Last page
      if (e.key === 'Home') {
        e.preventDefault();
        this.jumpToPage(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        this.jumpToPage(this.pages.length - 1);
        return;
      }

      // 7. Search Shortcut (Ctrl + F)
      if (this.kbdConfig.search !== false && e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        this.openModal('modalSearch');
        return;
      }
    });
  }

  // Fullscreen Mode Toggle Engine
  toggleFullscreen() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);

    if (!isFull) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(err => console.warn(err));
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
      document.body.classList.add('is-fullscreen-app');
      this.showToast('🖥️ 全画面表示を開始しました (Escキーで解除)');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn(err));
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
      document.body.classList.remove('is-fullscreen-app');
      this.showToast('全画面表示を解除しました');
    }

    this.updateFullscreenButtonUI();
  }

  updateFullscreenButtonUI() {
    const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement) || document.body.classList.contains('is-fullscreen-app');
    const btn = document.getElementById('btnFullscreenToggle');
    const icon = document.getElementById('iconFullscreen');
    if (icon) icon.className = isFull ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
    if (btn) {
      btn.classList.toggle('active', isFull);
      btn.title = isFull ? '全画面表示を解除 (Esc)' : '全画面表示 (F11)';
    }
  }

  // Event Listeners with Safe Null Guards
  setupEventListeners() {
    const bindClick = (id, fn) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          fn(e);
        });
      }
    };

    // Listen for Native Fullscreen Change Event
    document.addEventListener('fullscreenchange', () => {
      const isFull = !!document.fullscreenElement;
      document.body.classList.toggle('is-fullscreen-app', isFull);
      this.updateFullscreenButtonUI();
      this.renderNotebookView();
    });

    // Window Resize Event for Responsive Device Detection
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.detectAndApplyDeviceLayout(), 150);
    });

    bindClick('btnManualSync', () => this.forceManualCloudSync());
    bindClick('btnGoogleAuth', () => this.handleGoogleAuth());
    bindClick('btnLiveStream', () => this.openModal('modalLiveStream'));
    bindClick('btnStartHostRoom', () => this.startLiveStreamHost());
    bindClick('btnStopHostRoom', () => this.stopLiveStreamHost());
    bindClick('btnCopyRoomCode', () => this.copyRoomCodeToClipboard());
    bindClick('hostRoomCodeDisplay', () => this.copyRoomCodeToClipboard());
    bindClick('btnJoinViewerRoom', () => this.joinLiveStreamViewer());
    bindClick('btnLeaveViewerRoom', () => this.leaveLiveStreamViewer());
    bindClick('btnPlanSimulator', () => this.toggleUserPlanSimulator());
    bindClick('btnUpgradeToPaidSim', () => {
      this.toggleUserPlanSimulator('paid');
      this.closeModal('modalCapacityLimit');
    });
    bindClick('btnRemoveAdUpgrade', () => this.toggleUserPlanSimulator('paid'));
    bindClick('btnPersonaToggle', () => this.openModal('modalThemePicker'));
    bindClick('btnTogglePageLock', () => this.togglePageLock());
    bindClick('btnRenameNotebook', () => this.renameNotebook());

    bindClick('btnAddTab', () => this.createNewNotebook());
    bindClick('btnNextPage', () => this.nextPage());
    bindClick('btnPrevPage', () => this.prevPage());
    bindClick('btnFooterNext', () => this.nextPage());
    bindClick('btnFooterPrev', () => this.prevPage());

    bindClick('btnFirstPage', () => this.jumpToPage(0));
    bindClick('btnLastPage', () => this.jumpToPage(this.pages.length - 1));

    // Sidebar Note Element Overlay Buttons
    bindClick('btnStartSnipping', () => this.startScreenSnipping());
    bindClick('btnToolSnipping', () => this.startScreenSnipping());
    bindClick('btnAddText', () => this.addTextBlock());
    bindClick('btnAddLink', () => this.addLinkBlock());
    bindClick('btnAddDraw', () => this.openModal('modalDraw'));
    bindClick('btnAddTagBoss', () => this.addTagBlock('boss'));

    // Sidebar Settings & Share Buttons (Mobile Friendly)
    bindClick('btnSidebarShare', () => this.openShareModal());
    bindClick('btnSidebarShortcuts', () => this.openModal('modalShortcuts'));

    const pNumInput = document.getElementById('pageNumberInput');
    if (pNumInput) {
      pNumInput.addEventListener('change', (e) => {
        const pageNum = parseInt(e.target.value);
        if (!isNaN(pageNum)) {
          this.jumpToPage(pageNum - 1);
        }
      });
    }

    // Page Operations
    bindClick('btnAddPage', () => this.addNewPage());
    bindClick('btnInsertPageAfter', () => this.insertPageAfterActive());
    bindClick('btnDuplicatePage', () => this.duplicateActivePage());
    bindClick('btnDeletePage', () => this.deleteCurrentPage());

    bindClick('btnSetBookmarkLabel', () => this.setBookmarkLabelForCurrentPage());
    bindClick('btnRemoveBookmarkLabel', () => this.removeBookmarkLabelForCurrentPage());

    // Radio toggle listener for export scope
    const radFull = document.getElementById('exportScopeFull');
    const radRange = document.getElementById('exportScopeRange');
    const rangeInputs = document.getElementById('exportRangeInputs');

    if (radFull && radRange && rangeInputs) {
      radFull.addEventListener('change', () => { rangeInputs.style.display = 'none'; });
      radRange.addEventListener('change', () => { rangeInputs.style.display = 'inline-flex'; });
    }

    bindClick('btnExportImport', () => this.openShareModal());
    bindClick('btnExportData', () => this.exportCurrentNotebook());
    bindClick('btnExportCSV', () => this.exportCSV());
    bindClick('btnTriggerImportFile', () => {
      const impInput = document.getElementById('importFileInput');
      if (impInput) impInput.click();
    });

    // Modal Segmented Tabs (Share & AI Modal)
    document.querySelectorAll('.modal-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetTabId = btn.dataset.tab;
        const parentCard = btn.closest('.modal-card');
        if (!parentCard) return;
        parentCard.querySelectorAll('.modal-tab-btn').forEach((b) => b.classList.remove('active'));
        parentCard.querySelectorAll('.modal-tab-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        const targetPane = document.getElementById(targetTabId);
        if (targetPane) targetPane.classList.add('active');
      });
    });

    // AI Prompt Copy Button
    bindClick('btnCopyAIPrompt', () => {
      const promptEl = document.getElementById('aiPromptTextarea');
      if (promptEl) {
        navigator.clipboard.writeText(promptEl.value).then(() => {
          this.showToast('📋 AI作成プロンプトをコピーしました！ChatGPTやClaudeに貼り付けてください');
        }).catch(() => {
          promptEl.select();
          document.execCommand('copy');
          this.showToast('📋 AI作成プロンプトをコピーしました！');
        });
      }
    });

    // Go to Import Tab Button from AI Tab
    bindClick('btnGoToImportTab', () => {
      const tabImportBtn = document.getElementById('tabBtnShareImport');
      if (tabImportBtn) tabImportBtn.click();
      const rawTextarea = document.getElementById('importRawTextarea');
      if (rawTextarea) rawTextarea.focus();
    });

    // Import from Raw Text Paste
    bindClick('btnImportFromText', () => {
      const rawTextarea = document.getElementById('importRawTextarea');
      if (!rawTextarea || !rawTextarea.value.trim()) {
        alert('貼り付けられたデータが空です。AIが出力したJSONを貼り付けてください。');
        return;
      }
      this.importNotebookFromText(rawTextarea.value);
    });

    bindClick('btnClearImportText', () => {
      const rawTextarea = document.getElementById('importRawTextarea');
      if (rawTextarea) rawTextarea.value = '';
    });

    bindClick('btnImportAsNewNotebook', () => this.importAsNewNotebook());
    bindClick('btnImportInsertIntoActive', () => this.importInsertIntoActiveNotebook());

    // Sidebar & Icon Toggles
    const toggleSidebar = (e) => {
      if (e) e.stopPropagation();
      const sidebar = document.getElementById('quickSidebar');
      const floatBtn = document.getElementById('btnFloatingSidebar');
      if (!sidebar) return;

      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      if (floatBtn) floatBtn.style.display = isCollapsed ? 'inline-flex' : 'none';
      
      const headerBtn = document.getElementById('btnHeaderSidebarToggle');
      if (headerBtn) headerBtn.classList.toggle('active', !isCollapsed);
    };

    bindClick('btnToggleSidebar', toggleSidebar);
    bindClick('btnFloatingSidebar', toggleSidebar);
    bindClick('btnHeaderSidebarToggle', toggleSidebar);

    bindClick('btnSoundToggle', () => {
      this.soundEnabled = !this.soundEnabled;
      const btn = document.getElementById('btnSoundToggle');
      const icon = document.getElementById('iconSound');
      if (icon) icon.className = this.soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
      if (btn) btn.classList.toggle('active', this.soundEnabled);
      this.showToast(`めくり効果音: ${this.soundEnabled ? 'ON' : 'OFF'}`);
    });

    bindClick('btnToggleMode', () => {
      this.viewMode = this.viewMode === 'double' ? 'single' : 'double';
      this.userViewModePreference = this.viewMode;
      const icon = document.getElementById('iconMode');
      if (icon) icon.className = this.viewMode === 'double' ? 'fa-solid fa-book-open' : 'fa-solid fa-file';
      this.renderNotebookView();
      this.showToast(`表示モード: ${this.viewMode === 'double' ? '見開き' : '単一ページ'}`);
    });

    bindClick('btnFullscreenToggle', () => this.toggleFullscreen());

    bindClick('btnSpeedToggle', () => {
      this.speedMode = this.speedMode === '3d' ? 'fast' : '3d';
      const btn = document.getElementById('btnSpeedToggle');
      if (btn) btn.classList.toggle('active', this.speedMode === 'fast');
      this.showToast(`めくりモード: ${this.speedMode === 'fast' ? '⚡ 高速即時切り替え' : '📖 3Dリアル本めくり'}`);
    });

    bindClick('btnSearch', () => this.openModal('modalSearch'));
    bindClick('btnShortcuts', () => this.openModal('modalShortcuts'));
    bindClick('btnOverviewModal', () => {
      this.renderOverviewGrid();
      this.openModal('modalOverview');
    });

    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const modalId = btn.dataset.close;
        this.closeModal(modalId);
      });
    });

    const importInput = document.getElementById('importFileInput');
    if (importInput) {
      importInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          e.target.value = '';
          this.importNotebookFile(file);
        }
      });
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
    }
  }

  // Open Share Modal with Range Inputs Sync
  openShareModal() {
    const startInput = document.getElementById('exportStartPage');
    const endInput = document.getElementById('exportEndPage');
    if (startInput && endInput) {
      startInput.max = this.pages.length;
      endInput.max = this.pages.length;
      startInput.value = 1;
      endInput.value = this.pages.length;
    }
    this.openModal('modalShare');
  }

  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('active');
  }

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('active');
  }

  renderOverviewGrid() {
    const gridContainer = document.getElementById('pageOverviewGrid');
    if (!gridContainer) return;
    gridContainer.innerHTML = '';

    this.pages.forEach((p, idx) => {
      const thumb = document.createElement('div');
      thumb.className = `page-thumb ${idx === this.currentPageIndex ? 'active' : ''} ${p.isLocked ? 'is-locked' : ''}`;
      thumb.innerHTML = `
        <div style="display:flex; justify-content:space-between;">
          <span style="font-weight:bold; color:var(--accent-cyan);">P.${idx + 1}</span>
          ${p.isLocked ? '<i class="fa-solid fa-lock" style="color:var(--accent-amber);"></i>' : ''}
        </div>
        <div style="font-size:0.75rem; color:var(--text-main);">${this.escapeHtml(p.bookmarkLabel || '')}</div>
        <div style="font-size:0.7rem; color:var(--text-dim); overflow:hidden;">${p.blocks ? p.blocks.length : 0} 個の要素</div>
      `;
      thumb.addEventListener('click', () => {
        this.jumpToPage(idx);
        this.closeModal('modalOverview');
      });
      gridContainer.appendChild(thumb);
    });
  }

  handleSearch(query) {
    const resultsContainer = document.getElementById('searchResults');
    if (!resultsContainer) return;
    resultsContainer.innerHTML = '';

    if (!query || !query.trim()) return;
    const q = query.toLowerCase().trim();

    this.pages.forEach((p, pIdx) => {
      if (p.bookmarkLabel && p.bookmarkLabel.toLowerCase().includes(q)) {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `<strong>P.${pIdx + 1} インデックス</strong>: [${this.escapeHtml(p.bookmarkLabel)}]`;
        item.addEventListener('click', () => {
          this.jumpToPage(pIdx);
          this.closeModal('modalSearch');
        });
        resultsContainer.appendChild(item);
      }

      if (p.blocks) {
        p.blocks.forEach((b) => {
          let matchText = '';
          if (b.type === 'note' && b.text.toLowerCase().includes(q)) matchText = b.text;
          else if (b.type === 'link' && (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))) matchText = b.title || b.url;
          else if (b.type === 'tag' && b.text.toLowerCase().includes(q)) matchText = `[${b.tagType}] ${b.text}`;

          if (matchText) {
            const item = document.createElement('div');
            item.className = 'search-item';
            item.innerHTML = `<strong>P.${pIdx + 1}</strong>: ${this.escapeHtml(matchText)}`;
            item.addEventListener('click', () => {
              this.jumpToPage(pIdx);
              this.closeModal('modalSearch');
            });
            resultsContainer.appendChild(item);
          }
        });
      }
    });

    if (resultsContainer.children.length === 0) {
      resultsContainer.innerHTML = `<div style="color:var(--text-dim); padding:10px;">「${this.escapeHtml(query)}」に一致する結果は見つかりませんでした</div>`;
    }
  }

  // Export Notebook or Page Range
  async exportCurrentNotebook() {
    const activeNb = this.getActiveNotebook();
    const isRange = document.getElementById('exportScopeRange') && document.getElementById('exportScopeRange').checked;
    
    let pagesToExport = [];
    let fileSuffix = '全ページ';

    if (isRange) {
      const startP = Math.max(1, parseInt(document.getElementById('exportStartPage').value) || 1);
      const endP = Math.min(this.pages.length, parseInt(document.getElementById('exportEndPage').value) || this.pages.length);
      
      if (startP > endP) {
        alert('指定したページ範囲が無効です（開始ページが終了ページより大きくなっています）。');
        return;
      }

      pagesToExport = this.pages.slice(startP - 1, endP);
      fileSuffix = `P${startP}-${endP}`;
    } else {
      pagesToExport = this.pages;
    }

    if (pagesToExport.length === 0) {
      this.showToast('エクスポート対象のページがありません');
      return;
    }

    const exportData = {
      version: 1.0,
      appName: 'STRATEGYNOTE',
      exportScope: isRange ? 'range' : 'full',
      notebook: activeNb,
      pages: pagesToExport,
      images: []
    };

    // Gather images referenced in exported pages
    for (const page of pagesToExport) {
      if (page.blocks) {
        for (const block of page.blocks) {
          if ((block.type === 'image' || block.type === 'drawing') && block.imageId) {
            const blobUrl = await storageEngine.getImageUrl(block.imageId);
            if (blobUrl) {
              const blob = await fetch(blobUrl).then((r) => r.blob());
              const base64 = await this.blobToBase64(blob);
              exportData.images.push({ id: block.imageId, base64 });
            }
          }
        }
      }
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `STRATEGYNOTE_${(activeNb.title || 'notebook').replace(/\s+/g, '_')}_${fileSuffix}.strategy`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    this.closeModal('modalShare');
    this.showToast(`STRATEGYNOTE エクスポート完了！ (${pagesToExport.length} ページ)`);
  }

  exportCSV() {
    const activeNb = this.getActiveNotebook();
    let csvRows = [];
    csvRows.push(['ページ番号', 'インデックス名', '要素タイプ', '内容/テキスト', 'URL']);

    this.pages.forEach((p, idx) => {
      const pageNum = `P.${idx + 1}`;
      const indexName = p.bookmarkLabel || '';

      if (!p.blocks || p.blocks.length === 0) {
        csvRows.push([pageNum, indexName, '空ページ', '', '']);
      } else {
        p.blocks.forEach((b) => {
          let typeLabel = '';
          let textContent = '';
          let url = '';

          if (b.type === 'note') {
            typeLabel = 'メモテキスト';
            textContent = b.text.replace(/<br\s*[\/]?>/gi, '\n').replace(/<[^>]+>/g, '');
          } else if (b.type === 'link') {
            typeLabel = 'Webリンク';
            textContent = b.title || b.url;
            url = b.url;
          } else if (b.type === 'tag') {
            typeLabel = `タグ[${b.tagType}]`;
            textContent = b.text;
          } else if (b.type === 'image') {
            typeLabel = '図解/画像';
            textContent = b.caption || '貼り付け画像';
          } else if (b.type === 'drawing') {
            typeLabel = '手書き合成メモ';
            textContent = '手書きメモ';
          }

          csvRows.push([pageNum, indexName, typeLabel, textContent, url]);
        });
      }
    });

    const csvContent = csvRows
      .map((row) => row.map((cell) => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', `STRATEGYNOTE_${(activeNb.title || 'manual').replace(/\s+/g, '_')}_データ.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    this.showToast('STRATEGYNOTE CSVデータをダウンロードしました！');
  }

  // Clean raw AI or file JSON (Strips markdown code fences and conversational pre/postamble)
  cleanJsonText(text) {
    if (!text) return '';
    let cleaned = text.trim();
    // Strip Markdown code blocks if present (```json ... ``` or ``` ...)
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\r?\n?/, '').replace(/\r?\n?```$/, '').trim();
    }
    // Extract JSON object if AI provided conversational text around it
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
    return cleaned;
  }

  // Handle Importing .strategy / .json File & Prompt Choice Modal
  async importNotebookFile(file) {
    try {
      const text = await file.text();
      const cleaned = this.cleanJsonText(text);
      const data = JSON.parse(cleaned);

      if (!data.pages || data.pages.length === 0) {
        alert('無効または空の STRATEGYNOTE ファイルです。');
        return;
      }

      this.pendingImportData = data;

      const fileTitleEl = document.getElementById('importChoiceFileTitle');
      const pageCountEl = document.getElementById('importChoicePageCount');
      const btnInsert = document.getElementById('btnImportInsertIntoActive');

      const nbTitle = data.notebook ? (data.notebook.title || '共有データ') : '共有データ';
      if (fileTitleEl) fileTitleEl.innerText = `共有ファイル 「${nbTitle}」 を受け取りました`;
      if (pageCountEl) pageCountEl.innerText = `（含まれるページ数: 全 ${data.pages.length} ページ）`;
      
      const targetNbTitle = this.getActiveNotebook().title || '現在ノート';
      const insertTargetP = this.activeTargetPageIndex + 1;
      if (btnInsert) {
        btnInsert.innerHTML = `📥 ② 開いているノート 「${this.escapeHtml(targetNbTitle)}」 の P.${insertTargetP} の直後にページ挿入`;
      }

      this.closeModal('modalShare');
      this.openModal('modalImportChoice');
    } catch (err) {
      console.error('Import file parse failed:', err);
      alert('ファイルの読み込みに失敗しました。対応する .strategy または .json ファイルか確認してください。');
    }
  }

  // Handle Importing JSON from direct raw text paste (Mobile-Friendly & Zero-File AI Flow)
  async importNotebookFromText(rawText) {
    if (!rawText || !rawText.trim()) {
      alert('貼り付けられたデータが空です。AIの出力したJSONを貼り付けてください。');
      return;
    }

    try {
      const cleaned = this.cleanJsonText(rawText);
      const data = JSON.parse(cleaned);

      if (!data.pages || data.pages.length === 0) {
        alert('無効またはページが含まれていない STRATEGYNOTE データです。');
        return;
      }

      this.pendingImportData = data;

      const fileTitleEl = document.getElementById('importChoiceFileTitle');
      const pageCountEl = document.getElementById('importChoicePageCount');
      const btnInsert = document.getElementById('btnImportInsertIntoActive');

      const nbTitle = data.notebook ? (data.notebook.title || 'AI作成ノート') : 'AI作成ノート';
      if (fileTitleEl) fileTitleEl.innerText = `ノートデータ 「${nbTitle}」 を受け取りました`;
      if (pageCountEl) pageCountEl.innerText = `（含まれるページ数: 全 ${data.pages.length} ページ）`;

      const targetNbTitle = this.getActiveNotebook().title || '現在ノート';
      const insertTargetP = this.activeTargetPageIndex + 1;
      if (btnInsert) {
        btnInsert.innerHTML = `📥 ② 開いているノート 「${this.escapeHtml(targetNbTitle)}」 の P.${insertTargetP} の直後にページ挿入`;
      }

      this.closeModal('modalShare');
      this.openModal('modalImportChoice');
    } catch (err) {
      console.error('Import text parse failed:', err);
      alert('JSONデータの解析に失敗しました。AIの出力が正しくJSON形式になっているか確認してください。');
    }
  }

  // Import Target Choice 1: Save as New Standalone Notebook
  async importAsNewNotebook() {
    if (!this.pendingImportData) return;
    const data = this.pendingImportData;

    const btn1 = document.getElementById('btnImportAsNewNotebook');
    const btn2 = document.getElementById('btnImportInsertIntoActive');
    if (btn1) {
      btn1.disabled = true;
      btn1.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 取り込み保存中...';
    }
    if (btn2) btn2.disabled = true;

    try {
      await this.performLocalWrite(async () => {
        if (data.images && Array.isArray(data.images)) {
          for (const imgObj of data.images) {
            if (imgObj && imgObj.base64 && imgObj.id) {
              const blob = this.base64ToBlob(imgObj.base64);
              if (blob) {
                await storageEngine.saveImage(imgObj.id, blob);
                this.syncImageToCloud(imgObj.id, blob).catch(err => console.warn('Sync image background warning:', err));
              }
            }
          }
        }

        const origTitle = data.notebook ? (data.notebook.title || '共有ノート') : '共有ノート';
        let finalTitle = origTitle;
        const existingTitles = new Set((this.notebooks || []).map((n) => n.title));
        if (existingTitles.has(finalTitle)) {
          const candidate = `${origTitle} (共有)`;
          if (!existingTitles.has(candidate)) {
            finalTitle = candidate;
          } else {
            let counter = 2;
            while (existingTitles.has(`${origTitle} (共有 ${counter})`)) {
              counter++;
            }
            finalTitle = `${origTitle} (共有 ${counter})`;
          }
        }

        const newNb = {
          id: 'nb_' + Date.now(),
          title: finalTitle,
          icon: 'fa-book',
          createdAt: Date.now()
        };

        const reindexedPages = (data.pages || []).map((p, idx) => ({
          ...p,
          id: 'p_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 5),
          notebookId: newNb.id,
          pageIndex: idx
        }));

        await storageEngine.saveNotebook(newNb);
        await storageEngine.savePages(reindexedPages);

        // Sync to cloud in background without blocking UI
        this.syncNotebookToCloud(newNb).catch(err => console.warn('Sync notebook background warning:', err));
        this.syncPagesToCloud(reindexedPages).catch(err => console.warn('Sync pages background warning:', err));

        this.closeModal('modalImportChoice');
        this.pendingImportData = null;

        await this.loadNotebooks();
        await this.switchNotebook(newNb.id);
        this.showToast(`📖 新しいノート 「${newNb.title}」 として保存しました！`);
      });
    } catch (err) {
      console.error('Import as new notebook error:', err);
      alert('ノートの取り込みに失敗しました: ' + (err.message || err));
    } finally {
      if (btn1) {
        btn1.disabled = false;
        btn1.innerHTML = '<i class="fa-solid fa-book"></i> ① 新しい別冊ノートとして追加保存';
      }
      if (btn2) btn2.disabled = false;
    }
  }

  // Import Target Choice 2: Insert Pages into Currently Active Notebook at Active Page Target
  async importInsertIntoActiveNotebook() {
    if (!this.pendingImportData) return;
    const data = this.pendingImportData;

    const btn1 = document.getElementById('btnImportAsNewNotebook');
    const btn2 = document.getElementById('btnImportInsertIntoActive');
    if (btn2) {
      btn2.disabled = true;
      btn2.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ページ挿入中...';
    }
    if (btn1) btn1.disabled = true;

    try {
      await this.performLocalWrite(async () => {
        if (data.images && Array.isArray(data.images)) {
          for (const imgObj of data.images) {
            if (imgObj && imgObj.base64 && imgObj.id) {
              const blob = this.base64ToBlob(imgObj.base64);
              if (blob) {
                await storageEngine.saveImage(imgObj.id, blob);
                this.syncImageToCloud(imgObj.id, blob).catch(err => console.warn('Sync image background warning:', err));
              }
            }
          }
        }

        const insertIdx = (this.activeTargetPageIndex !== undefined && this.activeTargetPageIndex >= 0)
          ? this.activeTargetPageIndex + 1
          : (this.currentPageIndex !== undefined ? this.currentPageIndex + 1 : this.pages.length);
        const targetNbId = this.currentNotebookId;

        const clonedPages = (data.pages || []).map((p, idx) => ({
          ...p,
          id: 'p_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 5),
          notebookId: targetNbId
        }));

        this.pages.splice(insertIdx, 0, ...clonedPages);
        this.pages.forEach((p, idx) => (p.pageIndex = idx));

        await storageEngine.savePages(this.pages);

        // Sync pages to cloud in background without blocking UI
        this.syncPagesToCloud(this.pages).catch(err => console.warn('Sync pages background warning:', err));

        this.activeTargetPageIndex = insertIdx;
        this.currentPageIndex = insertIdx % 2 === 0 ? insertIdx : insertIdx - 1;

        this.closeModal('modalImportChoice');
        this.pendingImportData = null;

        await this.renderNotebookView();
        await this.updatePlanUI();
        this.showToast(`📥 P.${insertIdx} の直後に ${clonedPages.length} ページを取り込んで挿入しました！`);
      });
    } catch (err) {
      console.error('Import insert pages error:', err);
      alert('ページの挿入に失敗しました: ' + (err.message || err));
    } finally {
      if (btn2) {
        btn2.disabled = false;
        const targetNbTitle = this.getActiveNotebook().title || '現在ノート';
        const insertTargetP = this.activeTargetPageIndex + 1;
        btn2.innerHTML = `📥 ② 開いているノート 「${this.escapeHtml(targetNbTitle)}」 の P.${insertTargetP} の直後にページ挿入`;
      }
      if (btn1) btn1.disabled = false;
    }
  }

  getActiveNotebook() {
    return this.notebooks.find((n) => n.id === this.currentNotebookId) || {};
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  // Fast synchronous Base64 string to Blob conversion without network/fetch dependency
  base64ToBlob(base64Str) {
    if (!base64Str || typeof base64Str !== 'string') return null;
    try {
      let mimeType = 'image/webp';
      let rawBase64 = base64Str;
      const commaIdx = base64Str.indexOf(',');
      if (commaIdx !== -1) {
        const prefix = base64Str.substring(0, commaIdx);
        const match = prefix.match(/:(.*?);/);
        if (match) mimeType = match[1];
        rawBase64 = base64Str.substring(commaIdx + 1);
      }
      const byteCharacters = atob(rawBase64);
      const byteNumbers = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      return new Blob([byteNumbers], { type: mimeType });
    } catch (err) {
      console.warn('base64ToBlob conversion warning:', err);
      return null;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new StrategyApp();
});
