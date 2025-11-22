import { API_BASE_URL, TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY } from './config.js';

export function clearAuthData() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
}

export function storeToken(token, expiresIn) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    if (typeof expiresIn === 'number' && Number.isFinite(expiresIn)) {
        const expiresAt = Date.now() + expiresIn * 1000;
        localStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
    } else {
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
}

export function getStoredToken() {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
        return null;
    }
    const rawExpiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (rawExpiry) {
        const expiresAt = Number(rawExpiry);
        if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
            clearAuthData();
            return null;
        }
    }
    return token;
}

export async function authorizedFetch(url, options = {}) {
    const token = getStoredToken();
    if (!token) {
        throw new Error('NOT_AUTHENTICATED');
    }
    const finalOptions = { ...options };
    const headers = new Headers(finalOptions.headers || {});
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${token}`);
    finalOptions.headers = headers;

    const response = await fetch(url, finalOptions);
    if (response.status === 401) {
        clearAuthData();
        throw new Error('Unauthorized');
    }
    return response;
}
