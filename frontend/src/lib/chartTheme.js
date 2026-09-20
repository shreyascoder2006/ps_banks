export const chartColors = {
  gold: '#d4af37',
  goldLight: '#f0d878',
  blue: '#38bdf8',
  green: '#34d399',
  red: '#f43f5e',
  grid: 'rgba(255,255,255,0.06)',
  text: '#8b93a7',
};

export function baseGridOptions(overrides = {}) {
  return {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { color: chartColors.text, font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 6 },
      },
      tooltip: {
        backgroundColor: '#111f3d',
        borderColor: 'rgba(212,175,55,0.2)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#c3c9d6',
        padding: 10,
        cornerRadius: 8,
        titleFont: { family: 'Inter', weight: '600' },
        bodyFont: { family: 'Inter' },
      },
    },
    scales: {
      x: {
        grid: { color: chartColors.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: chartColors.text, font: { family: 'Inter', size: 11 } },
      },
      y: {
        grid: { color: chartColors.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: chartColors.text, font: { family: 'Inter', size: 11 } },
      },
    },
    ...overrides,
  };
}
