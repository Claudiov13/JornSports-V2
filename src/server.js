// src/server.js
const express = require('express');
const path = require('path');
const { setup } = require('./database');

const app = express();
const port = 3000;

// Middleware para servir os arquivos estáticos (HTML, CSS, JS) da pasta 'public'
app.use(express.static(path.join(__dirname, '..', 'public')));
// Middleware para conseguir ler o corpo de requisições em JSON
app.use(express.json());

// Função principal que roda o servidor
async function startServer() {
    const db = await setup();

    // Rota da API para receber os dados da análise
    app.post('/api/analise', async (req, res) => {
        try {
            const { dados, resultados } = req.body; // Espera receber dados e resultados do frontend
            
            // Inserir no banco de dados
            const result = await db.run(
                'INSERT INTO atletas (nome, idade, sexo, altura, peso, envergadura, dados_analise, resultado_analise) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    dados.nome,
                    dados.idade,
                    dados.sexo,
                    dados.altura,
                    dados.peso,
                    dados.envergadura,
                    JSON.stringify(dados), // Salva todos os dados do formulário como um texto JSON
                    JSON.stringify(resultados) // Salva o array de resultados como um texto JSON
                ]
            );
            
            // Retorna sucesso e o ID do novo atleta registrado
            res.status(201).json({ success: true, athleteId: result.lastID });

        } catch (error) {
            console.error('Erro ao salvar análise:', error);
            res.status(500).json({ success: false, message: 'Erro interno do servidor.' });
        }
    });

    app.listen(port, () => {
        console.log(`🚀 Servidor rodando em http://localhost:${port}`);
    });
}

startServer();