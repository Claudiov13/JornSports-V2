import { API_BASE_URL } from './config.js';
import { storeToken, clearAuthData, getStoredToken, authorizedFetch } from './api.js';

export async function login(email, password) {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
        let message = 'Não foi possível autenticar.';
        try {
            const detail = await response.json();
            if (detail && detail.detail) {
                message = detail.detail;
            }
        } catch (e) { /* ignore */ }
        throw new Error(message);
    }

    const data = await response.json();
    storeToken(data.access_token, data.expires_in);
    return data;
}

export function logout() {
    clearAuthData();
}

export async function getCurrentUser() {
    const response = await authorizedFetch(`${API_BASE_URL}/auth/me`); // Updated to /auth/me
    if (!response.ok) {
        throw new Error('Falha ao consultar dados do usuario.');
    }
    return await response.json();
}

export function isAuthenticated() {
    return !!getStoredToken();
}
