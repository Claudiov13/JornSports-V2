import React, { useState, useEffect } from 'react';
import { UserButton, useUser } from "@clerk/clerk-react";
import { Bell, Upload, Users, Activity, Plus, Brain, AlertTriangle, ChevronRight } from 'lucide-react';
import { getPlayers } from '../services/api';
import UploadZone from '../components/UploadZone';
import OnboardingModal from '../components/OnboardingModal';
import AIReport from '../components/AIReport';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
    const { user } = useUser();
    const navigate = useNavigate();
    const [players, setPlayers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showUpload, setShowUpload] = useState(false);
    const [showAI, setShowAI] = useState(false);
    const [userRole, setUserRole] = useState(null);

    const fetchPlayers = async () => {
        try {
            const data = await getPlayers();
            setPlayers(data);
        } catch (error) {
            console.error("Erro ao buscar jogadores:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPlayers();
        if (user) {
            const role = localStorage.getItem(`jorn_role_${user.id}`);
            if (role) setUserRole(role);
        }
    }, [user]);

    const getRoleLabel = (role) => {
        const map = { 'coach': 'Treinador', 'physio': 'Fisiologista', 'scout': 'Analista' };
        return map[role] || 'Treinador';
    };

    // Calculate stats
    const totalPlayers = players.length;
    const recentPlayers = players.slice(0, 5);

    return (
        <div className="min-h-screen bg-[#0B0F17] text-white font-sans selection:bg-orange-500 selection:text-white">
            <OnboardingModal onComplete={(role) => setUserRole(role)} />

            {/* Topbar */}
            <header className="bg-[#0B0F17]/80 border-b border-white/5 sticky top-0 z-40 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 bg-orange-500 rounded-xl flex items-center justify-center font-bold text-black italic shadow-lg shadow-orange-500/20">
                            J
                        </div>
                        <span className="font-bold text-xl tracking-tight">Painel <span className="text-orange-500">Jorn</span></span>
                    </div>

                    <div className="flex items-center gap-6">
                        <button className="relative p-2 text-gray-400 hover:text-white transition">
                            <Bell className="h-6 w-6" />
                            <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 bg-red-500 rounded-full border-2 border-[#0B0F17]"></span>
                        </button>
                        <div className="h-8 w-px bg-white/10"></div>
                        <UserButton appearance={{ elements: { avatarBox: "h-10 w-10" } }} />
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-6 py-12 space-y-12">

                {/* Header & Actions */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-4xl font-black italic uppercase tracking-tighter text-white mb-2">
                            Olá, {userRole ? getRoleLabel(userRole) : 'Treinador'} {user?.firstName}
                        </h1>
                        <p className="text-gray-400 text-lg">
                            Gerencie seu elenco e monitore a performance.
                        </p>
                    </div>
                    <div className="flex gap-4">
                        <button
                            onClick={() => setShowUpload(!showUpload)}
                            className="flex items-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl font-bold uppercase transition text-sm"
                        >
                            <Upload className="h-5 w-5 text-orange-500" />
                            Importar CSV
                        </button>
                        <button
                            onClick={() => setShowAI(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-black rounded-xl font-bold uppercase transition shadow-lg shadow-orange-500/20 text-sm"
                        >
                            <Plus className="h-5 w-5" />
                            Novo Atleta
                        </button>
                    </div>
                </div>

                {/* Upload Zone Collapsible */}
                {showUpload && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                    >
                        <UploadZone onUploadSuccess={() => {
                            fetchPlayers();
                            setShowUpload(false);
                        }} />
                    </motion.div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard
                        title="Atletas Monitorados"
                        value={totalPlayers}
                        icon={<Users className="h-6 w-6 text-orange-500" />}
                    />
                    <StatCard
                        title="Alertas Ativos"
                        value="0"
                        desc="Nenhum risco crítico detectado"
                        icon={<AlertTriangle className="h-6 w-6 text-green-500" />}
                    />
                    <StatCard
                        title="Carga Semanal"
                        value="Alta"
                        desc="+12% vs semana anterior"
                        icon={<Activity className="h-6 w-6 text-orange-500" />}
                    />
                </div>

                {/* Players List */}
                <div className="bg-[#111827] border border-white/5 rounded-3xl overflow-hidden">
                    <div className="p-8 border-b border-white/5 flex justify-between items-center">
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            <Users className="h-5 w-5 text-orange-500" />
                            Elenco Atual
                        </h2>
                    </div>

                    {loading ? (
                        <div className="p-12 text-center text-gray-500">Carregando dados...</div>
                    ) : players.length === 0 ? (
                        <div className="p-12 text-center text-gray-500">
                            Nenhum atleta encontrado. Importe um CSV para começar.
                        </div>
                    ) : (
                        <div className="divide-y divide-white/5">
                            {recentPlayers.map(player => (
                                <div
                                    key={player.id}
                                    onClick={() => navigate(`/athlete/${player.id}`)}
                                    className="p-6 hover:bg-white/5 transition flex items-center justify-between group cursor-pointer"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 border border-white/10 flex items-center justify-center font-bold text-gray-400 group-hover:border-orange-500/50 transition">
                                            {player.first_name?.charAt(0)}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-white text-lg group-hover:text-orange-500 transition">
                                                {player.first_name} {player.last_name}
                                            </h4>
                                            <p className="text-sm text-gray-500">
                                                {player.club_name} • {player.player_code || 'N/A'}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right hidden md:block">
                                            <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Status</span>
                                            <div className="flex items-center gap-2 mt-1">
                                                <div className="h-2 w-2 rounded-full bg-green-500"></div>
                                                <span className="text-sm font-medium text-gray-300">Ativo</span>
                                            </div>
                                        </div>
                                        <ChevronRight className="h-5 w-5 text-gray-600 group-hover:text-white transition" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </main>

            {/* AI Report Modal */}
            {showAI && <AIReport onClose={() => setShowAI(false)} />}

        </div>
    );
}

function StatCard({ title, value, desc, icon }) {
    return (
        <div className="p-8 rounded-3xl bg-[#111827] border border-white/5 hover:border-orange-500/20 transition group">
            <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-white/5 group-hover:bg-orange-500/10 transition">
                    {icon}
                </div>
                {desc && <span className="text-xs font-medium text-gray-500 bg-white/5 px-2 py-1 rounded-lg">{desc}</span>}
            </div>
            <div className="text-4xl font-black text-white mb-1">{value}</div>
            <div className="text-gray-400 font-medium uppercase text-sm tracking-wide">{title}</div>
        </div>
    );
}
