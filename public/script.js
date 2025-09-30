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
  playerAvatar: document.getElementById('player-avatar'), // só funciona se existir no HTML
  posicaoSelect: document.getElementById('posicao_atual'),
  heatmaps: document.querySelectorAll('#tactical-map .heatmap'),
  evalSummary: document.getElementById('eval-summary-content'),
  evalPositions: document.getElementById('eval-positions-content'),
};

// --- Sanitizador de HTML (defesa contra XSS) ---
function safeHtml(html) {
  return DOMPurify.sanitize(String(html || ""));
}

// Acessibilidade: permite dar foco programático no container de erro
if (elements.errorContainer) {
  elements.errorContainer.setAttribute('tabindex', '-1');
}

// Marca campos "tocados" ao sair do foco (útil para estilos :invalid + classe)
document.querySelectorAll('input, select, textarea').forEach(el => {
  el.addEventListener('blur', () => el.classList.add('user-touched'));
});

let skillChart = null; // Variável para armazenar a instância do gráfico

    // --- EVENT LISTENERS ---
    elements.analisarBtn.addEventListener('click', analisarPerfil);
    elements.viewReportsBtn.addEventListener('click', showReportsModal);
    elements.closeModalBtn.addEventListener('click', () => elements.reportsModal.classList.add('hidden'));

   let rafId = 0;
