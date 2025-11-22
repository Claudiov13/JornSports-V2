import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronRight, Check, AlertTriangle, Loader2, X } from 'lucide-react';
import { analyzeAthlete } from '../services/api';

const POSITIONS = ["goleiro", "zagueiro", "lateral", "volante", "meia", "ponta", "atacante"];
const SKILLS = [
    "controle_bola", "drible", "passe_curto", "passe_longo",
    "finalizacao", "cabeceio", "desarme", "visao_jogo",
    "compostura", "agressividade"
];

export default function AIReport({ onClose }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [report, setReport] = useState(null);
    const [formData, setFormData] = useState({
        nome: '', sobrenome: '', idade: '', posicao_atual: 'meia',
        altura: '', peso: '', pe_dominante: 'direito',
        controle_bola: 5, drible: 5, passe_curto: 5, passe_longo: 5,
        finalizacao: 5, cabeceio: 5, desarme: 5, visao_jogo: 5,
        compostura: 5, agressividade: 5
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const payload = {
                ...formData,
                idade: parseInt(formData.idade),
                altura: parseInt(formData.altura),
                peso: parseFloat(formData.peso),
                // Ensure skills are integers
                ...SKILLS.reduce((acc, skill) => ({ ...acc, [skill]: parseInt(formData[skill]) }), {})
            };
            const data = await analyzeAthlete(payload);
            setReport(data);
        } catch (error) {
            console.error(error);
            alert('Erro ao gerar relatório. Verifique os dados.');
        } finally {
            setLoading(false);
        }
    };

    if (report) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-[#0B0F17] border border-orange-500/20 w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl shadow-orange-500/10"
                >
                    <div className="p-8 space-y-8">
                        <div className="flex justify-between items-start">
                            <div>
                                <h2 className="text-3xl font-black italic uppercase tracking-tighter text-white">
                                    Relatório <span className="text-orange-500">JornSports</span>
                                </h2>
                                <p className="text-gray-400">Análise de Inteligência Artificial</p>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition">
                                <X className="h-6 w-6 text-gray-400" />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <ScoreCard label="Potencial" value={report.evaluation.potential_score} />
                            <ScoreCard label="Risco Lesão" value={report.evaluation.injury_risk_score} inverse />
                            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                                <h3 className="text-gray-400 text-sm font-bold uppercase">Melhor Posição</h3>
                                <p className="text-2xl font-black text-white mt-2 uppercase">{report.evaluation.best_position}</p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <ReportSection title="Análise Técnica" content={report.relatorio} />
                            <ReportSection title="Comparação Pro" content={report.comparacao} />
                            <ReportSection title="Plano de Treino" content={report.plano_treino} />
                        </div>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#111827] border border-white/10 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl"
            >
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-[#0B0F17]">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Brain className="h-5 w-5 text-orange-500" />
                        Nova Análise com IA
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8">
                    {step === 1 ? (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <Input label="Nome" name="nome" value={formData.nome} onChange={handleChange} required />
                                <Input label="Sobrenome" name="sobrenome" value={formData.sobrenome} onChange={handleChange} required />
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <Input label="Idade" name="idade" type="number" value={formData.idade} onChange={handleChange} required />
                                <Input label="Altura (cm)" name="altura" type="number" value={formData.altura} onChange={handleChange} required />
                                <Input label="Peso (kg)" name="peso" type="number" value={formData.peso} onChange={handleChange} required />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <Select label="Posição" name="posicao_atual" value={formData.posicao_atual} onChange={handleChange} options={POSITIONS} />
                                <Select label="Pé Dominante" name="pe_dominante" value={formData.pe_dominante} onChange={handleChange} options={["direito", "esquerdo", "ambidestro"]} />
                            </div>
                            <button
                                type="button"
                                onClick={() => setStep(2)}
                                className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-black font-bold uppercase rounded-xl transition flex items-center justify-center gap-2"
                            >
                                Próximo: Habilidades <ChevronRight className="h-5 w-5" />
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                                {SKILLS.map(skill => (
                                    <RangeInput
                                        key={skill}
                                        label={skill.replace('_', ' ')}
                                        name={skill}
                                        value={formData[skill]}
                                        onChange={handleChange}
                                    />
                                ))}
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button
                                    type="button"
                                    onClick={() => setStep(1)}
                                    className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-white font-bold uppercase rounded-xl transition"
                                >
                                    Voltar
                                </button>
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="flex-[2] py-4 bg-orange-500 hover:bg-orange-600 text-black font-bold uppercase rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Gerar Relatório'}
                                </button>
                            </div>
                        </div>
                    )}
                </form>
            </motion.div>
        </div>
    );
}

function Input({ label, ...props }) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <input
                {...props}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-orange-500 focus:outline-none transition"
            />
        </div>
    );
}

function Select({ label, options, ...props }) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <select
                {...props}
                className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-orange-500 focus:outline-none transition appearance-none"
            >
                {options.map(opt => (
                    <option key={opt} value={opt} className="bg-gray-900">{opt}</option>
                ))}
            </select>
        </div>
    );
}

function RangeInput({ label, value, onChange, name }) {
    return (
        <div className="space-y-2">
            <div className="flex justify-between">
                <label className="text-xs font-bold text-gray-400 uppercase">{label}</label>
                <span className="text-xs font-bold text-orange-500">{value}</span>
            </div>
            <input
                type="range"
                min="0" max="10"
                name={name}
                value={value}
                onChange={onChange}
                className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
        </div>
    );
}

function ScoreCard({ label, value, inverse }) {
    const color = inverse
        ? (value < 30 ? 'text-green-500' : value < 70 ? 'text-orange-500' : 'text-red-500')
        : (value > 70 ? 'text-green-500' : value > 40 ? 'text-orange-500' : 'text-red-500');

    return (
        <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
            <h3 className="text-gray-400 text-sm font-bold uppercase">{label}</h3>
            <div className={`text-4xl font-black mt-2 ${color}`}>{value}</div>
        </div>
    );
}

function ReportSection({ title, content }) {
    return (
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Check className="h-5 w-5 text-orange-500" />
                {title}
            </h3>
            <div
                className="prose prose-invert prose-orange max-w-none text-gray-300"
                dangerouslySetInnerHTML={{ __html: content }}
            />
        </div>
    );
}
