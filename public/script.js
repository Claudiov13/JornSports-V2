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

    // === NOVOS ELEMENTOS (Upload + Alertas) ===
    csvFile: document.getElementById('csv-file'),
    uploadCsvBtn: document.getElementById('upload-csv-btn'),
    uploadStatus: document.getElementById('upload-status'),
    generateAlertsBtn: document.getElementById('generate-alerts-btn'),
    alertsContainer: document.getElementById('alerts-container'),
    refreshAlertsBtn: document.getElementById('refresh-alerts'),
  };

  const API_BASE_URL = 'http://127.0.0.1:8000';
  const TOKEN_STORAGE_KEY = 'jornAuthToken';
  const TOKEN_EXPIRY_KEY = 'jornAuthTokenExpiry';
  let currentUserEmail = '';

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
    // novos botões
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
        let message = 'Nao foi possivel autenticar.';
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
      // carregar alertas logo após login
      await afterAuthAlertsBootstrap();
    } catch (error) {
      console.error('Erro de rede ao autenticar:', error);
      setAuthStatus('Erro de rede ao autenticar.', true);
    }
  }

  function logout() {
    clearAuthData();
    updateAuthUI();
    setAuthStatus('Sessao encerrada.', false);
    // limpa painel de alertas
    if (elements.alertsContainer) {
      elements.alertsContainer.innerHTML = '';
    }
    if (elements.uploadStatus) elements.uploadStatus.textContent = '';
  }

  function initializeAuth() {
    updateAuthUI();
    const token = getStoredToken();
    if (token) {
      loadCurrentUser();
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
    
    // Listamos todos os campos que devem ser numeros inteiros ou decimais
    const integerFields = [
      'idade', 'altura', 'envergadura', 'salto_vertical', 'controle_bola', 
      'drible', 'passe_curto', 'passe_longo', 'finalizacao', 'cabeceio', 
      'desarme', 'visao_jogo', 'compostura', 'agressividade'
    ];
    const floatFields = ['peso', 'percentual_gordura', 'velocidade_sprint', 'agilidade'];

    const fieldSource = elements.formContainer ? elements.formContainer : document;
    fieldSource.querySelectorAll('input, select, textarea').forEach(el => {
      if (!el.id) return; // Pula elementos sem ID

      let value = el.value.trim();

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
    elements.reportTitle.innerText = `Relatorio de Analise para ${nomeCompleto.toUpperCase()}`;
    elements.iaAnalysisDiv.innerHTML = safeHtml(analysis.relatorio);
    elements.playerComparisonDiv.innerHTML = safeHtml(analysis.comparacao);
    elements.trainingPlanDiv.innerHTML = safeHtml(analysis.plano_treino);

    // 1) Mostra o container primeiro
    elements.loadingDiv.classList.add('hidden');
    elements.resultsContent.classList.remove('hidden');
    populateSkillsFromData(dadosAtleta);

    // 2) So entao cria/redimensiona o grafico
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
    elements.reportTitle.innerText = 'Erro na Analise';

    let errorMessage = error.message;
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
      <p class="text-red-400 font-bold mb-2">Nao foi possivel gerar a analise. Detalhes:</p>
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

  // Preenche sliders e spans a partir de dados do atleta (relatorio/salvo)
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

  // Le os sliders diretamente do DOM (garante valores atuais)
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

  // --- FUNCAO DO GRAFICO ---
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

  // --- LOGICA DE SALVAR E CARREGAR RELATORIOS ---
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
        throw new Error('Falha ao salvar relatorio.');
      }
    } catch (error) {
      console.error('Erro ao salvar relatorio:', error);
      setAuthStatus('Nao foi possivel salvar o relatorio.', true);
    }
  }

  function getSavedReports() {
    return JSON.parse(localStorage.getItem('jornScoutReports')) || [];
  }
    
  async function showReportsModal() {
    if (!ensureAuthenticated()) {
      return;
    }

    try {
      const response = await authorizedFetch(`${API_BASE_URL}/api/reports`);
      if (!response.ok) {
        throw new Error('Falha ao carregar relatorios.');
      }
      const reports = await response.json();
      elements.reportsListContainer.innerHTML = '';

      if (reports.length === 0) {
        elements.reportsListContainer.innerHTML = '<p class="text-gray-400 text-center">Nenhum relatorio salvo ainda.</p>';
      } else {
        const list = document.createElement('ul');
        list.className = 'space-y-3';
        reports.forEach(report => {
          const listItem = document.createElement('li');
          listItem.className = 'bg-gray-700 p-4 rounded-lg flex justify-between items-center';
          listItem.innerHTML = `
            <div class="cursor-pointer flex-grow report-item-view">
              <p class="font-bold text-white">${report.athlete_name}</p>
              <p class="text-sm text-gray-400">Analise de ${new Date(report.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
            </div>
            <button class="delete-report-btn text-red-500 hover:text-red-400 font-bold text-2xl" data-report-id="${report.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
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
      console.error('Erro ao carregar relatorios:', error);
      setAuthStatus('Nao foi possivel carregar os relatorios.', true);
    }
  }

  async function deleteReport(reportId) {
    if (!ensureAuthenticated()) {
      return;
    }

    if (confirm('Tem certeza que deseja excluir este relatorio?')) {
      try {
        const response = await authorizedFetch(`${API_BASE_URL}/api/reports/${reportId}`, {
          method: 'DELETE'
        });

        if (!response.ok) {
          throw new Error('Falha ao excluir relatorio.');
        }

        showReportsModal();
      } catch (error) {
        console.error('Erro ao excluir relatorio:', error);
        setAuthStatus('Erro ao excluir o relatorio.', true);
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
      const errorData = await response.json();
      throw new Error(`Erro no servidor: ${errorData.detail || response.statusText}`);
    }
    
    return await response.json();
  }

  // --- BLOCO: Renderização de avaliação numérica (já existia, mantido) ---
  function renderEvaluation(evaluationData) {
    const {
      best_position, potential_score, injury_risk_label,
      injury_risk_score, bmi, notes, position_scores
    } = evaluationData;

    if (elements.evalSummary) {
      elements.evalSummary.innerHTML = `
        <div class="space-y-2 text-gray-200">
          <p><strong>Melhor Posicao Sugerida:</strong> <span class="font-bold text-orange-400">${best_position}</span></p>
          <p><strong>Score de Potencial:</strong> <span class="font-bold text-white">${potential_score} / 100</span></p>
          <p><strong>Risco de Lesao:</strong> <span class="font-bold text-white">${injury_risk_label} (${injury_risk_score} / 100)</span></p>
          ${bmi ? `<p><strong>IMC:</strong> ${bmi}</p>` : ''}
          ${notes && notes.length ? `<div class="mt-2 text-sm text-red-300"><strong>Notas:</strong><ul class="list-disc list-inside">${notes.map(n => `<li>${n}</li>`).join('')}</ul></div>` : ''}
        </div>
      `;
    }

    if (elements.evalPositions && position_scores) {
      const sortedPositions = Object.entries(position_scores).sort(([, a], [, b]) => b - a);
      const tableRows = sortedPositions.map(([pos, score]) => `
        <tr class="border-b border-gray-600">
          <td class="py-1 pr-4 capitalize">${pos}</td>
          <td class="py-1 font-mono">${score.toFixed(1)}</td>
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
  // === NOVAS FUNÇÕES MVP ===
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
        elements.uploadStatus.textContent = `Importados: ${data.inserted} • Atletas: ${data.players_touched} • Métricas: ${data.metrics_detected.join(', ')}`;
        elements.uploadStatus.classList.remove('text-red-400');
        elements.uploadStatus.classList.add('text-green-400');
      }
      // opcional: gerar alertas logo após ingestão
      await generateAlerts();
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
      const r = await authorizedFetch(`${API_BASE_URL}/api/alerts/generate`, { method: 'POST' });
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
      renderAlerts(items);
    } catch (e) {
      console.error(e);
      setAuthStatus('Erro ao carregar alertas.', true);
    }
  }

  // Renderiza cartões de alerta
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
      left.innerHTML = `
        <p class="text-xs text-white/60">Athlete ID: <span class="font-mono">${a.player_id}</span></p>
        <p class="text-lg"><span class="text-teal-300 font-semibold">${a.metric}</span> • <span class="uppercase">${a.level}</span></p>
        <p class="text-white/90">${safeHtml(a.message)}</p>
        <p class="text-[11px] text-white/50 mt-1">${a.generated_at || ''}</p>
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
          }
        } catch (e) { /* noop */ }
      });

      div.appendChild(left);
      div.appendChild(ackBtn);
      elements.alertsContainer.appendChild(div);
    }
  }

  // Carrega alertas automaticamente se já estiver autenticado
  async function afterAuthAlertsBootstrap() {
    try {
      if (getStoredToken()) {
        await loadAlerts();
      }
    } catch (e) { /* noop */ }
  }

  // Se já tinha sessão ao abrir a página, tenta carregar alertas
  afterAuthAlertsBootstrap();

}); // fim do DOMContentLoaded