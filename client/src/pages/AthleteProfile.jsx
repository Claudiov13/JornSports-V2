import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Activity, Clipboard, Brain, Save, Loader2 } from 'lucide-react';
import { getPlayers, saveAssessment, analyzeAthlete, getHistory } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const TABS = [
    { id: 'overview', label: 'Visão Geral', icon: Activity },
    { id: 'assessment', label: 'Avaliação Técnica', icon: Clipboard },
    { id: 'ai', label: 'Relatório IA', icon: Brain },
];

export default function AthleteProfile() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('overview');
    const [player, setPlayer] = useState(null);
    const [history, setHistory] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, [id]);

    const loadData = async () => {
        try {
            const players = await getPlayers();
            const p = players.find(p => p.id === id);
            setPlayer(p);

            const h = await getHistory(id);
            setHistory(h);
        } catch (error) {
            console.error("Erro ao carregar atleta:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-white">Carregando...</div>;
    if (!player) return <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center text-white">Atleta não encontrado</div>;

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans">
            <div className="max-w-7xl mx-auto px-6 py-8">
                {/* Header */}
                <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition">
                    <ArrowLeft className="h-5 w-5" /> Voltar ao Painel
                </button>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div className="flex items-center gap-6">
                        <div className="h-20 w-20 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-orange-500 flex items-center justify-center text-3xl font-bold text-white">
                            {player.first_name.charAt(0)}
                        </div>
                        <div>
                            <h1 className="text-4xl font-black italic uppercase text-white">
                                {player.first_name} <span className="text-orange-500">{player.last_name}</span>
                            </h1>
                            <p className="text-gray-400 text-lg">{player.club_name} • {player.player_code}</p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-8 border-b border-white/10">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                px-6 py-4 flex items-center gap-2 font-bold uppercase tracking-wide transition border-b-2
                                ${activeTab === tab.id
                                    ? 'text-orange-500 border-orange-500'
                                    : 'text-gray-500 border-transparent hover:text-white hover:border-white/20'}
                            `}
                        >
                            <tab.icon className="h-5 w-5" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content */}
                <div className="min-h-[500px]">
                    {activeTab === 'overview' && <OverviewTab history={history} />}
                    {activeTab === 'assessment' && <AssessmentTab player={player} />}
                    {activeTab === 'ai' && <AITab player={player} />}
                </div>
            </div>
        </div>
    );
}

function OverviewTab({ history }) {
    if (!history || Object.keys(history).length === 0) {
        return (
            <div className="p-12 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                <Activity className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-white">Sem dados de GPS/HRV</h3>
                <p className="text-gray-400 mt-2">Importe arquivos CSV no Dashboard para visualizar o histórico.</p>
            </div>
        );
    }

    const hrvData = history['hrv_rmssd'] || [];
    const distData = history['total_distance'] || [];

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <ChartCard title="Variabilidade Cardíaca (rMSSD)" data={hrvData} color="#f97316" unit="ms" />
            <ChartCard title="Distância Total" data={distData} color="#22c55e" unit="m" />
        </div>
    );
}

function ChartCard({ title, data, color, unit }) {
    return (
        <div className="bg-[#111827] border border-white/5 rounded-3xl p-6">
            <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                <Activity className="h-5 w-5" style={{ color }} />
                {title}
            </h3>
            <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="date" hide />
                        <YAxis stroke="#666" fontSize={12} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#000', border: '1px solid #333', borderRadius: '8px' }}
                            itemStyle={{ color: '#fff' }}
                        />
                        <Line
                            type="monotone"
                            dataKey="value"
                            stroke={color}
                            strokeWidth={3}
                            dot={{ fill: color, r: 4 }}
                            activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

function AssessmentTab({ player }) {
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        altura: 175, peso: 70, posicao: 'meia', pe_dominante: 'direito',
        controle_bola: 5, drible: 5, passe_curto: 5, passe_longo: 5,
        finalizacao: 5, cabeceio: 5, desarme: 5, visao_jogo: 5,
        compostura: 5, agressividade: 5
    });

    // Load existing assessment if available (mock logic for now, ideally passed in player obj)
    // For now we just use defaults or what's in local state if we had it.

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await saveAssessment(player.id, {
                ...formData,
                altura: parseInt(formData.altura),
                peso: parseFloat(formData.peso),
                // skills
                controle_bola: parseInt(formData.controle_bola),
                drible: parseInt(formData.drible),
                passe_curto: parseInt(formData.passe_curto),
                passe_longo: parseInt(formData.passe_longo),
                finalizacao: parseInt(formData.finalizacao),
                cabeceio: parseInt(formData.cabeceio),
                desarme: parseInt(formData.desarme),
                visao_jogo: parseInt(formData.visao_jogo),
                compostura: parseInt(formData.compostura),
                agressividade: parseInt(formData.agressividade),
            });
            alert('Avaliação salva com sucesso!');
        } catch (error) {
            console.error(error);
            alert('Erro ao salvar avaliação.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSave} className="bg-[#111827] border border-white/5 rounded-3xl p-8 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold text-white">Ficha Técnica</h2>
                <button
                    type="submit"
                    disabled={loading}
                    className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-black font-bold uppercase rounded-xl transition disabled:opacity-50"
                >
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
                    Salvar Alterações
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className="space-y-6">
                    <h3 className="text-orange-500 font-bold uppercase text-sm tracking-wider">Dados Físicos</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <Input label="Altura (cm)" name="altura" type="number" value={formData.altura} onChange={handleChange} />
                        <Input label="Peso (kg)" name="peso" type="number" value={formData.peso} onChange={handleChange} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <Select label="Posição" name="posicao" value={formData.posicao} onChange={handleChange} options={["goleiro", "zagueiro", "lateral", "volante", "meia", "ponta", "atacante"]} />
                        <Select label="Pé Dominante" name="pe_dominante" value={formData.pe_dominante} onChange={handleChange} options={["direito", "esquerdo", "ambidestro"]} />
                    </div>
                </div>

                <div className="space-y-6">
                    <h3 className="text-orange-500 font-bold uppercase text-sm tracking-wider">Atributos Técnicos (0-10)</h3>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        {Object.keys(formData).filter(k => !['altura', 'peso', 'posicao', 'pe_dominante'].includes(k)).map(skill => (
                            <RangeInput key={skill} label={skill.replace('_', ' ')} name={skill} value={formData[skill]} onChange={handleChange} />
                        ))}
                    </div>
                </div>
            </div>
        </form>
    );
}

function AITab({ player }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const generateReport = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await analyzeAthlete(player.id);
            setReport(data);
        } catch (err) {
            console.error(err);
            setError('Erro ao gerar relatório. Verifique se a avaliação técnica foi preenchida.');
        } finally {
            setLoading(false);
        }
    };

    if (error) {
        return (
            <div className="p-8 bg-red-500/10 border border-red-500/20 rounded-3xl text-center">
                <p className="text-red-400 font-bold mb-4">{error}</p>
                <button onClick={() => setError(null)} className="text-sm text-gray-400 hover:text-white underline">Tentar novamente</button>
            </div>
        );
    }

    if (!report) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-24 w-24 bg-white/5 rounded-full flex items-center justify-center mb-6">
                    <Brain className="h-12 w-12 text-orange-500" />
                </div>
                <h2 className="text-3xl font-black italic uppercase text-white mb-4">
                    Inteligência <span className="text-orange-500">Jorn</span>
                </h2>
                <p className="text-gray-400 max-w-md mb-8">
                    Nossa IA analisa o histórico de GPS, HRV e sua avaliação técnica para gerar insights profundos sobre performance e risco.
                </p>
                <button
                    onClick={generateReport}
                    disabled={loading}
                    className="px-8 py-4 bg-white text-black font-black uppercase tracking-wide rounded-xl hover:bg-gray-200 transition shadow-lg shadow-white/10 disabled:opacity-50 flex items-center gap-3"
                >
                    {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Brain className="h-6 w-6" />}
                    {loading ? 'Analisando Dados...' : 'Gerar Relatório Completo'}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* System Alerts */}
            {report.system_alerts && (
                <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-2xl">
                    <h3 className="text-red-400 font-bold uppercase flex items-center gap-2 mb-2">
                        <Activity className="h-5 w-5" /> Alertas Críticos Detectados
                    </h3>
                    <pre className="whitespace-pre-wrap text-red-300 font-mono text-sm">{report.system_alerts}</pre>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <ScoreCard label="Potencial" value={report.evaluation.potential_score} />
                <ScoreCard label="Risco Lesão" value={report.evaluation.injury_risk_score} inverse />
                <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
                    <h3 className="text-gray-400 text-sm font-bold uppercase">Posição Ideal</h3>
                    <p className="text-2xl font-black text-white mt-2 uppercase">{report.evaluation.best_position}</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <ReportSection title="Análise Holística" content={report.relatorio} />
                <div className="space-y-8">
                    <ReportSection title="Comparação Pro" content={report.comparacao} />
                    <ReportSection title="Plano de Treino Sugerido" content={report.plano_treino} />
                </div>
            </div>
        </div>
    );
}

function Input({ label, ...props }) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <input {...props} className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-orange-500 focus:outline-none transition" />
        </div>
    );
}

function Select({ label, options, ...props }) {
    return (
        <div className="space-y-1">
            <label className="text-xs font-bold text-gray-500 uppercase">{label}</label>
            <select {...props} className="w-full bg-black/20 border border-white/10 rounded-lg px-4 py-3 text-white focus:border-orange-500 focus:outline-none transition appearance-none">
                {options.map(opt => <option key={opt} value={opt} className="bg-gray-900">{opt}</option>)}
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
            <input type="range" min="0" max="10" name={name} value={value} onChange={onChange} className="w-full accent-orange-500 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer" />
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
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 h-full">
            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <Brain className="h-5 w-5 text-orange-500" />
                {title}
            </h3>
            <div className="prose prose-invert prose-orange max-w-none text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
