/**
 * STRATEGYNOTE Engine
 * Integrated with Realtime Account Cloud Sync (Firebase Realtime Database per User UID),
 * Interactive Draggable/Resizable Stamps Canvas, Automatic Mobile/Desktop Device Detection,
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
    
    // Firebase Cloud Engine State
    this.firebaseApp = null;
    this.currentUser = null;
    this.liveStreamState = 'none'; // 'none' | 'host' | 'viewer'
    this.currentRoomCode = null;
    this.maxViewers = 10; // Strict limit: 1 host + 9 audience members = 10 total
    this.liveRoomRef = null;

    // Granular Keyboard Shortcut Toggles
    this.kbdConfig = {
      pageTurnArrows: false,
      pageTurnPgKeys: false,
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

    // Resize Debounce Timer
    this.resizeTimer = null;

    this.init();
  }

  async init() {
    try {
      this.applyTheme(this.currentTheme);
      await storageEngine.init();
      await storageEngine.seedInitialDataIfEmpty();
      await this.loadNotebooks();
      this.detectAndApplyDeviceLayout();
      this.initFirebase();
      this.setupEventListeners();
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

  // Automatic Mobile vs Desktop Detection & Dynamic Layout Adaptor
  isMobileDevice() {
    return window.innerWidth <= 768 || ('ontouchstart' in window && window.innerWidth <= 1024) || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  detectAndApplyDeviceLayout() {
    const mobile = this.isMobileDevice();
    const prevMode = this.viewMode;

    if (mobile) {
      this.viewMode = 'single';
      const sidebar = document.getElementById('quickSidebar');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        const floatBtn = document.getElementById('btnFloatingSidebar');
        if (floatBtn) floatBtn.style.display = 'inline-flex';
      }
    } else {
      this.viewMode = 'double';
      const sidebar = document.getElementById('quickSidebar');
      if (sidebar) {
        sidebar.classList.remove('collapsed');
        const floatBtn = document.getElementById('btnFloatingSidebar');
        if (floatBtn) floatBtn.style.display = 'none';
      }
    }

    const icon = document.getElementById('iconMode');
    if (icon) icon.className = this.viewMode === 'double' ? 'fa-solid fa-book-open' : 'fa-solid fa-file';

    if (prevMode !== this.viewMode && this.pages.length > 0) {
      this.renderNotebookView();
    }
  }

  // Theme Management (5 Color Themes)
  applyTheme(themeName) {
    const body = document.getElementById('appBody');
    if (!body) return;

    body.className = themeName;
    this.currentTheme = themeName;
    localStorage.setItem('sn_current_theme', themeName);

    document.querySelectorAll('.theme-card').forEach((card) => {
      if (card.dataset.theme === themeName) card.classList.add('active');
      else card.classList.remove('active');
    });
  }

  setupThemePicker() {
    document.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const theme = card.dataset.theme;
        this.applyTheme(theme);
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
            if (lblAuth) lblAuth.innerHTML = `<i class="fa-solid fa-user-check" style="color:var(--accent-green);"></i> ${this.escapeHtml(user.displayName || user.email)}`;
            if (sidebarSync) {
              sidebarSync.innerText = '☁️ クラウド同期ON';
              sidebarSync.className = 'status-value highlight-green';
            }
            await this.syncCloudDataOnLogin(user);
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

  // Account Cloud Sync Engine: Fetch user data on login or upload local
  async syncCloudDataOnLogin(user) {
    if (!user || !window.firebase || !window.firebase.database) return;
    this.showToast('☁️ アカウントから全ノートを同期中...');

    try {
      const uid = user.uid;
      const userRef = firebase.database().ref('users/' + uid);

      const snapshot = await userRef.once('value');
      const val = snapshot.val();

      if (val) {
        // Sync cloud notebooks to local DB
        if (val.notebooks) {
          const cloudNbs = Object.values(val.notebooks);
          for (const nb of cloudNbs) {
            await storageEngine.saveNotebook(nb);
          }
        }

        // Sync cloud pages to local DB
        if (val.pages) {
          const cloudPages = Object.values(val.pages);
          await storageEngine.savePages(cloudPages);
        }

        // Sync cloud images to local DB
        if (val.images) {
          for (const [imgId, base64Str] of Object.entries(val.images)) {
            if (base64Str) {
              const blob = await this.base64ToBlob(base64Str);
              await storageEngine.saveImage(imgId, blob);
            }
          }
        }

        await this.loadNotebooks();
        this.showToast(`☁️ クラウド同期完了！ (${user.displayName || user.email})`);
      } else {
        // First login for this account: upload existing local notebooks to cloud
        await this.syncAllLocalToCloud(user);
        this.showToast(`☁️ アカウント初期化完了: ローカルノートをクラウドへ同期しました`);
      }
    } catch (err) {
      console.warn('Cloud sync error:', err);
    }
  }

  async syncAllLocalToCloud(user) {
    if (!user || !window.firebase || !window.firebase.database) return;
    try {
      const uid = user.uid;
      const nbs = await storageEngine.getAllNotebooks();
      
      const nbsMap = {};
      const pagesMap = {};
      const imagesMap = {};

      for (const nb of nbs) {
        nbsMap[nb.id] = nb;
        const pgs = await storageEngine.getPagesForNotebook(nb.id);
        for (const p of pgs) {
          pagesMap[p.id] = p;
          if (p.blocks) {
            for (const b of p.blocks) {
              if ((b.type === 'image' || b.type === 'drawing') && b.imageId) {
                const blobUrl = await storageEngine.getImageUrl(b.imageId);
                if (blobUrl) {
                  const blob = await fetch(blobUrl).then(r => r.blob());
                  const base64 = await this.blobToBase64(blob);
                  imagesMap[b.imageId] = base64;
                }
              }
            }
          }
        }
      }

      await firebase.database().ref('users/' + uid).set({
        notebooks: nbsMap,
        pages: pagesMap,
        images: imagesMap,
        updatedAt: Date.now()
      });
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
      const base64 = await this.blobToBase64(blob);
      await firebase.database().ref(`users/${this.currentUser.uid}/images/${imageId}`).set(base64);
    } catch (err) {
      console.warn('Cloud sync image warning:', err);
    }
  }

  async deleteNotebookFromCloud(notebookId) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      await firebase.database().ref(`users/${this.currentUser.uid}/notebooks/${notebookId}`).remove();
    } catch (err) {
      console.warn('Cloud delete notebook warning:', err);
    }
  }

  async deletePageFromCloud(pageId) {
    if (!this.currentUser || !window.firebase || !window.firebase.database) return;
    try {
      await firebase.database().ref(`users/${this.currentUser.uid}/pages/${pageId}`).remove();
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

      // On Mobile devices, ALWAYS use signInWithRedirect directly to avoid popup blockers
      if (this.isMobileDevice()) {
        this.showToast('Googleログイン画面に移動中...');
        await firebase.auth().signInWithRedirect(provider);
        return;
      }

      await firebase.auth().signInWithPopup(provider);
    } catch (err) {
      console.warn('Google Popup Auth Warning:', err);

      // Fallback for pop-up blocked or mobile browsers
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebase.auth().signInWithRedirect(provider);
      } catch (fErr) {
        if (err.code === 'auth/unauthorized-domain') {
          alert('Firebase Consoleの承認ドメイン設定が必要です。\nFirebase Console -> Authentication -> Settings -> Authorized domains に 「strategy-notebook.web.app」 を追加してください。');
        } else if (err.code === 'auth/operation-not-allowed') {
          alert('Firebase ConsoleでGoogleログインプロバイダが有効化されていません。\nFirebase Console -> Authentication -> Sign-in method で 「Google」 を有効（ON）に設定してください。');
        } else {
          alert(`Googleログインエラー (${err.code || 'エラー'}): ${err.message}`);
        }
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

  // Toggle Plan (Enforce Paid Tier Subscription Rules)
  toggleUserPlanSimulator(forcePlan = null) {
    if (forcePlan) {
      this.userPlan = forcePlan;
      localStorage.setItem('sn_user_plan', forcePlan);
    }

    this.updatePlanUI();

    if (this.userPlan === 'paid') {
      this.showToast('👑 有料プランが適用されています（広告完全非表示・作成上限30冊）');
    } else {
      this.showToast('🆓 無料プラン（広告表示・最大3冊/100P）');
    }
  }

  async updatePlanUI() {
    const btnBadge = document.getElementById('btnPlanSimulator');
    const lblBadge = document.getElementById('lblPlanBadge');
    const iconPlan = document.getElementById('iconPlan');
    const adHeader = document.getElementById('strategyAdBannerHeader');

    const sidebarPlanName = document.getElementById('sidebarPlanName');
    const sidebarNbUsage = document.getElementById('sidebarNbUsage');
    const sidebarPageUsage = document.getElementById('sidebarPageUsage');

    const totalPagesCount = await this.calculateTotalPagesAllNotebooks();
    const isPaid = this.userPlan === 'paid';

    if (isPaid) {
      if (btnBadge) btnBadge.className = 'btn-plan-badge paid-plan';
      if (iconPlan) iconPlan.className = 'fa-solid fa-crown';
      if (lblBadge) lblBadge.innerText = '👑 有料プラン (広告OFF)';
      if (adHeader) adHeader.style.display = 'none'; // 有料会員は広告OFF

      if (sidebarPlanName) sidebarPlanName.innerText = '👑 有料プラン (広告OFF)';
      if (sidebarNbUsage) sidebarNbUsage.innerText = `${this.notebooks.length} / 30 冊`;
      if (sidebarPageUsage) sidebarPageUsage.innerText = `${totalPagesCount} ページ`;
    } else {
      if (btnBadge) btnBadge.className = 'btn-plan-badge free-plan';
      if (iconPlan) iconPlan.className = 'fa-solid fa-seedling';
      if (lblBadge) lblBadge.innerText = '🆓 無料 (3冊/100P)';
      if (adHeader) adHeader.style.display = 'flex'; // 無料版は広告ON

      if (sidebarPlanName) sidebarPlanName.innerText = '🆓 無料プラン';
      if (sidebarNbUsage) sidebarNbUsage.innerText = `${this.notebooks.length} / 3 冊`;
      if (sidebarPageUsage) sidebarPageUsage.innerText = `${totalPagesCount} / 100 ページ`;
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
    if (this.notebooks.length === 0) return;

    if (!this.currentNotebookId) {
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

  // Rename Notebook Title Engine
  async renameNotebook(notebookId = null) {
    const targetId = notebookId || this.currentNotebookId;
    const nb = this.notebooks.find((n) => n.id === targetId);
    if (!nb) return;

    const newTitle = prompt('ノートの新しい名前（タイトル）を入力してください:', nb.title);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === nb.title) return;

    nb.title = newTitle.trim();
    await storageEngine.saveNotebook(nb);
    await this.syncNotebookToCloud(nb);
    this.renderTabs();
    this.showToast(`✨ ノート名を 「${nb.title}」 に変更しました！`);
  }

  async switchNotebook(notebookId) {
    this.currentNotebookId = notebookId;
    this.currentPageIndex = 0;
    this.activeTargetPageIndex = 0;
    this.renderTabs();
    await this.loadCurrentNotebookPages();
    this.showToast(`ノート切替: ${this.getActiveNotebook().title}`);
  }

  // Capacity Limit Checks before Creation (3 Notebooks Free, 30 Notebooks Paid)
  async createNewNotebook() {
    const maxNbLimit = this.userPlan === 'paid' ? 30 : 3;

    if (this.notebooks.length >= maxNbLimit) {
      if (this.userPlan === 'free') {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ノート作成上限（3冊）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート作成は<b>最大3冊まで</b>となります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで大幅拡大</b>されます！';
        this.openModal('modalCapacityLimit');
      } else {
        alert('👑 有料プランのノート作成上限（30冊）に達しました。');
      }
      return;
    }

    const title = prompt('新しいノートのタイトルを入力してください:', '新規ノート');
    if (!title || !title.trim()) return;

    const newNb = {
      id: 'nb_' + Date.now(),
      title: title.trim(),
      icon: 'fa-book',
      createdAt: Date.now()
    };

    await storageEngine.saveNotebook(newNb);
    await this.syncNotebookToCloud(newNb);

    const firstPage = {
      id: 'p_' + Date.now(),
      notebookId: newNb.id,
      pageIndex: 0,
      bookmarkLabel: '概要',
      isLocked: false,
      blocks: [
        { type: 'note', text: 'ここにスクショや図解、手順説明テキストを配置できます。' }
      ]
    };
    await storageEngine.savePages([firstPage]);
    await this.syncPagesToCloud([firstPage]);

    await this.loadNotebooks();
    await this.switchNotebook(newNb.id);
  }

  async deleteNotebook(notebookId) {
    if (!confirm('このノートと含まれる全ページを削除しますか？')) return;
    await storageEngine.deleteNotebook(notebookId);
    await this.deleteNotebookFromCloud(notebookId);
    this.currentNotebookId = null;
    await this.loadNotebooks();
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

    if (this.viewMode === 'double') {
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

    pageObj.isLocked = !pageObj.isLocked;
    await this.saveCurrentPagesState();
    await this.renderNotebookView();

    if (pageObj.isLocked) {
      this.showToast(`🔒 P.${idx + 1} を編集ロックしました`);
    } else {
      this.showToast(`🔓 P.${idx + 1} のロックを解除しました`);
    }
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
    targetPage.bookmarkLabel = label.trim().substring(0, 6);
    await this.saveCurrentPagesState();
    this.renderPageBookmarksBar();

    if (targetPage.bookmarkLabel) {
      this.showToast(`P.${this.activeTargetPageIndex + 1} にインデックス 「${targetPage.bookmarkLabel}」 をつけました`);
    } else {
      this.showToast('インデックスを解除しました');
    }
  }

  async removeBookmarkLabelForCurrentPage() {
    const targetPage = this.pages[this.activeTargetPageIndex];
    if (!targetPage) return;
    if (targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    targetPage.bookmarkLabel = '';
    await this.saveCurrentPagesState();
    this.renderPageBookmarksBar();
    this.showToast(`P.${this.activeTargetPageIndex + 1} のインデックスを解除しました`);
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
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const sz = btn.dataset.size;
              this.resizeImageBlock(pageIndex, i, sz);
            });
          });

          // Alignment Button Listeners
          actionsEl.querySelectorAll('.align-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const algn = btn.dataset.align;
              this.setBlockAlignment(pageIndex, i, algn);
            });
          });

          // Move Up / Down Listeners
          const btnUp = actionsEl.querySelector('.btn-up');
          const btnDown = actionsEl.querySelector('.btn-down');
          if (btnUp) btnUp.addEventListener('click', (e) => { e.stopPropagation(); this.moveBlock(pageIndex, i, -1); });
          if (btnDown) btnDown.addEventListener('click', (e) => { e.stopPropagation(); this.moveBlock(pageIndex, i, 1); });

          // Delete Listener
          const delBtn = actionsEl.querySelector('.btn-del-block');
          if (delBtn) {
            delBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              this.deleteBlock(pageIndex, i);
            });
          }

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
          noteEl.innerHTML = block.text;

          if (!isLocked) {
            noteEl.addEventListener('blur', () => {
              block.text = noteEl.innerHTML;
              this.saveCurrentPagesState();
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

    await this.saveCurrentPagesState();
    await this.renderNotebookView();
    this.showToast('順序を入れ替えました！');
  }

  // Set Block Alignment (Left, Center, Right, Float-Left)
  async setBlockAlignment(pageIndex, blockIndex, alignClass) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked || !page.blocks || !page.blocks[blockIndex]) return;

    page.blocks[blockIndex].alignClass = alignClass;
    await this.saveCurrentPagesState();
    await this.renderNotebookView();
    this.showToast(`レイアウト変更: ${alignClass === 'align-float' ? '文字回り込み' : alignClass.replace('align-', '')}`);
  }

  // In-Between Block Insertion Prompt
  async promptInsertBlockAtIndex(pageIndex, insertIndex) {
    const targetPage = this.pages[pageIndex];
    if (!targetPage || targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const choice = prompt(
      `P.${pageIndex + 1} のこの位置に挿入する要素を選択してください:\n1: メモ文字\n2: Webリンク\n3: 重要タグ\n(番号を入力)`,
      '1'
    );

    if (!choice) return;

    if (!targetPage.blocks) targetPage.blocks = [];

    if (choice.trim() === '1') {
      const text = prompt('挿入するメモテキストを入力してください:', '挿入メモ...');
      if (!text) return;
      targetPage.blocks.splice(insertIndex, 0, { type: 'note', text: this.escapeHtml(text) });
    } else if (choice.trim() === '2') {
      const url = prompt('WebサイトURL:', 'https://');
      if (!url) return;
      const title = prompt('表示タイトル:', '関連リンク');
      targetPage.blocks.splice(insertIndex, 0, { type: 'link', url, title: title || url });
    } else if (choice.trim() === '3') {
      const text = prompt('タグ名を入力してください:', '重要メモ');
      if (!text) return;
      targetPage.blocks.splice(insertIndex, 0, { type: 'tag', tagType: 'boss', text });
    } else {
      return;
    }

    await this.saveCurrentPagesState();
    await this.renderNotebookView();
    this.showToast(`P.${pageIndex + 1} の指定位置に要素を差し込みました！`);
  }

  // Freeform Interactive Image Resizer Engine
  setupFreeformResizer(handleEl, targetWrapperEl, pageEl, pageIndex, blockIndex) {
    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = targetWrapperEl.getBoundingClientRect().width;

      const pageWidth = pageEl.getBoundingClientRect().width - 36;

      const onMouseMove = (moveEvt) => {
        const deltaX = moveEvt.clientX - startX;
        let newWidthPx = startWidth + deltaX;
        let pct = Math.min(100, Math.max(20, Math.round((newWidthPx / pageWidth) * 100)));

        targetWrapperEl.style.width = `${pct}%`;
      };

      const onMouseUp = async () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        const pctWidth = targetWrapperEl.style.width;
        if (pctWidth && this.pages[pageIndex] && this.pages[pageIndex].blocks[blockIndex]) {
          this.pages[pageIndex].blocks[blockIndex].customWidth = pctWidth;
          await this.saveCurrentPagesState();
          this.showToast(`📐 画像サイズを変更しました (${pctWidth})`);
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    handleEl.addEventListener('mousedown', onMouseDown);
  }

  // Resize Image Block Presets (Small, Medium, Large)
  async resizeImageBlock(pageIndex, blockIndex, sizeClass) {
    const page = this.pages[pageIndex];
    if (!page || page.isLocked) return;

    page.blocks[blockIndex].sizeClass = sizeClass;
    delete page.blocks[blockIndex].customWidth;
    await this.saveCurrentPagesState();
    await this.renderNotebookView();
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
      if (totalPgs >= 100) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計100P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大100ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

    const newPage = {
      id: 'p_' + Date.now(),
      notebookId: this.currentNotebookId,
      pageIndex: this.pages.length,
      bookmarkLabel: '',
      isLocked: false,
      blocks: []
    };
    this.pages.push(newPage);
    await storageEngine.savePages([newPage]);
    await this.syncPagesToCloud([newPage]);

    this.currentPageIndex = this.pages.length - 1;
    this.activeTargetPageIndex = this.currentPageIndex;
    await this.renderNotebookView();
    await this.updatePlanUI();
    this.showToast('末尾に新しいページを追加しました！');
  }

  // Insert New Blank Page Right After Active Target Page
  async insertPageAfterActive() {
    if (this.userPlan === 'free') {
      const totalPgs = await this.calculateTotalPagesAllNotebooks();
      if (totalPgs >= 100) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計100P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大100ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

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

    await storageEngine.savePages(this.pages);
    await this.syncPagesToCloud(this.pages);

    this.activeTargetPageIndex = insertIdx;
    this.currentPageIndex = insertIdx % 2 === 0 ? insertIdx : insertIdx - 1;

    await this.renderNotebookView();
    await this.updatePlanUI();
    this.showToast(`📥 P.${insertIdx} の直後に新規ページを挿入しました！`);
  }

  // Deep Clone / Duplicate Active Target Page
  async duplicateActivePage() {
    if (this.userPlan === 'free') {
      const totalPgs = await this.calculateTotalPagesAllNotebooks();
      if (totalPgs >= 100) {
        const titleEl = document.getElementById('limitModalTitle');
        const descEl = document.getElementById('limitModalDesc');
        if (titleEl) titleEl.innerText = '🔒 ページ作成上限（合計100P）に達しました';
        if (descEl) descEl.innerHTML = '無料プランではノート全冊の合計ページ数は<b>最大100ページ</b>までとなります。<br>有料プラン（月額200円）にご加入いただくと作成上限が<b>30冊まで拡大</b>されます！';
        this.openModal('modalCapacityLimit');
        return;
      }
    }

    const sourcePage = this.pages[this.activeTargetPageIndex];
    if (!sourcePage) return;

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

    await storageEngine.savePages(this.pages);
    await this.syncPagesToCloud(this.pages);

    this.activeTargetPageIndex = insertIdx;
    this.currentPageIndex = insertIdx % 2 === 0 ? insertIdx : insertIdx - 1;

    await this.renderNotebookView();
    await this.updatePlanUI();
    this.showToast(`📋 P.${this.activeTargetPageIndex} の複製（コピー）ページを挿入しました！`);
  }

  async deleteCurrentPage() {
    const pageToDelete = this.pages[this.activeTargetPageIndex];
    if (pageToDelete && pageToDelete.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (this.pages.length <= 1) {
      this.showToast('最後の1ページは削除できません');
      return;
    }

    if (!confirm(`ページ ${this.activeTargetPageIndex + 1} を削除しますか？`)) return;

    await storageEngine.deletePage(pageToDelete.id);
    await this.deletePageFromCloud(pageToDelete.id);

    this.pages.splice(this.activeTargetPageIndex, 1);
    this.pages.forEach((p, idx) => (p.pageIndex = idx));
    await storageEngine.savePages(this.pages);
    await this.syncPagesToCloud(this.pages);

    if (this.currentPageIndex >= this.pages.length) {
      this.currentPageIndex = Math.max(0, this.pages.length - 1);
    }
    this.activeTargetPageIndex = this.currentPageIndex;
    await this.renderNotebookView();
    await this.updatePlanUI();
    this.showToast('ページを削除しました');
  }

  async addTextBlock() {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const text = prompt(`P.${this.activeTargetPageIndex + 1} に追加するメモを入力してください:`, 'メモテキスト...');
    if (!text) return;

    if (!targetPage.blocks) targetPage.blocks = [];
    targetPage.blocks.push({ type: 'note', text: this.escapeHtml(text), alignClass: 'align-center' });
    await this.saveCurrentPagesState();
    await this.renderNotebookView();
  }

  async addLinkBlock() {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const url = prompt(`P.${this.activeTargetPageIndex + 1} に追加するWebサイトURL:`, 'https://');
    if (!url) return;
    const title = prompt('表示タイトル:', '関連リンク');

    if (!targetPage.blocks) targetPage.blocks = [];
    targetPage.blocks.push({ type: 'link', url, title: title || url, alignClass: 'align-center' });
    await this.saveCurrentPagesState();
    await this.renderNotebookView();
  }

  async addTagBlock(tagType = 'boss') {
    if (this.pages.length === 0) return;
    const targetPage = this.pages[this.activeTargetPageIndex] || this.pages[0];
    if (targetPage && targetPage.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    const text = prompt(`P.${this.activeTargetPageIndex + 1} のタグ名を入力してください:`, '重要メモ');
    if (!text) return;

    if (!targetPage.blocks) targetPage.blocks = [];
    targetPage.blocks.push({ type: 'tag', tagType, text, alignClass: 'align-center' });
    await this.saveCurrentPagesState();
    await this.renderNotebookView();
  }

  async deleteBlock(pageIndex, blockIndex) {
    const page = this.pages[pageIndex];
    if (page && page.isLocked) {
      this.showToast('⚠️ このページは編集ロックされています');
      return;
    }

    if (this.pages[pageIndex] && this.pages[pageIndex].blocks) {
      this.pages[pageIndex].blocks.splice(blockIndex, 1);
      await this.saveCurrentPagesState();
      await this.renderNotebookView();
    }
  }

  async saveCurrentPagesState() {
    await storageEngine.savePages(this.pages);
    await this.syncPagesToCloud(this.pages);
    await this.updatePlanUI();
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
            if (!targetPage.blocks) targetPage.blocks = [];
            targetPage.blocks.push({ type: 'link', url: pastedText, title: pastedText, alignClass: 'align-center' });
            await this.saveCurrentPagesState();
            await this.renderNotebookView();
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

  async processAndInsertImageToTargetPage(file, targetPageIndex) {
    this.showToast(`⚡ P.${targetPageIndex + 1} に画像を圧縮中...`);
    try {
      const compressedBlob = await storageEngine.compressImage(file);
      const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      await storageEngine.saveImage(imageId, compressedBlob);
      await this.syncImageToCloud(imageId, compressedBlob);

      const targetPage = this.pages[targetPageIndex] || this.pages[0];
      if (!targetPage.blocks) targetPage.blocks = [];
      targetPage.blocks.push({ type: 'image', imageId, sizeClass: 'size-large', alignClass: 'align-center' });
      await this.saveCurrentPagesState();
      await this.renderNotebookView();

      const origKb = Math.round(file.size / 1024);
      const compKb = Math.round(compressedBlob.size / 1024);
      this.showToast(`✨ P.${targetPageIndex + 1} に画像貼付完了 (${origKb}KB → ${compKb}KB)`);
    } catch (err) {
      console.error('Image compression failed:', err);
      this.showToast('画像の処理に失敗しました');
    }
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.contentEditable === 'true') {
        return;
      }

      if (this.kbdConfig.pageTurnArrows) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.nextPage();
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.prevPage();
          return;
        }
      }

      if (this.kbdConfig.pageTurnPgKeys) {
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

      if (this.kbdConfig.search && e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        this.openModal('modalSearch');
        return;
      }
    });
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

    // Window Resize Event for Responsive Device Detection
    window.addEventListener('resize', () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.detectAndApplyDeviceLayout(), 150);
    });

    bindClick('btnGoogleAuth', () => this.handleGoogleAuth());
    bindClick('btnLiveStream', () => this.openModal('modalLiveStream'));
    bindClick('btnStartHostRoom', () => this.startLiveStreamHost());
    bindClick('btnStopHostRoom', () => this.stopLiveStreamHost());
    bindClick('btnCopyRoomCode', () => this.copyRoomCodeToClipboard());
    bindClick('hostRoomCodeDisplay', () => this.copyRoomCodeToClipboard());
    bindClick('btnJoinViewerRoom', () => this.joinLiveStreamViewer());
    bindClick('btnLeaveViewerRoom', () => this.leaveLiveStreamViewer());
    bindClick('btnPlanSimulator', () => this.openModal('modalCapacityLimit'));
    bindClick('btnUpgradeToPaidSim', () => {
      alert('月額100円サブスクプランのご契約ページへ案内します。\n（ご契約完了後に全広告が非表示となり、ノート作成数が30冊に拡大されます）');
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
    bindClick('btnAddText', () => this.addTextBlock());
    bindClick('btnAddLink', () => this.addLinkBlock());
    bindClick('btnAddDraw', () => this.openModal('modalDraw'));
    bindClick('btnAddTagBoss', () => this.addTagBlock('boss'));

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
      const icon = document.getElementById('iconMode');
      if (icon) icon.className = this.viewMode === 'double' ? 'fa-solid fa-book-open' : 'fa-solid fa-file';
      this.renderNotebookView();
      this.showToast(`表示モード: ${this.viewMode === 'double' ? '見開き' : '単一ページ'}`);
    });

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
          this.importNotebookFile(e.target.files[0]);
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

  // Handle Importing .strategy File & Prompt Choice Modal
  async importNotebookFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.pages || data.pages.length === 0) {
        alert('無効または空の STRATEGYNOTE ファイルです。');
        return;
      }

      this.pendingImportData = data;

      const fileTitleEl = document.getElementById('importChoiceFileTitle');
      const pageCountEl = document.getElementById('importChoicePageCount');
      const btnInsert = document.getElementById('btnImportInsertIntoActive');

      const nbTitle = data.notebook ? data.notebook.title : '共有データ';
      if (fileTitleEl) fileTitleEl.innerText = `共有ファイル 「${this.escapeHtml(nbTitle)}」 を受け取りました`;
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
      alert('ファイルの読み込みに失敗しました。');
    }
  }

  // Import Target Choice 1: Save as New Standalone Notebook
  async importAsNewNotebook() {
    if (!this.pendingImportData) return;
    const data = this.pendingImportData;

    try {
      if (data.images) {
        for (const imgObj of data.images) {
          const blob = await this.base64ToBlob(imgObj.base64);
          await storageEngine.saveImage(imgObj.id, blob);
          await this.syncImageToCloud(imgObj.id, blob);
        }
      }

      const origTitle = data.notebook ? data.notebook.title : '新規共有ノート';
      const newNb = {
        id: 'nb_' + Date.now(),
        title: `${origTitle} (共有)`,
        icon: 'fa-book',
        createdAt: Date.now()
      };

      const reindexedPages = data.pages.map((p, idx) => ({
        ...p,
        id: 'p_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 5),
        notebookId: newNb.id,
        pageIndex: idx
      }));

      await storageEngine.saveNotebook(newNb);
      await storageEngine.savePages(reindexedPages);

      await this.syncNotebookToCloud(newNb);
      await this.syncPagesToCloud(reindexedPages);

      await this.loadNotebooks();
      await this.switchNotebook(newNb.id);
      this.closeModal('modalImportChoice');
      this.pendingImportData = null;
      this.showToast(`📖 新しいノート 「${newNb.title}」 として保存しました！`);
    } catch (err) {
      console.error('Import as new notebook error:', err);
      alert('ノートの取り込みに失敗しました。');
    }
  }

  // Import Target Choice 2: Insert Pages into Currently Active Notebook at Active Page Target
  async importInsertIntoActiveNotebook() {
    if (!this.pendingImportData) return;
    const data = this.pendingImportData;

    try {
      if (data.images) {
        for (const imgObj of data.images) {
          const blob = await this.base64ToBlob(imgObj.base64);
          await storageEngine.saveImage(imgObj.id, blob);
          await this.syncImageToCloud(imgObj.id, blob);
        }
      }

      const insertIdx = this.activeTargetPageIndex + 1;
      const targetNbId = this.currentNotebookId;

      const clonedPages = data.pages.map((p, idx) => ({
        ...p,
        id: 'p_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substring(2, 5),
        notebookId: targetNbId
      }));

      this.pages.splice(insertIdx, 0, ...clonedPages);
      this.pages.forEach((p, idx) => (p.pageIndex = idx));

      await storageEngine.savePages(this.pages);
      await this.syncPagesToCloud(this.pages);

      this.activeTargetPageIndex = insertIdx;
      this.currentPageIndex = insertIdx % 2 === 0 ? insertIdx : insertIdx - 1;

      await this.renderNotebookView();
      await this.updatePlanUI();
      this.closeModal('modalImportChoice');
      this.pendingImportData = null;
      this.showToast(`📥 P.${insertIdx} の直後に ${clonedPages.length} ページを取り込んで挿入しました！`);
    } catch (err) {
      console.error('Import insert pages error:', err);
      alert('ページの挿入に失敗しました。');
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

  base64ToBlob(base64) {
    return fetch(base64).then((r) => r.blob());
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new StrategyApp();
});