document.querySelectorAll('.skill-slider').forEach(slider => {
  const valueSpan = document.getElementById(`${slider.id}_value`);
  if (!valueSpan) return;

  valueSpan.textContent = slider.value;

  slider.addEventListener('input', () => {
    valueSpan.textContent = slider.value;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      renderSkillChart(); // lê direto do DOM
    });
  });
});

    // --- FUNÇÕES DE VALIDAÇÃO E LÓGICA PRINCIPAL ---
  function validateForm() {
  const errors = [];
  elements.errorList.innerHTML = '';

  const requiredFields = document.querySelectorAll('[required]');
  requiredFields.forEach(field => {
    if (!String(field.value || '').trim()) {
      errors.push(`O campo "${field.name}" é obrigatório.`);
    }
  });

  const nomeField = document.getElementById('nome');
  if (nomeField && nomeField.value && !/^[a-zA-Z\s]+$/.test(nomeField.value)) {
    errors.push('O campo "Nome" deve conter apenas letras e espaços.');
  }
  
  const sobrenomeField = document.getElementById('sobrenome');
  if (sobrenomeField && sobrenomeField.value && !/^[a-zA-Z\s]+$/.test(sobrenomeField.value)) {
    errors.push('O campo "Sobrenome" deve conter apenas letras e espaços.');
  }

  if (errors.length > 0) {
    errors.forEach(error => {
      const li = document.createElement('li');
      li.textContent = error;
      elements.errorList.appendChild(li);
    });
    elements.errorContainer.classList.remove('hidden');
    elements.errorContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // dá o foco DEPOIS do scroll terminar
    requestAnimationFrame(() => elements.errorContainer && elements.errorContainer.focus({ preventScroll: true }));
    return false;
  }

  elements.errorContainer.classList.add('hidden');
  return true;
}

    async function analisarPerfil() {
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

    // --- FUNÇÕES DE MANIPULAÇÃO DO DOM E DADOS ---
 function getFormData() {
    const data = {};
    
    // Listamos todos os campos que devem ser números inteiros ou decimais
    const integerFields = [
        'idade', 'altura', 'envergadura', 'salto_vertical', 'controle_bola', 
        'drible', 'passe_curto', 'passe_longo', 'finalizacao', 'cabeceio', 
        'desarme', 'visao_jogo', 'compostura', 'agressividade'
    ];
    const floatFields = ['peso', 'percentual_gordura', 'velocidade_sprint', 'agilidade'];

    document.querySelectorAll('input, select, textarea').forEach(el => {
        if (!el.id) return; // Pula elementos sem ID

        let value = el.value.trim();

        // 1. Se o campo for um número inteiro...
        if (integerFields.includes(el.id)) {
            // Se o campo não estiver vazio, converte para inteiro. Senão, deixa nulo.
            data[el.id] = value ? parseInt(value, 10) : null;
        
        // 2. Se o campo for um número decimal...
        } else if (floatFields.includes(el.id)) {
            // Substitui vírgula por ponto e converte para decimal.
            value = value.replace(',', '.');
            data[el.id] = value ? parseFloat(value) : null;
        
        // 3. Se for um campo de texto normal...
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

  // 1) Mostra o container primeiro
  elements.loadingDiv.classList.add('hidden');
  elements.resultsContent.classList.remove('hidden');
  populateSkillsFromData(dadosAtleta);

  // 2) Só então cria/redimensiona o gráfico
requestAnimationFrame(() => {
  renderSkillChart(dadosAtleta); // Passa os dados do atleta para o gráfico
  
  // ADICIONE ESTE BLOCO
  if (analysis.evaluation) {
    renderEvaluation(analysis.evaluation);
  }
});

}

function displayError(error) {
    elements.loadingDiv.classList.add('hidden');
    elements.resultsContent.classList.remove('hidden');
    elements.reportTitle.innerText = 'Erro na Análise';

    // ✅ CÓDIGO MELHORADO PARA EXIBIR ERROS DETALHADOS
    let errorMessage = error.message;
    // Se a mensagem de erro contém um corpo JSON, formata para ser legível
    if (errorMessage.includes('Corpo:')) {
        try {
            // Tenta extrair e formatar o JSON do erro
            const jsonPart = errorMessage.substring(errorMessage.indexOf('{'));
            const errorObj = JSON.parse(jsonPart);
            // Formata o JSON para exibição com <pre> para manter a indentação
            errorMessage = `<pre class="text-left text-sm whitespace-pre-wrap">${JSON.stringify(errorObj, null, 2)}</pre>`;
        } catch (e) {
            // Se falhar, apenas exibe a mensagem original
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
    if(skillChart) skillChart.destroy();
}

    // Campos de habilidades usados no gráfico
const SKILL_FIELDS = [
  'controle_bola','drible','passe_curto','passe_longo','finalizacao',
  'cabeceio','desarme','visao_jogo','compostura','agressividade'
];

// Preenche sliders e spans a partir de dados do atleta (relatório/salvo)
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

// Lê os sliders diretamente do DOM (garante valores atuais)
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
    // --- FUNÇÃO DO GRÁFICO ---
   function renderSkillChart(dadosAtleta) {
  const ctx = document.getElementById('skillChart').getContext('2d');

  // 1) IDs dos campos que estão no HTML (os "name"/"id" dos sliders):
  const campos = [
   'controle_bola',
    'drible',
    'passe_curto',
    'passe_longo',
    'finalizacao',
    'cabeceio',
    'desarme',
    'visao_jogo',
    'compostura',
    'agressividade'
  ];

  // 2) Rótulos bonitos para aparecer no gráfico:
  const labels = [
      'Controle de Bola',
    'Drible',
    'Passe Curto',
    'Passe Longo',
    'Finalização',
    'Cabeceio',
    'Desarme',
    'Visão de Jogo',
    'Compostura',
    'Agressividade'
  ];

  // 3) Converte TUDO para número (se vier vazio/NaN, vira 0):
  const source = dadosAtleta || readSkillsFromDOM();
  const n = id => {
    const v = Number(source[id]);
    return Number.isFinite(v) ? v : 0;
  };
  const data = campos.map(n);

  // (opcional) se quiser normalizar para 0–100:
  // const data = campos.map(id => Math.max(0, Math.min(100, n(id))));

  // 4) Evita “gráfico duplicado” quando re-renderiza
  if (skillChart) skillChart.destroy();

  // 5) Cria o gráfico já com eixo configurado
  skillChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label: 'Habilidades Técnicas',
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
      layout: {
        padding: {
          top: 60, 
          bottom: 60
        }
      },
      // Radar usa escala "r"
   scales: {
  r: {
    min: 0,
    max: 10,
    ticks: {
      stepSize: 1,
      showLabelBackdrop: false,     // tira o retângulo atrás dos números
      backdropColor: 'rgba(0,0,0,0)' // redundante, só para garantir
    },
    grid: { color: 'rgba(229,231,235,0.15)' },
    angleLines: { color: 'rgba(229,231,235,0.15)' },
    pointLabels: { color: '#e5e7eb', font: { size: 12 } }
  }
},
    }
  });
}

    // --- LÓGICA DE SALVAR E CARREGAR RELATÓRIOS - Alterado para Phyton/docker---
   async function saveReport(dadosAtleta, analysis) {
    const nomeCompleto = `${dadosAtleta.nome} ${dadosAtleta.sobrenome}`;
    const reportData = {
        athleteName: nomeCompleto,
        dados: dadosAtleta,
        analysis: analysis
    };

    await fetch('http://127.0.0.1:8000/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData)
    });
}
    function getSavedReports() {
        return JSON.parse(localStorage.getItem('jornScoutReports')) || [];
    }
    
  async function showReportsModal() {
    const response = await fetch('http://127.0.0.1:8000/api/reports');
    const reports = await response.json(); // Lê do backend
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
                        <p class="font-bold text-white">${report.athlete_name}</p>
                        <p class="text-sm text-gray-400">Análise de ${new Date(report.date).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
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
            // 1) Mostra o container primeiro
        }

        elements.reportsModal.classList.remove('hidden');
    }

   async function deleteReport(reportId) {
    if (confirm('Tem certeza que deseja excluir este relatório?')) {
       await fetch(`http://127.0.0.1:8000/api/reports/${reportId}`, {
            method: 'DELETE'
        });
        showReportsModal(); // Atualiza a lista
    }
}

    // --- CHAMADA À API GEMINI ---
  async function getGeminiAnalysis(dadosAtleta) {
    // O endereço do nosso novo backend Python
    const backendUrl = 'http://127.0.0.1:8000/api/analyze';

    const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(dadosAtleta) // Apenas envia os dados puros
    });

    if (!response.ok) {
        // Pega o erro detalhado do nosso backend para exibir
        const errorData = await response.json();
        throw new Error(`Erro no servidor: ${errorData.detail || response.statusText}`);
    }
    
    return await response.json(); // Retorna o JSON já processado pelo backend
}

// script.js (cole no final do arquivo)

function renderEvaluation(evaluationData) {
    const {
        best_position, potential_score, injury_risk_label,
        injury_risk_score, bmi, notes, position_scores
    } = evaluationData;

    if (elements.evalSummary) {
        elements.evalSummary.innerHTML = `
            <div class="space-y-2 text-gray-200">
                <p><strong>Melhor Posição Sugerida:</strong> <span class="font-bold text-orange-400">${best_position}</span></p>
                <p><strong>Score de Potencial:</strong> <span class="font-bold text-white">${potential_score} / 100</span></p>
                <p><strong>Risco de Lesão:</strong> <span class="font-bold text-white">${injury_risk_label} (${injury_risk_score} / 100)</span></p>
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
                <thead><tr><th class="pb-2 font-semibold text-gray-400">Posição</th><th class="pb-2 font-semibold text-gray-400">Score</th></tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
        `;
    }
}
});
