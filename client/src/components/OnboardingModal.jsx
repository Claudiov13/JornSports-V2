import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Activity, Clipboard } from 'lucide-react';
import { useUser } from "@clerk/clerk-react";

const ROLES = [
    { id: 'coach', label: 'Treinador', icon: User, desc: 'Gestão de elenco e tática' },
    { id: 'physio', label: 'Fisiologista', icon: Activity, desc: 'Monitoramento de carga e saúde' },
    { id: 'scout', label: 'Analista/Scout', icon: Clipboard, desc: 'Avaliação de desempenho' }
];

export default function OnboardingModal({ onComplete }) {
    const { user } = useUser();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedRole, setSelectedRole] = useState(null);

    useEffect(() => {
        if (user) {
            const hasRole = localStorage.getItem(`jorn_role_${user.id}`);
            if (!hasRole) {
                setIsOpen(true);
            } else {
                onComplete(hasRole);
            }
        }
    }, [user]);

    const handleConfirm = () => {
        if (selectedRole && user) {
            localStorage.setItem(`jorn_role_${user.id}`, selectedRole);
            setIsOpen(false);
            onComplete(selectedRole);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#0B0F17] border border-orange-500/20 w-full max-w-lg rounded-3xl p-8 shadow-2xl shadow-orange-500/10 text-center"
            >
                <h2 className="text-3xl font-black italic uppercase text-white mb-2">
                    Bem-vindo ao <span className="text-orange-500">JornSports</span>
                </h2>
                <p className="text-gray-400 mb-8">
                    Para personalizar sua experiência, qual é a sua função principal no clube?
                </p>

                <div className="grid gap-4 mb-8">
                    {ROLES.map((role) => (
                        <button
                            key={role.id}
                            onClick={() => setSelectedRole(role.id)}
                            className={`
                                p-4 rounded-xl border flex items-center gap-4 transition-all group
                                ${selectedRole === role.id
                                    ? 'bg-orange-500 border-orange-500 text-black'
                                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:border-white/20'}
                            `}
                        >
                            <div className={`
                                p-3 rounded-lg transition-colors
                                ${selectedRole === role.id ? 'bg-black/20' : 'bg-white/5 group-hover:bg-white/10'}
                            `}>
                                <role.icon className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <h3 className={`font-bold uppercase ${selectedRole === role.id ? 'text-black' : 'text-white'}`}>
                                    {role.label}
                                </h3>
                                <p className={`text-sm ${selectedRole === role.id ? 'text-black/70' : 'text-gray-500'}`}>
                                    {role.desc}
                                </p>
                            </div>
                        </button>
                    ))}
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={!selectedRole}
                    className="w-full py-4 bg-white text-black font-black uppercase tracking-wide rounded-xl hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Confirmar Acesso
                </button>
            </motion.div>
        </div>
    );
}
