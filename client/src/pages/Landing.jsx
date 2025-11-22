import React, { useRef } from 'react';
import { SignInButton } from "@clerk/clerk-react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Activity, Shield, TrendingUp, ChevronRight, Mail, ArrowDown } from 'lucide-react';

export default function Landing() {
    const targetRef = useRef(null);
    const { scrollYProgress } = useScroll({
        target: targetRef,
        offset: ["start start", "end start"]
    });

    const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
    const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);

    return (
        <div className="relative min-h-screen bg-[#0B0F17] text-white overflow-x-hidden font-sans selection:bg-orange-500 selection:text-white">

            {/* Navbar */}
            <nav className="fixed w-full z-50 top-0 left-0 border-b border-white/5 bg-[#0B0F17]/80 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="h-8 w-8 bg-orange-500 rounded flex items-center justify-center font-bold text-black italic">
                            J
                        </div>
                        <span className="text-xl font-bold tracking-tighter uppercase italic">Jorn<span className="text-orange-500">Sports</span></span>
                    </div>
                    <SignInButton mode="modal">
                        <button className="px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wide border border-white/20 hover:bg-white hover:text-black transition-all">
                            Login
                        </button>
                    </SignInButton>
                </div>
            </nav>

            {/* Hero Section with Parallax */}
            <section ref={targetRef} className="relative h-screen flex flex-col items-center justify-center px-6 pt-20">
                <motion.div style={{ opacity, scale }} className="text-center space-y-8 relative z-10">
                    <motion.div
                        initial={{ y: 100, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="inline-block"
                    >
                        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 leading-tight">
                            Prevenção de Lesões
                        </h1>
                        <h1 className="text-6xl md:text-8xl font-black tracking-tighter uppercase italic text-orange-500 leading-tight">
                            Potencializada por I.A.
                        </h1>
                    </motion.div>

                    <motion.p
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.4, duration: 0.8 }}
                        className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto font-medium"
                    >
                        O sistema de prevenção de lesões usado pela elite.
                        <br />
                        <span className="text-white font-semibold">Venha fazer parte do clube JornSports.</span>
                    </motion.p>

                    <motion.div
                        initial={{ y: 50, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8"
                    >
                        <SignInButton mode="modal">
                            <button className="h-14 px-8 bg-orange-500 hover:bg-orange-400 text-black font-black uppercase tracking-wider text-lg transition-transform hover:scale-105 active:scale-95 skew-x-[-10deg]">
                                Começar Agora
                            </button>
                        </SignInButton>
                        <button className="h-14 px-8 border border-white/20 hover:bg-white/10 text-white font-bold uppercase tracking-wider text-lg transition-all skew-x-[-10deg]">
                            Solicitar Demo
                        </button>
                    </motion.div>
                </motion.div>

                {/* Scroll Indicator */}
                <motion.div
                    animate={{ y: [0, 10, 0] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                    className="absolute bottom-10 left-1/2 -translate-x-1/2 text-gray-500"
                >
                    <ArrowDown className="h-6 w-6" />
                </motion.div>

                {/* Background Elements */}
                <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-1/4 left-0 w-[50vw] h-[50vw] bg-orange-500/20 rounded-full blur-[120px] -translate-x-1/2"></div>
                    <div className="absolute bottom-0 right-0 w-[40vw] h-[40vw] bg-blue-600/10 rounded-full blur-[100px] translate-x-1/3"></div>
                </div>
            </section>

            {/* Marquee Section */}
            <div className="bg-orange-500 py-4 overflow-hidden rotate-[-2deg] scale-110 origin-left border-y-4 border-black">
                <div className="flex whitespace-nowrap animate-marquee">
                    {[...Array(10)].map((_, i) => (
                        <span key={i} className="text-4xl font-black text-black uppercase italic tracking-tighter mx-8">
                            JORNSPORTS • PREVENÇÃO • PERFORMANCE • INTELIGÊNCIA •
                        </span>
                    ))}
                </div>
            </div>

            {/* Scroll Reveal Features */}
            <section className="py-32 px-6 max-w-7xl mx-auto space-y-32">

                <FeatureSection
                    number="01"
                    title="GPS Tracking"
                    desc="Controle de carga em tempo real. Saiba exatamente quem correu demais e quem precisa de mais estímulo."
                    icon={<Activity className="h-32 w-32 text-orange-500" />}
                    align="left"
                />

                <FeatureSection
                    number="02"
                    title="HRV Analysis"
                    desc="A resposta interna do atleta não mente. Identifique fadiga central antes que ela se torne uma lesão muscular."
                    icon={<Shield className="h-32 w-32 text-orange-500" />}
                    align="right"
                />

                <FeatureSection
                    number="03"
                    title="Smart Alerts"
                    desc="Não perca tempo com gráficos complexos. Receba alertas diretos no seu celular: 'Atleta X em Risco Alto'."
                    icon={<TrendingUp className="h-32 w-32 text-orange-500" />}
                    align="left"
                />

            </section>

            {/* CTA Footer */}
            <section className="py-32 px-6 text-center bg-gradient-to-b from-[#0B0F17] to-orange-950/30">
                <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    className="max-w-4xl mx-auto space-y-8"
                >
                    <h2 className="text-5xl md:text-7xl font-black uppercase italic tracking-tighter">
                        Pronto para o <br /> <span className="text-orange-500">Próximo Nível?</span>
                    </h2>

                    <button className="h-16 px-12 bg-white text-black hover:bg-gray-200 font-black uppercase tracking-wider text-xl transition-transform hover:scale-105 skew-x-[-10deg]">
                        Solicitar Conta Demo
                    </button>

                </motion.div>
            </section>

        </div >
    );
}

function FeatureSection({ number, title, desc, icon, align }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 100 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8 }}
            className={`flex flex-col md:flex-row items-center gap-12 ${align === 'right' ? 'md:flex-row-reverse' : ''}`}
        >
            <div className="flex-1 relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-transparent rounded-3xl transform rotate-3 group-hover:rotate-6 transition-transform duration-500"></div>
                <div className="relative bg-[#111827] border border-white/10 p-12 rounded-3xl h-[400px] flex items-center justify-center overflow-hidden">
                    <div className="absolute top-4 right-6 text-8xl font-black text-white/5 select-none">
                        {number}
                    </div>
                    <div className="transform group-hover:scale-110 transition-transform duration-500">
                        {icon}
                    </div>
                </div>
            </div>

            <div className="flex-1 space-y-6">
                <h3 className="text-5xl font-black uppercase italic tracking-tighter">
                    {title}
                </h3>
                <p className="text-xl text-gray-400 leading-relaxed">
                    {desc}
                </p>
                <button className="text-orange-500 font-bold uppercase tracking-wide hover:text-white transition-colors flex items-center gap-2">
                    Saiba mais <ChevronRight className="h-4 w-4" />
                </button>
            </div>
        </motion.div>
    );
}
