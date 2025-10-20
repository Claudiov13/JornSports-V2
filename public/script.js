// Aguarda o documento carregar para adicionar os listeners
document.addEventListener('DOMContentLoaded', () => {
  // --- MAPEAMENTO DE ELEMENTOS ---
  const elements = {
    analisarBtn: document.getElementById('analisarBtn'),
    resultsDiv: document.getElementById('results'),
    resultsContent: document.getElementById('results-content'),
    loadingDiv: document.getElementById('loading'),
    reportTitle: document.getElementById('report-title'),
    iaAnalysisDiv: document.getElementById('ia-analysis'),
    playerComparisonDiv: document.getElementById('player-comparison'),
    trainingPlanDiv: document.getElementById('training-plan'),
    errorContainer: document.getElementById('error-container'),
    errorList: document.getElementById('error-list'),
    viewReportsBtn: document.getElementById('view-reports-btn'),
    reportsModal: document.getElementById('reports-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    reportsListContainer: document.getElementById('reports-list-container'),
    idadeInput: document.getElementById('idade'),
    playerAvatar: document.getElementById('player-avatar'), // so funciona se existir no HTML
    posicaoSelect: document.getElementById('posicao_atual'),
    heatmaps: document.querySelectorAll('#tactical-map .heatmap'),
    evalSummary: document.getElementById('eval-summary-content'),
    evalPositions: document.getElementById('eval-positions-content'),
    formContainer: document.getElementById('form-container'),
    protectedContent: document.getElementById('protected-content'),
    loginForm: document.getElementById('login-form'),
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    logoutBtn: document.getElementById('logout-btn'),
    authStatus: document.getElementById('auth-status'),
    viewTabs: document.querySelectorAll('.view-tab-button'),
    viewSections: document.querySelectorAll('[data-view-section]'),
    manualForm: document.getElementById('manual-player-form'),
    manualFirstName: document.getElementById('manual-first-name'),
    manualLastName: document.getElementById('manual-last-name'),
    manualClubName: document.getElementById('manual-club-name'),
    manualClubCode: document.getElementById('manual-club-code'),
    manualCoachName: document.getElementById('manual-coach-name'),
    manualCoachCode: document.getElementById('manual-coach-code'),
    manualFeedback: document.getElementById('manual-player-feedback'),
    manualIdPreview: document.getElementById('manual-player-id-preview'),
    manualMessage: document.getElementById('manual-player-message'),

    // === NOVOS ELEMENTOS (Upload + Alertas) ===
    csvFile: document.getElementById('csv-file'),
    uploadCsvBtn: document.getElementById('upload-csv-btn'),
    uploadStatus: document.getElementById('upload-status'),
    generateAlertsBtn: document.getElementById('generate-alerts-btn'),
    alertsContainer: document.getElementById('alerts-container'),
    refreshAlertsBtn: document.getElementById('refresh-alerts'),

    // === ATLETAS (lista + detalhe) ===
    playersSection: document.getElementById('players-section'),
    playersSearch: document.getElementById('players-search'),
    playersRefresh: document.getElementById('players-refresh'),
    playersTable: document.getElementById('players-table'),
    playersClubFilter: document.getElementById('players-club-filter'),
    playersCoachFilter: document.getElementById('players-coach-filter'),

    playerDetailModal: document.getElementById('player-detail-modal'),
    closePlayerModal: document.getElementById('close-player-modal'),
    playerDetailInitials: document.getElementById('player-detail-initials'),
    playerDetailName: document.getElementById('player-detail-name'),
    playerDetailMeta: document.getElementById('player-detail-meta'),
    playerDetailUnread: document.getElementById('player-detail-unread'),
    playerAlerts: document.getElementById('player-alerts'),
    playerReports: document.getElementById('player-reports'),
    metricFilter: document.getElementById('metric-filter'),
    measurementsTable: document.getElementById('measurements-table'),
    alertsPlayerSelector: document.getElementById('alerts-player-selector'),
  };

  const API_BASE_URL = 'http://127.0.0.1:8000';
  const TOKEN_STORAGE_KEY = 'jornAuthToken';
  const TOKEN_EXPIRY_KEY = 'jornAuthTokenExpiry';
  let currentUserEmail = '';
  let currentView = 'manual';
  let manualClubCodeDirty = false;
  let manualCoachCodeDirty = false;
  let cachedPlayers = [];
  let cachedPlayersMode = 'api';
  let cachedAlerts = [];

  // feature flags detectadas no backend
  const backendFeatures = {
    players: false,         // /api/players
    playerAlerts: false,    // /api/players/{id}/alerts
    playerReports: false,   // /api/players/{id}/reports
    playerMeasurements: false // /api/players/{id}/measurements
  };

  function clearAuthData() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    currentUserEmail = '';
  }

  function storeToken(token, expiresIn) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) {
      const expiresAt = Date.now() + expiresIn * 1000;
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
    } else {
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
  }

  function getStoredToken() {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      return null;
    }
    const rawExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (rawExpiry) {
      const expiresAt = Number(rawExpiry);
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
        clearAuthData();
        return null;
      }
    }
    return token;
  }

  function setAuthStatus(message, isError = false) {
    if (!elements.authStatus) {
      return;
    }
    const el = elements.authStatus;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      el.classList.remove('text-red-400', 'text-green-400');
      return;
    }
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('text-red-400', Boolean(isError));
    el.classList.toggle('text-green-400', !isError);
  }

  function switchView(view) {
    currentView = view || 'manual';
    const sections = Array.from(elements.viewSections || []);
    const buttons = Array.from(elements.viewTabs || []);
    sections.forEach(section => {
      const target = section.getAttribute('data-view-section');
      section.classList.toggle('hidden', target !== currentView);
    });
    buttons.forEach(btn => {
      const target = btn.getAttribute('data-view-target');
      btn.classList.toggle('active', target === currentView);
    });
  }

  function updateAuthUI() {
    const token = getStoredToken();
    const loggedIn = Boolean(token);
    if (elements.loginForm) {
      elements.loginForm.classList.toggle('hidden', loggedIn);
    }
    if (elements.logoutBtn) {
      elements.logoutBtn.classList.toggle('hidden', !loggedIn);
    }
    if (elements.protectedContent) {
      elements.protectedContent.classList.toggle('hidden', !loggedIn);
    }
    if (elements.analisarBtn) {
      elements.analisarBtn.disabled = !loggedIn;
      elements.analisarBtn.classList.toggle('opacity-50', !loggedIn);
      elements.analisarBtn.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    if (elements.viewReportsBtn) {
      elements.viewReportsBtn.disabled = !loggedIn;
      elements.viewReportsBtn.classList.toggle('opacity-50', !loggedIn);
      elements.viewReportsBtn.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    // novos botÃµes
    if (elements.uploadCsvBtn) {
      elements.uploadCsvBtn.disabled = !loggedIn;
      elements.uploadCsvBtn.classList.toggle('opacity-50', !loggedIn);
      elements.uploadCsvBtn.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    if (elements.generateAlertsBtn) {
      elements.generateAlertsBtn.disabled = !loggedIn;
      elements.generateAlertsBtn.classList.toggle('opacity-50', !loggedIn);
      elements.generateAlertsBtn.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    if (elements.refreshAlertsBtn) {
      elements.refreshAlertsBtn.disabled = !loggedIn;
      elements.refreshAlertsBtn.classList.toggle('opacity-50', !loggedIn);
      elements.refreshAlertsBtn.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    if (elements.playersRefresh) {
      elements.playersRefresh.disabled = !loggedIn;
      elements.playersRefresh.classList.toggle('opacity-50', !loggedIn);
      elements.playersRefresh.classList.toggle('cursor-not-allowed', !loggedIn);
    }
    if (loggedIn) {
      switchView(currentView || 'manual');
    }
  }

  function sanitizeCode(value) {
    return (value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  }

  function suggestCodeFromName(value, fallback) {
    const cleaned = sanitizeCode(value).slice(0, 3);
    if (cleaned.length === 3) {
      return cleaned;
    }
    const filler = (fallback || 'AAA');
    return (cleaned + filler).slice(0, 3);
  }

  function updateManualPreview() {
    const first = (elements.manualFirstName?.value || '').trim();
    const last = (elements.manualLastName?.value || '').trim();
    const clubName = (elements.manualClubName?.value || '').trim();
    const coachName = (elements.manualCoachName?.value || '').trim();

    let clubCodeInput = elements.manualClubCode ? elements.manualClubCode.value : '';
    if (!manualClubCodeDirty) {
      clubCodeInput = suggestCodeFromName(clubName, 'CLB');
      if (elements.manualClubCode) {
        elements.manualClubCode.value = clubCodeInput;
      }
    } else {
      clubCodeInput = sanitizeCode(clubCodeInput);
      if (elements.manualClubCode) {
        elements.manualClubCode.value = clubCodeInput;
      }
    }
    const clubCode = sanitizeCode(clubCodeInput).slice(0, 6);

    let coachCodeInput = elements.manualCoachCode ? elements.manualCoachCode.value : '';
    if (!manualCoachCodeDirty) {
      coachCodeInput = suggestCodeFromName(coachName, 'TEC');
      if (elements.manualCoachCode) {
        elements.manualCoachCode.value = coachCodeInput;
      }
    } else {
      coachCodeInput = sanitizeCode(coachCodeInput);
      if (elements.manualCoachCode) {
        elements.manualCoachCode.value = coachCodeInput;
      }
    }
    const coachCode = sanitizeCode(coachCodeInput).slice(0, 6);

    if (elements.manualFeedback) {
      elements.manualFeedback.classList.add('hidden');
    }
    if (elements.manualMessage) {
      elements.manualMessage.textContent = '';
      elements.manualMessage.classList.remove('text-green-300', 'text-red-300');
    }

    if (elements.manualIdPreview) {
      if (clubCode && coachCode) {
        elements.manualIdPreview.textContent = `${clubCode}${coachCode}###`;
      } else {
        elements.manualIdPreview.textContent = '---';
      }
    }
    return { first, last, clubCode, coachCode, clubName, coachName };
  }

  async function submitManualPlayer(event) {
    if (event) event.preventDefault();
    if (!ensureAuthenticated()) return;
    const snapshot = updateManualPreview();
    const first = (snapshot.first || '').trim();
    const last = (snapshot.last || '').trim();
    const clubName = (snapshot.clubName || '').trim();
    const coachName = (snapshot.coachName || '').trim();
    const clubCode = sanitizeCode(snapshot.clubCode || '');
    const coachCode = sanitizeCode(snapshot.coachCode || '');

    if (!first || !clubName || !coachName) {
      if (elements.manualMessage) {
        elements.manualMessage.textContent = 'Informe o nome do atleta, do clube e do técnico.';
        elements.manualMessage.classList.remove('text-green-300');
        elements.manualMessage.classList.add('text-red-300');
      }
      if (elements.manualFeedback) {
        elements.manualFeedback.classList.remove('hidden');
      }
      return;
    }

    try {
      const payload = {
        first_name: first,
        last_name: last || null,
        club_name: clubName,
        club_code: clubCode,
        coach_name: coachName,
        coach_code: coachCode,
      };
      const response = await authorizedFetch(`${API_BASE_URL}/api/players/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let message = 'Não foi possível registrar o atleta.';
        try {
          const detail = await response.json();
          if (detail && detail.detail) message = detail.detail;
        } catch {
          try {
            const textMsg = await response.text();
            if (textMsg) message = textMsg;
          } catch { /* noop */ }
        }
        if (elements.manualMessage) {
          elements.manualMessage.textContent = message;
          elements.manualMessage.classList.remove('text-green-300');
          elements.manualMessage.classList.add('text-red-300');
        }
        if (elements.manualFeedback) elements.manualFeedback.classList.remove('hidden');
        return;
      }

      const data = await response.json();
      if (elements.manualIdPreview) {
        elements.manualIdPreview.textContent = data.player_code || '---';
      }
      if (elements.manualMessage) {
        const infoParts = [];
        if (data.club_name || data.club_code) infoParts.push(`Clube ${data.club_name || data.club_code}`);
        if (data.coach_name || data.coach_code) infoParts.push(`Técnico ${data.coach_name || data.coach_code}`);
        elements.manualMessage.textContent = `ID ${data.player_code || ''} gerado com sucesso${infoParts.length ? ' • ' + infoParts.join(' • ') : ''}.`;
        elements.manualMessage.classList.remove('text-red-300');
        elements.manualMessage.classList.add('text-green-300');
      }
      if (elements.manualFeedback) elements.manualFeedback.classList.remove('hidden');
      manualClubCodeDirty = true;
      manualCoachCodeDirty = true;
      await loadPlayers();
      populateAlertsSelector(cachedPlayers);
    } catch (error) {
      console.error(error);
      if (elements.manualMessage) {
        elements.manualMessage.textContent = 'Erro inesperado ao gerar ID.';
        elements.manualMessage.classList.remove('text-green-300');
        elements.manualMessage.classList.add('text-red-300');
      }
      if (elements.manualFeedback) elements.manualFeedback.classList.remove('hidden');
    }
  }

  function handleUnauthorized(message = 'Sessao expirada. Faca login novamente.') {
    clearAuthData();
    updateAuthUI();
    setAuthStatus(message, true);
    if (elements.loginEmail) {
      elements.loginEmail.focus();
    }
  }

  function ensureAuthenticated() {
    const token = getStoredToken();
    if (!token) {
      handleUnauthorized('Faca login para continuar.');
      return false;
    }
    return true;
  }

  async function authorizedFetch(url, options = {}) {
    const token = getStoredToken();
    if (!token) {
      handleUnauthorized('Faca login para continuar.');
      throw new Error('NOT_AUTHENTICATED');
    }
    const finalOptions = { ...options };
    const headers = new Headers(finalOptions.headers || {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);
    finalOptions.headers = headers;
    const response = await fetch(url, finalOptions);
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('Unauthorized');
    }
    return response;
  }

  async function loadCurrentUser() {
    try {
      const response = await authorizedFetch(`${API_BASE_URL}/api/me`);
      if (!response.ok) {
        throw new Error('Falha ao consultar dados do usuario.');
      }
      const data = await response.json();
      currentUserEmail = data.email || '';
      setAuthStatus(`Autenticado como ${currentUserEmail}`, false);
    } catch (error) {
      if (error.message === 'NOT_AUTHENTICATED') {
        return;
      }
      console.error('Erro ao carregar usuario atual:', error);
      handleUnauthorized();
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    if (!elements.loginEmail || !elements.loginPassword) {
      return;
    }
    const email = elements.loginEmail.value.trim();
    const password = elements.loginPassword.value;
    if (!email || !password) {
      setAuthStatus('Informe email e senha.', true);
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        let message = 'Não foi possível autenticar.';
        try {
          const detail = await response.json();
          if (detail && detail.detail) {
            message = detail.detail;
          }
        } catch (readError) { /* ignore */ }
        setAuthStatus(message, true);
        return;
      }
      const data = await response.json();
      storeToken(data.access_token, data.expires_in);
      elements.loginPassword.value = '';
      updateAuthUI();
      await loadCurrentUser();
      // bootstrap pÃ³s-login
      await afterAuthAlertsBootstrap();
      await detectBackendFeatures();
      await loadPlayers();
    } catch (error) {
      console.error('Erro de rede ao autenticar:', error);
      setAuthStatus('Erro de rede ao autenticar.', true);
    }
  }

  function logout() {
    clearAuthData();
    currentView = 'manual';
    updateAuthUI();
    switchView('manual');
    setAuthStatus('Sessao encerrada.', false);
    // limpa painÃ©is
    if (elements.alertsContainer) elements.alertsContainer.innerHTML = '';
    if (elements.alertsPlayerSelector) elements.alertsPlayerSelector.innerHTML = '<option value="">Todos os atletas</option>';
    if (elements.uploadStatus) elements.uploadStatus.textContent = '';
    if (elements.playersTable) elements.playersTable.innerHTML = '';
  }

  function initializeAuth() {
    updateAuthUI();
    const token = getStoredToken();
    if (token) {
      loadCurrentUser().then(async () => {
        await afterAuthAlertsBootstrap();
        await detectBackendFeatures();
        await loadPlayers();
      });
    } else {
      setAuthStatus('', false);
    }
  }

  // --- Sanitizador de HTML (defesa contra XSS) ---
  function safeHtml(html) {
    return DOMPurify.sanitize(String(html || ""));
  }

  // Acessibilidade: permite dar foco programatico no container de erro
  if (elements.errorContainer) {
    elements.errorContainer.setAttribute('tabindex', '-1');
  }

  // Marca campos "tocados" ao sair do foco (util para estilos :invalid + classe)
  const blurScope = elements.formContainer || document;
  blurScope.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('blur', () => el.classList.add('user-touched'));
  });

  let skillChart = null; // Variavel para armazenar a instancia do grafico
  let metricChartInstance = null; // grafico do modal de atleta

  // --- EVENT LISTENERS ---
  if (elements.analisarBtn) elements.analisarBtn.addEventListener('click', analisarPerfil);
  if (elements.viewReportsBtn) elements.viewReportsBtn.addEventListener('click', showReportsModal);
  if (elements.closeModalBtn) elements.closeModalBtn.addEventListener('click', () => elements.reportsModal.classList.add('hidden'));

  if (elements.loginForm) {
    elements.loginForm.addEventListener('submit', handleLogin);
  }

  if (elements.logoutBtn) {
    elements.logoutBtn.addEventListener('click', event => {
      event.preventDefault();
      logout();
    });
  }

  Array.from(elements.viewTabs || []).forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view-target') || 'manual';
      switchView(target);
    });
  });
  switchView(currentView);

  if (elements.manualForm) {
    elements.manualForm.addEventListener('submit', submitManualPlayer);
  }
  if (elements.manualFirstName) elements.manualFirstName.addEventListener('input', updateManualPreview);
  if (elements.manualLastName) elements.manualLastName.addEventListener('input', updateManualPreview);
  if (elements.manualClubName) {
    elements.manualClubName.addEventListener('input', () => {
      if (!manualClubCodeDirty || !(elements.manualClubCode?.value || '').trim()) {
        manualClubCodeDirty = false;
      }
      updateManualPreview();
    });
  }
  if (elements.manualCoachName) {
    elements.manualCoachName.addEventListener('input', () => {
      if (!manualCoachCodeDirty || !(elements.manualCoachCode?.value || '').trim()) {
        manualCoachCodeDirty = false;
      }
      updateManualPreview();
    });
  }
  if (elements.manualClubCode) {
    elements.manualClubCode.addEventListener('input', () => {
      const value = sanitizeCode(elements.manualClubCode.value || '');
      elements.manualClubCode.value = value;
      manualClubCodeDirty = value.trim().length > 0;
      updateManualPreview();
    });
  }
  if (elements.manualCoachCode) {
    elements.manualCoachCode.addEventListener('input', () => {
      const value = sanitizeCode(elements.manualCoachCode.value || '');
      elements.manualCoachCode.value = value;
      manualCoachCodeDirty = value.trim().length > 0;
      updateManualPreview();
    });
  }  updateManualPreview();

  // === NOVOS LISTENERS: Upload e Alertas ===
  if (elements.uploadCsvBtn) {
    elements.uploadCsvBtn.addEventListener('click', uploadCsv);
  }
  if (elements.generateAlertsBtn) {
    elements.generateAlertsBtn.addEventListener('click', generateAlerts);
  }
  if (elements.refreshAlertsBtn) {
    elements.refreshAlertsBtn.addEventListener('click', loadAlerts);
  }

  // === LISTENERS: ATLETAS ===
  if (elements.playersRefresh) {
    elements.playersRefresh.addEventListener('click', async () => {
      await loadPlayers();
    });
  }
  if (elements.playersSearch) {
    elements.playersSearch.addEventListener('input', () => filterPlayersClient());
  }
  if (elements.closePlayerModal) {
    elements.closePlayerModal.addEventListener('click', () => closePlayerDetail());
  }

  initializeAuth();

  let rafId = 0;
  document.querySelectorAll('.skill-slider').forEach(slider => {
    const valueSpan = document.getElementById(`${slider.id}_value`);
    if (!valueSpan) return;

    valueSpan.textContent = slider.value;

    slider.addEventListener('input', () => {
      valueSpan.textContent = slider.value;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        renderSkillChart(); // le direto do DOM
      });
    });
  });

  // --- FUNCOES DE VALIDACAO E LOGICA PRINCIPAL ---
  function validateForm() {
    const errors = [];
    if (!elements.errorList) return true;

    elements.errorList.innerHTML = '';

    const requiredFields = elements.formContainer ? elements.formContainer.querySelectorAll('[required]') : document.querySelectorAll('[required]');
    requiredFields.forEach(field => {
      if (!String(field.value || '').trim()) {
        errors.push(`O campo "${field.name}" e obrigatorio.`);
      }
    });

    const nomeField = document.getElementById('nome');
    if (nomeField && nomeField.value && !/^[a-zA-Z\s]+$/.test(nomeField.value)) {
      errors.push('O campo "Nome" deve conter apenas letras e espacos.');
    }
    
    const sobrenomeField = document.getElementById('sobrenome');
    if (sobrenomeField && sobrenomeField.value && !/^[a-zA-Z\s]+$/.test(sobrenomeField.value)) {
      errors.push('O campo "Sobrenome" deve conter apenas letras e espacos.');
    }

    if (errors.length > 0) {
      errors.forEach(error => {
        const li = document.createElement('li');
        li.textContent = error;
        elements.errorList.appendChild(li);
      });
      elements.errorContainer.classList.remove('hidden');
      elements.errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      requestAnimationFrame(() => elements.errorContainer && elements.errorContainer.focus({ preventScroll: true }));
      return false;
    }

    elements.errorContainer.classList.add('hidden');
    return true;
  }

  async function analisarPerfil() {
    if (!ensureAuthenticated()) return;
    if (!validateForm()) return;

    const dadosAtleta = getFormData();
    showLoadingState();

    try {
      const analysis = await getGeminiAnalysis(dadosAtleta);
      displayAnalysis(dadosAtleta, analysis);
      saveReport(dadosAtleta, analysis);
    } catch (error) {
      console.error("Erro ao chamar a API do Gemini:", error);
      displayError(error);
    }
  }

  // --- FUNCOES DE MANIPULACAO DO DOM E DADOS ---
  function getFormData() {
    const data = {};
    
    const integerFields = [
      'idade', 'altura', 'envergadura', 'salto_vertical', 'controle_bola', 
      'drible', 'passe_curto', 'passe_longo', 'finalizacao', 'cabeceio', 
      'desarme', 'visao_jogo', 'compostura', 'agressividade'
    ];
    const floatFields = ['peso', 'percentual_gordura', 'velocidade_sprint', 'agilidade'];

    const fieldSource = elements.formContainer ? elements.formContainer : document;
    fieldSource.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return;

      let value = (el.value || '').trim();

      if (integerFields.includes(el.id)) {
        data[el.id] = value ? parseInt(value, 10) : null;
      } else if (floatFields.includes(el.id)) {
        value = value.replace(',', '.');
        data[el.id] = value ? parseFloat(value) : null;
      } else {
        data[el.id] = value;
      }
    });
    return data;
  }

  function showLoadingState() {
    elements.resultsDiv.classList.remove('hidden');
    elements.loadingDiv.classList.remove('hidden');
    elements.resultsContent.classList.add('hidden');
    elements.resultsDiv.scrollIntoView({ behavior: 'smooth' });
  }

  function displayAnalysis(dadosAtleta, analysis) {
    const nomeCompleto = `${dadosAtleta.nome} ${dadosAtleta.sobrenome}`;
    elements.reportTitle.innerText = `Relatório de Análise para ${nomeCompleto.toUpperCase()}`;
    elements.iaAnalysisDiv.innerHTML = safeHtml(analysis.relatorio);
    elements.playerComparisonDiv.innerHTML = safeHtml(analysis.comparacao);
    elements.trainingPlanDiv.innerHTML = safeHtml(analysis.plano_treino);

    elements.loadingDiv.classList.add('hidden');
    elements.resultsContent.classList.remove('hidden');
    populateSkillsFromData(dadosAtleta);

    requestAnimationFrame(() => {
      renderSkillChart(dadosAtleta);
      if (analysis.evaluation) {
        renderEvaluation(analysis.evaluation);
      }
    });
  }

  function displayError(error) {
    elements.loadingDiv.classList.add('hidden');
    elements.resultsContent.classList.remove('hidden');
    elements.reportTitle.innerText = 'Erro na Análise';

    let errorMessage = error.message || String(error);
    if (errorMessage.includes('Corpo:')) {
      try {
        const jsonPart = errorMessage.substring(errorMessage.indexOf('{'));
        const errorObj = JSON.parse(jsonPart);
        errorMessage = `<pre class="text-left text-sm whitespace-pre-wrap">${JSON.stringify(errorObj, null, 2)}</pre>`;
      } catch (e) {
        errorMessage = `<p class="text-red-400">${safeHtml(errorMessage)}</p>`;
      }
    } else {
      errorMessage = `<p class="text-red-400">${safeHtml(errorMessage)}</p>`;
    }

    elements.iaAnalysisDiv.innerHTML = `
      <p class="text-red-400 font-bold mb-2">Não foi possível gerar a análise. Detalhes:</p>
      ${errorMessage}
    `;
    
    elements.playerComparisonDiv.innerHTML = '';
    elements.trainingPlanDiv.innerHTML = '';
    if (skillChart) skillChart.destroy();
  }

  // Campos de habilidades usados no grafico
  const SKILL_FIELDS = [
    'controle_bola','drible','passe_curto','passe_longo','finalizacao',
    'cabeceio','desarme','visao_jogo','compostura','agressividade'
  ];

  function populateSkillsFromData(src) {
    if (!src) return;
    SKILL_FIELDS.forEach(id => {
      const val = Number(src[id]);
      if (!Number.isFinite(val)) return;
      const input = document.getElementById(id);
      const span  = document.getElementById(`${id}_value`);
      if (input) input.value = val;
      if (span)  span.textContent = String(val);
    });
  }

  function readSkillsFromDOM() {
    const ids = [
      'controle_bola','drible','passe_curto','passe_longo','finalizacao',
      'cabeceio','desarme','visao_jogo','compostura','agressividade'
    ];
    const skills = {};
    ids.forEach(id => {
      const el = document.getElementById(id);
      skills[id] = el ? Number(el.value) : 0;
    });
    return skills;
  }

  function renderSkillChart(dadosAtleta) {
    const ctx = document.getElementById('skillChart').getContext('2d');

    const campos = [
      'controle_bola','drible','passe_curto','passe_longo','finalizacao',
      'cabeceio','desarme','visao_jogo','compostura','agressividade'
    ];

    const labels = [
      'Controle de Bola','Drible','Passe Curto','Passe Longo','Finalizacao',
      'Cabeceio','Desarme','Visao de Jogo','Compostura','Agressividade'
    ];

    const source = dadosAtleta || readSkillsFromDOM();
    const n = id => {
      const v = Number(source[id]);
      return Number.isFinite(v) ? v : 0;
    };
    const data = campos.map(n);

    if (skillChart) skillChart.destroy();

    skillChart = new Chart(ctx, {
      type: 'radar',
      data: {
        labels,
        datasets: [{
          label: 'Habilidades Tecnicas',
          data,
          fill: true,
          backgroundColor: 'rgba(249, 115, 22, 0.2)',
          borderColor: 'rgba(249, 115, 22, 1)',
          tension: 0.1,
          borderWidth: 2,
          pointBackgroundColor: 'rgba(249, 115, 22, 1)',
          pointBorderColor: '#fff',
          pointHoverBackgroundColor: '#fff',
          pointHoverBorderColor: 'rgba(249, 115, 22, 1)',
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 60, bottom: 60 } },
        scales: {
          r: {
            min: 0,
            max: 10,
            ticks: {
              stepSize: 1,
              showLabelBackdrop: false,
              backdropColor: 'rgba(0,0,0,0)'
            },
            grid: { color: 'rgba(229,231,235,0.15)' },
            angleLines: { color: 'rgba(229,231,235,0.15)' },
            pointLabels: { color: '#e5e7eb', font: { size: 12 } }
          }
        },
      }
    });
  }

  // --- LÓGICA DE SALVAR E CARREGAR RELATÓRIOS ---
  async function saveReport(dadosAtleta, analysis) {
    if (!ensureAuthenticated()) {
      return;
    }
    const nomeCompleto = `${dadosAtleta.nome} ${dadosAtleta.sobrenome}`;
    const reportData = {
      athleteName: nomeCompleto,
      dados: dadosAtleta,
      analysis: analysis
    };

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/api/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
      });

      if (!response.ok) {
        throw new Error('Falha ao salvar relatório.');
      }
    } catch (error) {
      console.error('Erro ao salvar relatório:', error);
      setAuthStatus('Não foi possível salvar o relatório.', true);
    }
  }

  async function showReportsModal() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/api/reports`);
      if (!response.ok) {
        throw new Error('Falha ao carregar relatórios.');
      }
      const reports = await response.json();
      elements.reportsListContainer.innerHTML = '';

      if (reports.length === 0) {
        elements.reportsListContainer.innerHTML = '<p class="text-gray-400 text-center">Nenhum relatório salvo ainda.</p>';
      } else {
        const list = document.createElement('ul');
        list.className = 'space-y-3';
        reports.forEach(report => {
          const listItem = document.createElement('li');
          listItem.className = 'bg-gray-700 p-4 rounded-lg flex justify-between items-center';
          listItem.innerHTML = `
            <div class="cursor-pointer flex-grow report-item-view">
              <p class="font-bold text-white">${safeHtml(report.athlete_name)}</p>
              <p class="text-sm text-gray-400">Análise de ${new Date(report.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
            </div>
            <button class="delete-report-btn text-red-500 hover:text-red-400 font-bold text-2xl" data-report-id="${report.id}" title="Excluir">
              &#215;
            </button>
          `;

          listItem.querySelector('.report-item-view').addEventListener('click', () => {
            displayAnalysis(report.dados_atleta, report.analysis);
            elements.resultsDiv.classList.remove('hidden');
            elements.resultsDiv.scrollIntoView({ behavior: 'smooth' });
            elements.reportsModal.classList.add('hidden');
          });

          listItem.querySelector('.delete-report-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            deleteReport(report.id);
          });

          list.appendChild(listItem);
        });
        elements.reportsListContainer.appendChild(list);
      }

      elements.reportsModal.classList.remove('hidden');
    } catch (error) {
      console.error('Erro ao carregar relatórios:', error);
      setAuthStatus('Não foi possível carregar os relatórios.', true);
    }
  }

  async function deleteReport(reportId) {
    if (!ensureAuthenticated()) {
      return;
    }

    if (confirm('Tem certeza de que deseja excluir este relatório?')) {
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/api/reports/${reportId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          throw new Error('Falha ao excluir relatório.');
        }

        showReportsModal();
      } catch (error) {
        console.error('Erro ao excluir relatório:', error);
        setAuthStatus('Erro ao excluir o relatório.', true);
      }
    }
  }

  // --- CHAMADA A API GEMINI ---
  async function getGeminiAnalysis(dadosAtleta) {
    const backendUrl = `${API_BASE_URL}/api/analyze`;

    const response = await authorizedFetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosAtleta)
    });

    if (!response.ok) {
      let errorText = 'Erro no servidor.';
      try {
        const errorData = await response.json();
        errorText = `Erro no servidor: ${errorData.detail || response.statusText}`;
      } catch { /* ignore */ }
      throw new Error(errorText);
    }
    
    return await response.json();
  }

  // --- BLOCO: RenderizaÃ§Ã£o de avaliaÃ§Ã£o numÃ©rica (jÃ¡ existia, mantido) ---
  function renderEvaluation(evaluationData) {
    const {
      best_position, potential_score, injury_risk_label,
      injury_risk_score, bmi, notes, position_scores
    } = evaluationData;

    if (elements.evalSummary) {
      elements.evalSummary.innerHTML = `
        <div class="space-y-2 text-gray-200">
          <p><strong>Melhor Posicao Sugerida:</strong> <span class="font-bold text-orange-400">${safeHtml(best_position)}</span></p>
          <p><strong>Score de Potencial:</strong> <span class="font-bold text-white">${Number(potential_score)} / 100</span></p>
          <p><strong>Risco de Lesao:</strong> <span class="font-bold text-white">${safeHtml(injury_risk_label)} (${Number(injury_risk_score)} / 100)</span></p>
          ${bmi ? `<p><strong>IMC:</strong> ${Number(bmi).toFixed ? Number(bmi).toFixed(2) : bmi}</p>` : ''}
          ${notes && notes.length ? `<div class="mt-2 text-sm text-red-300"><strong>Notas:</strong><ul class="list-disc list-inside">${notes.map(n => `<li>${safeHtml(n)}</li>`).join('')}</ul></div>` : ''}
        </div>
      `;
    }

    if (elements.evalPositions && position_scores) {
      const sortedPositions = Object.entries(position_scores).sort(([, a], [, b]) => b - a);
      const tableRows = sortedPositions.map(([pos, score]) => `
        <tr class="border-b border-gray-600">
          <td class="py-1 pr-4 capitalize">${safeHtml(pos)}</td>
          <td class="py-1 font-mono">${Number(score).toFixed(1)}</td>
        </tr>
      `).join('');
      elements.evalPositions.innerHTML = `
        <table class="w-full text-left">
          <thead><tr><th class="pb-2 font-semibold text-gray-400">Posicao</th><th class="pb-2 font-semibold text-gray-400">Score</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      `;
    }
  }

  // =========================
  // === NOVAS FUNÃ‡Ã•ES MVP ===
  // =========================

  // Upload de CSV (GPS/HRV) — usa /api/measurements/upload
  async function uploadCsv() {
    if (!ensureAuthenticated()) return;
    if (!elements.csvFile || !elements.csvFile.files || elements.csvFile.files.length === 0) {
      if (elements.uploadStatus) {
        elements.uploadStatus.textContent = 'Selecione um arquivo CSV.';
        elements.uploadStatus.classList.remove('text-green-400');
        elements.uploadStatus.classList.add('text-red-400');
      }
      return;
    }
    const file = elements.csvFile.files[0];
    const form = new FormData();
    form.append('file', file);

    try {
      const res = await authorizedFetch(`${API_BASE_URL}/api/measurements/upload`, {
        method: 'POST',
        body: form
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || 'Falha no upload');
      }
      const data = await res.json();
      if (elements.uploadStatus) {
        elements.uploadStatus.textContent = `Importados: ${data.inserted} • Atletas: ${data.players_touched} • MÃ©tricas: ${data.metrics_detected.join(', ')}`;
        elements.uploadStatus.classList.remove('text-red-400');
        elements.uploadStatus.classList.add('text-green-400');
      }
      await generateAlerts();
      // tenta atualizar lista de atletas
      await loadPlayers();
    } catch (e) {
      console.error(e);
      if (elements.uploadStatus) {
        elements.uploadStatus.textContent = 'Erro no upload do CSV.';
        elements.uploadStatus.classList.remove('text-green-400');
        elements.uploadStatus.classList.add('text-red-400');
      }
    }
  }

  // Gera alertas no backend com base nas janelas definidas
  async function generateAlerts() {
    if (!ensureAuthenticated()) return;
    try {
      const selectedPlayer = elements.alertsPlayerSelector ? elements.alertsPlayerSelector.value : '';
      const payload = selectedPlayer ? { player_id: selectedPlayer } : {};
      const r = await authorizedFetch(`${API_BASE_URL}/api/alerts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error('Falha ao gerar alertas');
      await loadAlerts();
    } catch (e) {
      console.error(e);
      setAuthStatus('Erro ao gerar alertas.', true);
    }
  }

  // Busca lista de alertas
  async function loadAlerts() {
    if (!ensureAuthenticated()) return;
    try {
      const r = await authorizedFetch(`${API_BASE_URL}/api/alerts?limit=200`);
      if (!r.ok) throw new Error('Falha ao listar alertas');
      const items = await r.json();
      cachedAlerts = Array.isArray(items) ? items : [];
      renderAlertsFiltered();
    } catch (e) {
      console.error(e);
      setAuthStatus('Erro ao carregar alertas.', true);
    }
  }

  function renderAlertsFiltered() {
    const selected = elements.alertsPlayerSelector ? elements.alertsPlayerSelector.value : '';
    const items = Array.isArray(cachedAlerts) ? cachedAlerts.filter(a => {
      if (!selected) return true;
      return String(a.player_id || '') === selected;
    }) : [];
    renderAlerts(items);
  }

  // Renderiza cartÃµes de alerta
  function renderAlerts(items) {
    if (!elements.alertsContainer) return;
    elements.alertsContainer.innerHTML = '';
    if (!items || items.length === 0) {
      elements.alertsContainer.innerHTML = `<p class="text-white/60">Sem alertas no momento.</p>`;
      return;
    }
    for (const a of items) {
      const div = document.createElement('div');
      div.className = 'border border-white/10 rounded-xl p-4 bg-white/5 flex flex-col md:flex-row md:items-center md:justify-between gap-3';

      const left = document.createElement('div');
      const playerInfo = findPlayerById(a.player_id);
      const codeLabel = playerInfo && playerInfo.player_code ? sanitizeCode(playerInfo.player_code) : '';
      const nameLabel = playerInfo ? `${(playerInfo.first_name || '').trim()} ${(playerInfo.last_name || '').trim()}`.trim() : '';
      const clubLabel = playerInfo ? (playerInfo.club_name || playerInfo.club_code || '') : '';
      const headerPieces = [];
      headerPieces.push(`<span class="font-mono">${safeHtml(codeLabel || String(a.player_id || '').slice(0, 8))}</span>`);
      if (nameLabel) headerPieces.push(safeHtml(nameLabel));
      if (clubLabel) headerPieces.push(safeHtml(clubLabel));
      const athleteLine = headerPieces.join(' • ');
      left.innerHTML = `
        <p class="text-xs text-white/60">Atleta: ${athleteLine}</p>
        <p class="text-lg"><span class="text-teal-300 font-semibold">${safeHtml(a.metric || '')}</span> • <span class="uppercase">${safeHtml(a.level || '')}</span></p>
        <p class="text-white/90">${safeHtml(a.message || '')}</p>
        <p class="text-[11px] text-white/50 mt-1">${a.generated_at ? new Date(a.generated_at).toLocaleString('pt-BR') : ''}</p>
      `;

const ackBtn = document.createElement('button');
      ackBtn.className = 'bg-white/10 hover:bg-white/20 text-white text-sm font-semibold py-1 px-3 rounded';
      ackBtn.textContent = a.acknowledged ? 'Reconhecido' : 'Marcar como lido';
      ackBtn.disabled = !!a.acknowledged;
      ackBtn.addEventListener('click', async () => {
        try {
          const res = await authorizedFetch(`${API_BASE_URL}/api/alerts/${a.id}/ack`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acknowledged: true })
          });
          if (res.ok) {
            ackBtn.textContent = 'Reconhecido';
            ackBtn.disabled = true;
            a.acknowledged = 1;
            cachedAlerts = cachedAlerts.map(item => item.id === a.id ? { ...item, acknowledged: 1 } : item);
          }
        } catch (e) { /* noop */ }
      });

      div.appendChild(left);
      div.appendChild(ackBtn);
      elements.alertsContainer.appendChild(div);
    }
  }

  // Carrega alertas automaticamente se jÃ¡ estiver autenticado
  async function afterAuthAlertsBootstrap() {
    try {
      if (getStoredToken()) {
        await loadAlerts();
      }
    } catch (e) { /* noop */ }
  }

  // ==============
  // ATLETAS (UI)
  // ==============

  // Descobre se o backend jÃ¡ expÃµe endpoints de atletas
  async function detectBackendFeatures() {
    if (!ensureAuthenticated()) return;
    // Tenta /api/players
    try {
      const r = await authorizedFetch(`${API_BASE_URL}/api/players`);
      backendFeatures.players = r.ok;
      // testa sub-recursos se players existir
      if (backendFeatures.players) {
        // tentativas "light" (sem travar nada se 404)
        try {
          const testId = ''; // nÃ£o sabemos um id agora; deixamos para hora do clique
          backendFeatures.playerAlerts = true;    // vamos testar sob demanda
          backendFeatures.playerReports = true;
          backendFeatures.playerMeasurements = true;
        } catch { /* noop */ }
      } else {
        backendFeatures.playerAlerts = false;
        backendFeatures.playerReports = false;
        backendFeatures.playerMeasurements = false;
      }
    } catch {
      backendFeatures.players = false;
    }

    // Se nÃ£o houver backend de players, mantemos a seÃ§Ã£o visÃ­vel (para MVP)
    // mas com fallback baseado em /api/alerts. Nada quebra se optar por esconder:
    // elements.playersSection?.classList.toggle('hidden', !backendFeatures.players);
  }

  // Carrega lista de atletas
  async function loadPlayers() {
    if (!ensureAuthenticated()) return;
    if (!elements.playersTable) return;
    elements.playersTable.innerHTML = `
      <tr><td colspan="8" class="px-3 py-4 text-center text-white/70">Carregando atletas...</td></tr>
    `;

    if (backendFeatures.players) {
      try {
        const r = await authorizedFetch(`${API_BASE_URL}/api/players`);
        if (!r.ok) throw new Error('Falha ao listar atletas');
        const data = await r.json();
        cachedPlayers = Array.isArray(data) ? data : [];
        cachedPlayersMode = 'api';
        populatePlayerFilters(cachedPlayers);
        populateAlertsSelector(cachedPlayers);
        renderAlertsFiltered();
        renderPlayersTable(cachedPlayers, { mode: 'api' });
        return;
      } catch (e) {
        console.warn('Falha em /api/players, usando fallback por alertas.', e);
      }
    }

    try {
      const r = await authorizedFetch(`${API_BASE_URL}/api/alerts?limit=1000`);
      if (!r.ok) throw new Error('Falha ao listar alertas para fallback de atletas');
      const alerts = await r.json();
      const fallbackMap = new Map();
      for (const a of Array.isArray(alerts) ? alerts : []) {
        const id = a.player_id;
        if (!id || fallbackMap.has(id)) continue;
        fallbackMap.set(id, {
          id,
          first_name: null,
          last_name: null,
          player_code: null,
          club_name: null,
          club_code: null,
          coach_name: null,
          coach_code: null,
          metrics_count: null,
          last_measurement_at: a.generated_at || null,
          alerts_unread: null,
        });
      }
      cachedPlayers = Array.from(fallbackMap.values());
      cachedPlayersMode = 'fallback';
      populatePlayerFilters(cachedPlayers);
      populateAlertsSelector(cachedPlayers);
      renderAlertsFiltered();
      renderPlayersTable(cachedPlayers, { mode: 'fallback' });
    } catch (e) {
      console.error(e);
      elements.playersTable.innerHTML = `
        <tr><td colspan="8" class="px-3 py-4 text-center text-red-300">Não foi possível carregar atletas.</td></tr>
      `;
    }
  }

  function findPlayerById(playerId) {
    const target = String(playerId || '');
    return cachedPlayers.find(p => String(p.id || '') === target);
  }

  function populatePlayerFilters(players) {
    if (!elements.playersClubFilter || !elements.playersCoachFilter) {
      return;
    }
    const clubSelect = elements.playersClubFilter;
    const coachSelect = elements.playersCoachFilter;
    const previousClub = clubSelect.value;
    const previousCoach = coachSelect.value;
    const clubMap = new Map();
    const coachMap = new Map();
    for (const player of Array.isArray(players) ? players : []) {
      const rawClubCode = sanitizeCode(player.club_code || '');
      const clubName = (player.club_name || '').trim();
      const clubValue = rawClubCode || clubName.toUpperCase();
      if (clubValue && !clubMap.has(clubValue)) {
        clubMap.set(clubValue, clubName || clubValue);
      }
      const rawCoachCode = sanitizeCode(player.coach_code || '');
      const coachName = (player.coach_name || '').trim();
      const coachValue = rawCoachCode || coachName.toUpperCase();
      if (coachValue && !coachMap.has(coachValue)) {
        const label = coachName ? (rawCoachCode ? `${coachName} (${rawCoachCode})` : coachName) : coachValue;
        coachMap.set(coachValue, label);
      }
    }

    const clubOptions = ['<option value="">Todos os clubes</option>'];
    clubMap.forEach((label, value) => {
      clubOptions.push(`<option value="${value}">${label}</option>`);
    });
    clubSelect.innerHTML = clubOptions.join('');
    if (previousClub && clubMap.has(previousClub)) {
      clubSelect.value = previousClub;
    } else {
      clubSelect.value = '';
    }

    const coachOptions = ['<option value="">Todos os técnicos</option>'];
    coachMap.forEach((label, value) => {
      coachOptions.push(`<option value="${value}">${label}</option>`);
    });
    coachSelect.innerHTML = coachOptions.join('');
    if (previousCoach && coachMap.has(previousCoach)) {
      coachSelect.value = previousCoach;
    } else {
      coachSelect.value = '';
    }
  }

  function populateAlertsSelector(players) {
    if (!elements.alertsPlayerSelector) {
      return;
    }
    const select = elements.alertsPlayerSelector;
    const previousValue = select.value;
    const optionParts = ['<option value="">Todos os atletas</option>'];
    for (const player of Array.isArray(players) ? players : []) {
      if (!player.id) continue;
      const code = player.player_code ? sanitizeCode(player.player_code) : '';
      const first = (player.first_name || '').trim();
      const last = (player.last_name || '').trim();
      const fullName = `${first} ${last}`.trim();
      const labelSegments = [];
      if (code) labelSegments.push(code);
      if (fullName) labelSegments.push(fullName);
      const label = labelSegments.length ? labelSegments.join(' — ') : String(player.id).slice(0, 8);
      optionParts.push(`<option value="${player.id}">${label}</option>`);
    }
    select.innerHTML = optionParts.join('');
    if (previousValue && optionParts.some(opt => opt.includes(`value="${previousValue}"`))) {
      select.value = previousValue;
    } else {
      select.value = '';
    }
  }

  // Renderiza a tabela de atletas
  function renderPlayersTable(players, { mode }) {
    if (!elements.playersTable) return;
    elements.playersTable.innerHTML = '';

    const term = (elements.playersSearch?.value || '').trim().toLowerCase();
    const clubFilter = (elements.playersClubFilter?.value || '').trim().toUpperCase();
    const coachFilter = (elements.playersCoachFilter?.value || '').trim().toUpperCase();

    const filtered = (Array.isArray(players) ? players : []).filter(p => {
      const name = `${(p.first_name || '').trim()} ${(p.last_name || '').trim()}`.trim().toLowerCase();
      const code = (p.player_code || '').toLowerCase();
      const playerId = String(p.id || '').toLowerCase();
      const clubCode = (p.club_code || '').toUpperCase();
      const clubName = (p.club_name || '').trim().toUpperCase();
      const coachCode = (p.coach_code || '').toUpperCase();
      const coachName = (p.coach_name || '').trim().toUpperCase();

      if (clubFilter && clubCode !== clubFilter && clubName !== clubFilter) {
        return false;
      }
      if (coachFilter && coachCode !== coachFilter && coachName !== coachFilter) {
        return false;
      }
      if (!term) {
        return true;
      }
      return name.includes(term) || code.includes(term) || playerId.includes(term);
    });

    if (filtered.length === 0) {
      elements.playersTable.innerHTML = `
        <tr><td colspan="8" class="px-3 py-4 text-center text-white/70">Nenhum atleta encontrado.</td></tr>
      `;
      return;
    }

    for (const p of filtered) {
      const fullNameRaw = `${(p.first_name || '').trim()} ${(p.last_name || '').trim()}`.trim();
      const fullName = fullNameRaw || 'Nome indisponível';
      const initials = initialsFromName(fullName, p.id);
      const playerCode = sanitizeCode(p.player_code || '').slice(0, 6) || '---';
      const clubLabel = (p.club_name || '').trim() || (sanitizeCode(p.club_code || '').slice(0, 6) || '---');
      const coachLabel = (() => {
        const coachName = (p.coach_name || '').trim();
        const coachCode = sanitizeCode(p.coach_code || '').slice(0, 6);
        if (coachName && coachCode) return `${coachName} (${coachCode})`;
        if (coachName) return coachName;
        if (coachCode) return coachCode;
        return '---';
      })();
      const metricsCount = p.metrics_count != null ? p.metrics_count : '---';
      const lastAt = p.last_measurement_at ? new Date(p.last_measurement_at).toLocaleDateString('pt-BR') : '---';
      const alertsCount = p.alerts_unread != null ? p.alerts_unread : (p.alerts_count != null ? p.alerts_count : '---');

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-white/5';
      tr.innerHTML = `
        <td class="px-3 py-2 font-mono text-sm text-white/80">${safeHtml(playerCode)}</td>
        <td class="px-3 py-2">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">${safeHtml(initials)}</div>
            <div>
              <div class="font-medium">${safeHtml(fullName)}</div>
              <div class="text-[11px] text-white/50 font-mono">${safeHtml(String(p.id || '').slice(0, 12))}</div>
            </div>
          </div>
        </td>
        <td class="px-3 py-2">${safeHtml(clubLabel)}</td>
        <td class="px-3 py-2">${safeHtml(coachLabel)}</td>
        <td class="px-3 py-2">${safeHtml(String(metricsCount))}</td>
        <td class="px-3 py-2">${safeHtml(String(lastAt))}</td>
        <td class="px-3 py-2">${safeHtml(String(alertsCount))}</td>
        <td class="px-3 py-2 text-right">
          <button class="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm view-player-btn" data-player-id="${safeAttr(p.id)}" ${mode === 'fallback' ? 'title="Detalhes indisponíveis no backend atual" disabled' : ''}>Ver</button>
        </td>
      `;
      elements.playersTable.appendChild(tr);
    }

    elements.playersTable.querySelectorAll('.view-player-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-player-id');
        await openPlayerDetail(id);
      });
    });
  }

  // Filtro client-side
  function filterPlayersClient() {
    renderPlayersTable(cachedPlayers, { mode: cachedPlayersMode });
  }

// Abre modal de detalhe do atleta
  async function openPlayerDetail(playerId) {
    if (!elements.playerDetailModal) return;
    // limpa UI
    setPlayerHeader({ initials: '?', name: '—', meta: '' });
    setPlayerAlerts([]);
    setPlayerReports([]);
    setMetricOptions([]);
    setMeasurementsTable([]);

    if (!backendFeatures.players) {
      // sem endpoints, sÃ³ informa
      setPlayerHeader({ initials: '#', name: `Atleta ${playerId.slice(0, 8)}…`, meta: 'Detalhes indisponÃ­veis neste backend (sem /api/players)' });
      elements.playerDetailUnread.textContent = '0';
      showPlayerModal();
      return;
    }

    try {
      // Carrega perfil (lista de players jÃ¡ trouxe nome? pode haver endpoint GET /api/players/{id})
      let profile = null;
      try {
        const resp = await authorizedFetch(`${API_BASE_URL}/api/players/${playerId}`);
        if (resp.ok) profile = await resp.json();
      } catch { /* ignore */ }

      const fullName = profile ? ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim() : '';
      const headerMeta = [];
      if (profile && profile.player_code) headerMeta.push(`ID ${sanitizeCode(profile.player_code)}`);
      if (profile && (profile.club_name || profile.club_code)) headerMeta.push(profile.club_name || profile.club_code);
      if (profile && profile.coach_name) headerMeta.push(`Técnico ${profile.coach_name}`);
      if (profile && profile.age) headerMeta.push(`${profile.age} anos`);
      setPlayerHeader({
        initials: initialsFromName(fullName, playerId),
        name: fullName || `Atleta ${playerId.slice(0,8)}…`,
        meta: headerMeta.join(' • ')
      });

      // ALERTAS do atleta
      let alerts = [];
      try {
        const ra = await authorizedFetch(`${API_BASE_URL}/api/players/${playerId}/alerts`);
        if (ra.ok) alerts = await ra.json();
      } catch { /* ignore */ }
      setPlayerAlerts(alerts);
      elements.playerDetailUnread.textContent = String(Array.isArray(alerts) ? alerts.filter(a => !a.acknowledged).length : 0);

      // RELATÃ“RIOS do atleta
      let reports = [];
      try {
        const rr = await authorizedFetch(`${API_BASE_URL}/api/players/${playerId}/reports`);
        if (rr.ok) reports = await rr.json();
      } catch { /* ignore */ }
      setPlayerReports(reports);

      // MEDIÃ‡Ã•ES
      // 1) carrega amostra para descobrir mÃ©tricas disponÃ­veis
      let measurements = [];
      try {
        const rm = await authorizedFetch(`${API_BASE_URL}/api/players/${playerId}/measurements`);
        if (rm.ok) measurements = await rm.json();
      } catch { /* ignore */ }

      const metrics = Array.from(new Set(measurements.map(m => m.metric))).sort();
      setMetricOptions(metrics);

      if (metrics.length) {
        elements.metricFilter.value = metrics[0];
        await loadMetricSeries(playerId, metrics[0]);
      } else {
        drawMetricChart([], []);
      }

      // listener para trocar mÃ©trica
      if (elements.metricFilter) {
        elements.metricFilter.onchange = async (e) => {
          const metric = e.target.value;
          await loadMetricSeries(playerId, metric);
        };
      }

      showPlayerModal();
    } catch (e) {
      console.error(e);
      setAuthStatus('Falha ao abrir detalhe do atleta.', true);
    }
  }

  function showPlayerModal() {
    elements.playerDetailModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closePlayerDetail() {
    elements.playerDetailModal.classList.add('hidden');
    document.body.style.overflow = '';
    if (metricChartInstance) {
      metricChartInstance.destroy();
      metricChartInstance = null;
    }
  }

  function setPlayerHeader({ initials, name, meta }) {
    if (elements.playerDetailInitials) elements.playerDetailInitials.textContent = initials || '?';
    if (elements.playerDetailName) elements.playerDetailName.textContent = name || '—';
    if (elements.playerDetailMeta) elements.playerDetailMeta.textContent = meta || '';
  }

  function setPlayerAlerts(alerts) {
    if (!elements.playerAlerts) return;
    elements.playerAlerts.innerHTML = '';
    if (!alerts || !alerts.length) {
      elements.playerAlerts.innerHTML = `<p class="text-white/60 text-sm">Sem alertas.</p>`;
      return;
    }
    alerts.forEach(a => {
      const item = document.createElement('div');
      item.className = 'text-sm bg-white/5 border border-white/10 rounded-md p-2';
      item.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="text-teal-300 font-medium">${safeHtml(a.metric || '')}</span>
          <span class="text-[11px] text-white/50">${a.generated_at ? new Date(a.generated_at).toLocaleString('pt-BR') : ''}</span>
        </div>
        <div class="text-white/90">${safeHtml(a.message || '')}</div>
      `;
      elements.playerAlerts.appendChild(item);
    });
  }

  function setPlayerReports(reports) {
    if (!elements.playerReports) return;
    elements.playerReports.innerHTML = '';
    if (!reports || !reports.length) {
      elements.playerReports.innerHTML = `<p class="text-white/60 text-sm">Sem relatÃ³rios salvos para este atleta.</p>`;
      return;
    }
    reports.forEach(r => {
      const item = document.createElement('div');
      item.className = 'text-sm bg-white/5 border border-white/10 rounded-md p-2';
      const when = r.date ? new Date(r.date).toLocaleString('pt-BR') : '';
      item.innerHTML = `
        <div class="flex items-center justify-between">
          <span class="font-medium">${safeHtml(r.athlete_name || 'RelatÃ³rio')}</span>
          <span class="text-[11px] text-white/50">${when}</span>
        </div>
      `;
      item.addEventListener('click', () => {
        // abre o bloco de resultados com o conteÃºdo do relatÃ³rio
        if (r.dados_atleta && r.analysis) {
          displayAnalysis(r.dados_atleta, r.analysis);
          elements.resultsDiv.classList.remove('hidden');
          elements.resultsDiv.scrollIntoView({ behavior: 'smooth' });
        }
      });
      elements.playerReports.appendChild(item);
    });
  }

  function setMetricOptions(metrics) {
    if (!elements.metricFilter) return;
    elements.metricFilter.innerHTML = '';
    if (!metrics || !metrics.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Sem mÃ©tricas';
      elements.metricFilter.appendChild(opt);
      return;
    }
    metrics.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      elements.metricFilter.appendChild(opt);
    });
  }

  async function loadMetricSeries(playerId, metric) {
    if (!backendFeatures.playerMeasurements || !metric) {
      drawMetricChart([], []);
      setMeasurementsTable([]);
      return;
    }
    try {
      const r = await authorizedFetch(`${API_BASE_URL}/api/players/${playerId}/measurements?metric=${encodeURIComponent(metric)}`);
      if (!r.ok) throw new Error('Falha ao carregar sÃ©rie da mÃ©trica');
      const items = await r.json();
      // Esperado: [{recorded_at, value, unit}]
      const labels = items.map(i => new Date(i.recorded_at)).sort((a, b) => a - b).map(d => d.toLocaleDateString('pt-BR'));
      const data = items.sort((a,b)=> new Date(a.recorded_at)-new Date(b.recorded_at)).map(i => Number(i.value || 0));
      drawMetricChart(labels, data);
      setMeasurementsTable(items);
    } catch (e) {
      console.error(e);
      drawMetricChart([], []);
      setMeasurementsTable([]);
    }
  }

  function drawMetricChart(labels, data) {
    const ctx = document.getElementById('metricChart').getContext('2d');
    if (metricChartInstance) {
      metricChartInstance.destroy();
      metricChartInstance = null;
    }
    metricChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels || [],
        datasets: [{
          label: 'Valor',
          data: data || [],
          borderWidth: 2,
          pointRadius: 2,
          fill: false
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: false }
        }
      }
    });
  }

  function setMeasurementsTable(items) {
    if (!elements.measurementsTable) return;
    elements.measurementsTable.innerHTML = '';
    if (!items || !items.length) {
      elements.measurementsTable.innerHTML = `
        <tr><td colspan="4" class="px-3 py-3 text-white/60 text-center">Sem dados.</td></tr>
      `;
      return;
    }
    items
      .slice()
      .sort((a,b)=> new Date(b.recorded_at)-new Date(a.recorded_at))
      .forEach(i => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-white/5';
        tr.innerHTML = `
          <td class="px-3 py-2">${i.recorded_at ? new Date(i.recorded_at).toLocaleString('pt-BR') : '—'}</td>
          <td class="px-3 py-2">${safeHtml(i.metric || '')}</td>
          <td class="px-3 py-2">${Number(i.value ?? 0)}</td>
          <td class="px-3 py-2">${safeHtml(i.unit || '')}</td>
        `;
        elements.measurementsTable.appendChild(tr);
      });
  }

  // Utils
  function initialsFromName(name, id) {
    const n = (name || '').trim();
    if (n) {
      const parts = n.split(/\s+/);
      const a = parts[0]?.[0] || '';
      const b = parts.slice(-1)[0]?.[0] || '';
      const inits = (a + b).toUpperCase();
      if (inits.trim()) return inits;
    }
    return (String(id || '?').slice(0,2) || '??').toUpperCase();
  }
  function safeAttr(v) {
    return String(v).replace(/"/g, '&quot;');
  }

  // Se jÃ¡ tinha sessÃ£o ao abrir a pÃ¡gina, tenta carregar alertas e atletas
  afterAuthAlertsBootstrap();

}); // fim do DOMContentLoaded







