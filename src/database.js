// src/database.js
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

async function setup() {
    // Abre a conexão com o arquivo do banco de dados. Se não existir, ele será criado.
    const db = await open({
        filename: './jorn_database.sqlite',
        driver: sqlite3.Database
    });

    // Executa um comando SQL para criar a tabela de atletas se ela ainda não existir.
    // Isso garante que a estrutura básica esteja sempre presente.
    await db.exec(`
        CREATE TABLE IF NOT EXISTS atletas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            idade INTEGER,
            sexo TEXT,
            altura REAL,
            peso REAL,
            envergadura REAL,
            dados_analise TEXT, -- JSON com todos os inputs da análise
            resultado_analise TEXT, -- JSON com o resultado (compatibilidades)
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    console.log('Banco de dados conectado e tabela de atletas garantida.');
    return db;
}

module.exports = { setup };