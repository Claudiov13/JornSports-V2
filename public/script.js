// Aguarda o documento carregar para adicionar os listeners
document.addEventListener('DOMContentLoaded', () => {
    // Esconde a seção de resultados inicialmente
    document.getElementById('results').style.display = 'none';

    // Listener para o botão de análise
    const analisarBtn = document.getElementById('analisarBtn');
    if(analisarBtn) {
        analisarBtn.onclick = analisarPerfil;
    }

    // O listener do botão de editar foi removido daqui, pois o botão é dinâmico.
    // A ação será controlada diretamente no HTML do botão (veja Correção 2).
});

// Objeto com os "pesos" de cada atributo para cada estilo de nado.
const perfisDeNado = {
    Crawl: {
        forca: 0.15, resistencia: 0.25, velocidade: 0.20, flexibilidade: 0.10,
        coordenacao: 0.15, envergadura: 0.10, mobOmbro: 0.05,
    },
    Costas: {
        forca: 0.15, resistencia: 0.20, velocidade: 0.15, flexibilidade: 0.15,
        coordenacao: 0.20, envergadura: 0.10, mobOmbro: 0.05,
    },
    Peito: {
        forca: 0.20, resistencia: 0.15, velocidade: 0.10, flexibilidade: 0.10,
        coordenacao: 0.30, mobTornozelo: 0.15,
    },
    Borboleta: {
        forca: 0.30, resistencia: 0.15, velocidade: 0.20, flexibilidade: 0.05,
        coordenacao: 0.20, mobOmbro: 0.10,
    }
};

function analisarPerfil() {
    // 1. Coletar e Validar os Dados do Formulário
    const dados = {
        nome: document.getElementById('nome').value,
        altura: parseFloat(document.getElementById('altura').value),
        peso: parseFloat(document.getElementById('peso').value),
        envergadura: parseFloat(document.getElementById('envergadura').value) || parseFloat(document.getElementById('altura').value),
        forca: parseInt(document.getElementById('forca').value),
        resistencia: parseInt(document.getElementById('resistencia').value),
        velocidade: parseInt(document.getElementById('velocidade').value),
        flexibilidade: parseInt(document.getElementById('flexibilidade').value),
        coordenacao: parseInt(document.getElementById('coordenacao').value),
        mobOmbro: parseInt(document.getElementById('mobOmbro').value),
        mobTornozelo: parseInt(document.getElementById('mobTornozelo').value),
        sexo: document.getElementById('sexo').value, // Adicionado para salvar no BD
        idade: parseInt(document.getElementById('idade').value) // Adicionado para salvar no BD
    };

    // Validação simples
    for (const key in dados) {
        if (!dados[key] && key !== 'envergadura') {
            alert(`Por favor, preencha o campo: ${key}`);
            return;
        }
    }

    // 2. Calcular Métricas Derivadas
    const imc = (dados.peso / ((dados.altura / 100) ** 2)).toFixed(2);
    const apeIndex = (dados.envergadura / dados.altura).toFixed(3);

    // 3. Calcular a Pontuação de Compatibilidade
    let resultados = [];
    for (const nado in perfisDeNado) {
        let pontuacao = 0;
        const perfil = perfisDeNado[nado];
        
        pontuacao += (dados.forca / 10) * (perfil.forca || 0);
        pontuacao += (dados.resistencia / 10) * (perfil.resistencia || 0);
        pontuacao += (dados.velocidade / 10) * (perfil.velocidade || 0);
        pontuacao += (dados.flexibilidade / 10) * (perfil.flexibilidade || 0);
        pontuacao += (dados.coordenacao / 10) * (perfil.coordenacao || 0);
        pontuacao += (dados.mobOmbro / 10) * (perfil.mobOmbro || 0);
        pontuacao += (dados.mobTornozelo / 10) * (perfil.mobTornozelo || 0);
        
        if (perfil.envergadura && apeIndex > 1.02) {
             pontuacao += 0.05 * perfil.envergadura;
        }

        resultados.push({ nado, compatibilidade: Math.round(pontuacao * 100) });
    }

    resultados.sort((a, b) => b.compatibilidade - a.compatibilidade);

    // 4. Exibir os Resultados
    exibirResultados(dados, resultados, imc, apeIndex);
}

