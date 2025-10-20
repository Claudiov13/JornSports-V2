document.addEventListener('DOMContentLoaded', () => {
  const API_BASE_URL = 'http://127.0.0.1:8000';
  const TOKEN_STORAGE_KEY = 'jornAuthToken';

  // elementos
  const tbl = document.getElementById('players-table');
  const btnRefresh = document.getElementById('players-refresh');
  const q = document.getElementById('players-search');

  const modal = document.getElementById('player-detail-modal');
  const closeModalBtn = document.getElementById('close-player-modal');
  const initialsEl = document.getElementById('player-detail-initials');
  const nameEl = document.getElementById('player-detail-name');
  const metaEl = document.getElementById('player-detail-meta');
  const unreadEl = document.getElementById('player-detail-unread');
  const metricFilter = document.getElementById('metric-filter');
  const measurementsTable = document.getElementById('measurements-table');
  const playerAlerts = document.getElementById('player-alerts');
  const playerReports = document.getElementById('player-reports');

  let metricChart = null;
  let currentPlayerId = null;
  let cacheList = [];

  function token() { return localStorage.getItem(TOKEN_STORAGE_KEY); }

  async function af(url, options={}) {
    const t = token();
    if (!t) { window.location.href = '/public/index.html#auth-section'; throw new Error('sem token'); }
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + t);
    if (!headers.has('Accept')) headers.set('Accept','application/json');
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) { window.location.href = '/public/index.html#auth-section'; throw new Error('401'); }
    return res;
  }

  function safeHtml(s){ return DOMPurify.sanitize(String(s ?? '')); }
  function initials(name, id){
    const n = (name || '').trim();
    if (n) {
      const parts = n.split(/\s+/);
      const a = parts[0]?.[0] || '';
      const b = parts.slice(-1)[0]?.[0] || '';
      const r = (a+b).toUpperCase();
      if (r.trim()) return r;
    }
    return String(id || '??').slice(0,2).toUpperCase();
  }

  async function loadPlayers() {
    tbl.innerHTML = `<tr><td colspan="5" class="px-3 py-6 text-center text-white/70">Carregando...</td></tr>`;
    try {
      const r = await af(`${API_BASE_URL}/api/players`);
      if (!r.ok) throw new Error('Falha ao listar atletas');
      cacheList = await r.json();
      renderTable();
    } catch (e) {
      tbl.innerHTML = `<tr><td colspan="5" class="px-3 py-6 text-center text-red-300">Erro ao carregar atletas.</td></tr>`;
    }
  }

  function renderTable() {
    const term = (q?.value || '').toLowerCase().trim();
    const rows = (cacheList || []).filter(p => {
      const name = ((p.first_name||'') + ' ' + (p.last_name||'')).toLowerCase();
      return !term || name.includes(term) || String(p.id).toLowerCase().includes(term);
    });

    if (rows.length === 0) {
      tbl.innerHTML = `<tr><td colspan="5" class="px-3 py-6 text-center text-white/60">Nenhum atleta encontrado.</td></tr>`;
      return;
    }

    tbl.innerHTML = '';
    rows.forEach(p => {
      const full = `${p.first_name||''} ${p.last_name||''}`.trim() || '—';
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-white/5';
      tr.innerHTML = `
        <td class="px-3 py-3">
          <div class="flex items-center gap-2">
            <div class="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">${initials(full, p.id)}</div>
            <div>
              <div class="font-medium">${safeHtml(full)}</div>
              <div class="text-[11px] text-white/50 font-mono">${safeHtml(p.id)}</div>
            </div>
          </div>
        </td>
        <td class="px-3 py-3">${p.metrics_count ?? '—'}</td>
        <td class="px-3 py-3">${p.last_measurement_at ? new Date(p.last_measurement_at).toLocaleString('pt-BR') : '—'}</td>
        <td class="px-3 py-3">${p.alerts_unread ?? 0}</td>
        <td class="px-3 py-3 text-right">
          <button class="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-sm view-btn" data-id="${p.id}">Ver</button>
        </td>
      `;
      tbl.appendChild(tr);
    });

    tbl.querySelectorAll('.view-btn').forEach(b=>{
      b.addEventListener('click', ()=> openDetail(b.dataset.id));
    });
  }

  async function openDetail(id) {
    currentPlayerId = id;
    // limpa
    initialsEl.textContent = '??';
    nameEl.textContent = '—';
    metaEl.textContent = '';
    unreadEl.textContent = '0';
    metricFilter.innerHTML = '';
    measurementsTable.innerHTML = '';
    playerAlerts.innerHTML = '';
    playerReports.innerHTML = '';
    drawChart([], []);

    // perfil
    try {
      const r = await af(`${API_BASE_URL}/api/players/${id}`);
      if (r.ok) {
        const p = await r.json();
        const full = `${p.first_name||''} ${p.last_name||''}`.trim();
        initialsEl.textContent = initials(full, p.id);
        nameEl.textContent = full || p.id;
        metaEl.textContent = p.age ? `${p.age} anos` : '';
      }
    } catch {}

    // alertas
    try {
      const r = await af(`${API_BASE_URL}/api/players/${id}/alerts`);
      const items = r.ok ? await r.json() : [];
      unreadEl.textContent = String(items.filter(a => !a.acknowledged).length);
      if (!items.length) {
        playerAlerts.innerHTML = `<p class="text-white/60 text-sm">Sem alertas.</p>`;
      } else {
        playerAlerts.innerHTML = '';
        items.forEach(a=>{
          const d = document.createElement('div');
          d.className = 'text-sm bg-white/5 border border-white/10 rounded-md p-2';
          d.innerHTML = `
            <div class="flex items-center justify-between">
              <span class="text-teal-300 font-medium">${safeHtml(a.metric||'')}</span>
              <span class="text-[11px] text-white/50">${a.generated_at ? new Date(a.generated_at).toLocaleString('pt-BR') : ''}</span>
            </div>
            <div class="text-white/90">${safeHtml(a.message||'')}</div>
          `;
          playerAlerts.appendChild(d);
        });
      }
    } catch {}

    // relatórios
    try {
      const r = await af(`${API_BASE_URL}/api/players/${id}/reports`);
      const reps = r.ok ? await r.json() : [];
      if (!reps.length) {
        playerReports.innerHTML = `<p class="text-white/60 text-sm">Sem relatórios.</p>`;
      } else {
        playerReports.innerHTML = '';
        reps.forEach(rep=>{
          const when = rep.date ? new Date(rep.date).toLocaleString('pt-BR') : '';
          const item = document.createElement('div');
          item.className = 'text-sm bg-white/5 border border-white/10 rounded-md p-2 cursor-pointer hover:bg-white/10';
          item.innerHTML = `
            <div class="flex items-center justify-between">
              <span class="font-medium">${safeHtml(rep.athlete_name || 'Relatório')}</span>
              <span class="text-[11px] text-white/50">${when}</span>
            </div>
          `;
          item.addEventListener('click', ()=>{
            // abre a home com o relatório renderizado (reuso do fluxo atual)
            localStorage.setItem('jorn_last_report_payload', JSON.stringify(rep));
            window.location.href = '/public/index.html#results';
          });
          playerReports.appendChild(item);
        });
      }
    } catch {}

    // medições: descobrir métricas e desenhar
    try {
      const r = await af(`${API_BASE_URL}/api/players/${id}/measurements`);
      const items = r.ok ? await r.json() : [];
      const metrics = Array.from(new Set(items.map(i=>i.metric))).sort();
      metricFilter.innerHTML = '';
      if (!metrics.length) {
        metricFilter.innerHTML = `<option>Sem métricas</option>`;
        measurementsTable.innerHTML = `<tr><td colspan="4" class="px-3 py-3 text-white/60 text-center">Sem dados.</td></tr>`;
      } else {
        metrics.forEach(m=>{
          const o = document.createElement('option');
          o.value = m; o.textContent = m; metricFilter.appendChild(o);
        });
        metricFilter.onchange = ()=> loadSeries(id, metricFilter.value);
        await loadSeries(id, metrics[0]);
      }
    } catch {}

    // exibe modal
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  async function loadSeries(id, metric) {
    try {
      const r = await af(`${API_BASE_URL}/api/players/${id}/measurements?metric=${encodeURIComponent(metric)}`);
      const items = r.ok ? await r.json() : [];
      // ordena cronologicamente
      const sorted = items.slice().sort((a,b)=> new Date(a.recorded_at)-new Date(b.recorded_at));
      const labels = sorted.map(i => new Date(i.recorded_at).toLocaleDateString('pt-BR'));
      const data = sorted.map(i => Number(i.value || 0));
      drawChart(labels, data);
      renderMeasurementsTable(items);
    } catch {
      drawChart([], []);
      renderMeasurementsTable([]);
    }
  }

  function renderMeasurementsTable(items){
    measurementsTable.innerHTML = '';
    if (!items || !items.length) {
      measurementsTable.innerHTML = `<tr><td colspan="4" class="px-3 py-3 text-white/60 text-center">Sem dados.</td></tr>`;
      return;
    }
    items.slice().sort((a,b)=> new Date(b.recorded_at)-new Date(a.recorded_at)).forEach(i=>{
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-white/5';
      tr.innerHTML = `
        <td class="px-3 py-2">${i.recorded_at ? new Date(i.recorded_at).toLocaleString('pt-BR') : '—'}</td>
        <td class="px-3 py-2">${safeHtml(i.metric||'')}</td>
        <td class="px-3 py-2">${Number(i.value ?? 0)}</td>
        <td class="px-3 py-2">${safeHtml(i.unit || '')}</td>
      `;
      measurementsTable.appendChild(tr);
    });
  }

  function drawChart(labels, data){
    const ctx = document.getElementById('metricChart').getContext('2d');
    if (metricChart) metricChart.destroy();
    metricChart = new Chart(ctx, {
      type: 'line',
      data: { labels: labels || [], datasets: [{ label:'Valor', data: data || [], borderWidth:2, pointRadius:2, fill:false }] },
      options: { responsive:true, scales:{ y:{ beginAtZero:false } } }
    });
  }

  function closeModal(){
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    if (metricChart) { metricChart.destroy(); metricChart = null; }
    currentPlayerId = null;
  }

  btnRefresh?.addEventListener('click', loadPlayers);
  q?.addEventListener('input', renderTable);
  closeModalBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('click', (e)=>{ if (e.target === modal) closeModal(); });

  // bootstrap
  loadPlayers();
});
