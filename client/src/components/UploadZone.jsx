import React, { useState, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, Loader2 } from 'lucide-react';
import { uploadCSV } from '../services/api';
import { motion, AnimatePresence } from 'framer-motion';

export default function UploadZone({ onUploadSuccess }) {
    const [isDragging, setIsDragging] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState(null); // 'success' | 'error'
    const [message, setMessage] = useState('');
    const fileInputRef = useRef(null);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            await processFile(files[0]);
        }
    };

    const handleFileSelect = async (e) => {
        if (e.target.files.length > 0) {
            await processFile(e.target.files[0]);
        }
    };

    const processFile = async (file) => {
        if (!file.name.endsWith('.csv')) {
            setStatus('error');
            setMessage('Por favor, envie apenas arquivos CSV.');
            return;
        }

        setUploading(true);
        setStatus(null);
        setMessage('');

        try {
            const result = await uploadCSV(file);
            setStatus('success');
            setMessage(`${result.inserted} registros importados com sucesso!`);
            if (onUploadSuccess) onUploadSuccess();
        } catch (error) {
            console.error(error);
            setStatus('error');
            setMessage(error.response?.data?.detail || 'Erro ao processar o arquivo.');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="w-full">
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                    relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300
                    ${isDragging
                        ? 'border-orange-500 bg-orange-500/10 scale-[1.02]'
                        : 'border-white/10 bg-white/5 hover:border-orange-500/50 hover:bg-white/10'}
                `}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept=".csv"
                    className="hidden"
                />

                <div className="flex flex-col items-center gap-4">
                    <div className={`
                        h-16 w-16 rounded-full flex items-center justify-center transition-colors duration-300
                        ${isDragging ? 'bg-orange-500 text-white' : 'bg-white/10 text-gray-400'}
                    `}>
                        {uploading ? (
                            <Loader2 className="h-8 w-8 animate-spin" />
                        ) : (
                            <Upload className="h-8 w-8" />
                        )}
                    </div>

                    <div className="space-y-1">
                        <h3 className="text-lg font-semibold text-white">
                            {uploading ? 'Processando...' : 'Importar Dados CSV'}
                        </h3>
                        <p className="text-sm text-gray-400">
                            Arraste seu arquivo aqui ou clique para selecionar
                        </p>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {status && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`mt-4 p-4 rounded-xl flex items-center gap-3 ${status === 'success'
                                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                : 'bg-red-500/10 border border-red-500/20 text-red-400'
                            }`}
                    >
                        {status === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                        <span className="text-sm font-medium">{message}</span>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
