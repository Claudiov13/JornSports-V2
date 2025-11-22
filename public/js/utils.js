export function safeHtml(html) {
    // Assumes DOMPurify is available globally or we should import it if we use a bundler.
    // For now, we assume it's loaded via script tag in index.html
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(String(html || ""));
    }
    return String(html || "").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sanitizeCode(value) {
    return (value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
}

export function suggestCodeFromName(value, fallback) {
    const cleaned = sanitizeCode(value).slice(0, 3);
    if (cleaned.length === 3) {
        return cleaned;
    }
    const filler = (fallback || 'AAA');
    return (cleaned + filler).slice(0, 3);
}