async function exibirResultados(dados, resultados, imc, apeIndex) {
    // A referência ao container de resultados fica aqui, apenas uma vez.
    const resultsContainer = document.getElementById('results');
    const melhorNado = resultados[0];

    // Opcional: bloco try/catch para a comunicação com o servidor
    // Se você ainda não tem o servidor rodando, pode comentar este bloco para testar só o frontend
    try {
        const response = await fetch('/api/analise', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dados, resultados }),
        });
        const serverResponse = await response.json();
        if (serverResponse.success) {
            console.log('Análise salva com sucesso! ID do Atleta:', serverResponse.athleteId);
        } else {
            console.error('Falha ao salvar a análise no servidor.');
        }
    } catch (error) {
        // Se o servidor não estiver rodando, este erro aparecerá no console, mas o resto do código continuará.
        console.warn('Erro de comunicação com o servidor. A análise será exibida, mas não foi salva.', error);
    }

    // CORREÇÃO 2: Ação do onclick melhorada para esconder resultados E mostrar o formulário.
    let htmlResultados = `
        <div class="results-header">
            <h2>RELATÓRIO PARA ${dados.nome.toUpperCase()}</h2>
            <div class="subtitle">Estilo Principal Recomendado: <strong>${melhorNado.nado}</strong></div>
             <div class="results-actions">
                <button class="secondary-btn" id="editBtn" 
                        onclick="document.getElementById('results').style.display='none'; document.querySelector('.form-container').style.display='grid';">
                    ✏️ Editar Respostas
                </button>
             </div>
        </div>
        <div class="results-content">
            <div class="sport-recommendation">
    `;

    resultados.forEach(res => {
        htmlResultados += `
            <div class="sport-match">
                <span class="sport-name">${res.nado}</span>
                <div class="match-bar">
                    <div class="match-fill" style="width: ${res.compatibilidade}%;"></div>
                </div>
                <span class="match-percentage">${res.compatibilidade}%</span>
            </div>
        `;
    });

    htmlResultados += `
            </div>
            <h3>Análise Detalhada</h3>
            <p>Com base em suas respostas, seu perfil apresenta uma compatibilidade de <strong>${melhorNado.compatibilidade}%</strong> com o nado <strong>${melhorNado.nado}</strong>.
            Seu Índice de Massa Corporal (IMC) é de <strong>${imc}</strong> e seu Ape Index (relação envergadura/altura) é de <strong>${apeIndex}</strong>.
            </p>
            <h4>Pontos Fortes para ${melhorNado.nado}:</h4>
            <ul>
                <li>Sua <strong>avaliação de Força</strong> é um fator chave para a potência exigida neste estilo.</li>
                <li>Sua <strong>Coordenação</strong> se alinha bem com os complexos movimentos rítmicos do ${melhorNado.nado}.</li>
            </ul>
            <h4>Áreas para Desenvolvimento:</h4>
            <ul>
                <li>Considere focar em treinos para melhorar sua <strong>Resistência</strong> para sustentar a eficiência em distâncias maiores.</li>
                <li>Exercícios de <strong>Mobilidade de Ombro</strong> podem aumentar ainda mais a amplitude e eficiência de sua braçada.</li>
            </ul>
        </div>
    `;

    // CORREÇÃO 1: A segunda declaração de 'resultsContainer' foi removida.
    resultsContainer.innerHTML = htmlResultados;
    resultsContainer.style.display = 'block';
    resultsContainer.scrollIntoView({ behavior: 'smooth' });
}