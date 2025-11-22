import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
});

export const getPlayers = async () => {
    const response = await api.get('/players');
    return response.data;
};

export const uploadCSV = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post('/ingest/csv', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    });
    return response.data;
};

export const analyzeAthlete = async (playerId) => {
    const response = await api.post('/analyze', { player_id: playerId });
    return response.data;
};

export const saveAssessment = async (playerId, data) => {
    const response = await api.put(`/players/${playerId}/assessment`, data);
    return response.data;
};

export const getHistory = async (playerId) => {
    const response = await api.get(`/players/${playerId}/history`);
    return response.data;
};

export default api;
