export let skillChart = null;

export function renderSkillChart(ctx, data) {
    const labels = [
        'Controle de Bola', 'Drible', 'Passe Curto', 'Passe Longo', 'Finalizacao',
        'Cabeceio', 'Desarme', 'Visao de Jogo', 'Compostura', 'Agressividade'
    ];

    if (skillChart) skillChart.destroy();

    skillChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [{
                label: 'Habilidades Tecnicas',
                data: data,
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                borderColor: 'rgba(34, 197, 94, 1)',
                pointBackgroundColor: 'rgba(34, 197, 94, 1)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgba(34, 197, 94, 1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    angleLines: { color: 'rgba(255, 255, 255, 0.1)' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    pointLabels: { color: '#9ca3af', font: { size: 12 } },
                    ticks: { backdropColor: 'transparent', color: 'transparent', stepSize: 2, max: 10, min: 0 }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}
