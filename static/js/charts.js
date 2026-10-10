/* GymPulse AI - Chart.js helpers */
(function () {
  "use strict";
  const ACCENT = "#19e68c", LIME = "#b6ff3b", RED = "#ff5f6d", BLUE = "#7aa7ff";
  const registry = {};

  function baseOptions(extra) {
    const reduce = window.GP && GP.reduceMotion;
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : { duration: 800, easing: "easeOutQuart" },
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false, labels: { color: "#8fa0a4", boxWidth: 10 } },
        tooltip: {
          backgroundColor: "#111a1d", borderColor: "rgba(255,255,255,.12)", borderWidth: 1,
          titleColor: "#e8f1ef", bodyColor: "#c7d6d4", padding: 10, displayColors: false
        }
      },
      scales: {
        x: { grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#8fa0a4", maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#8fa0a4", font: { size: 10 }, precision: 0 } }
      }
    }, extra || {});
  }

  function gradient(ctx, color) {
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, color + "66");
    g.addColorStop(1, color + "05");
    return g;
  }

  function render(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return null;
    if (registry[id]) { registry[id].destroy(); }
    registry[id] = new Chart(canvas.getContext("2d"), config);
    return registry[id];
  }

  window.GPCharts = {
    colors: { ACCENT, LIME, RED, BLUE },

    line(id, labels, values, label, color) {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      color = color || ACCENT;
      return render(id, {
        type: "line",
        data: { labels: labels, datasets: [{
          label: label, data: values, borderColor: color, borderWidth: 2,
          backgroundColor: gradient(canvas.getContext("2d"), color),
          fill: true, tension: 0.35, pointRadius: labels.length > 40 ? 0 : 3,
          pointBackgroundColor: color
        }] },
        options: baseOptions()
      });
    },

    bar(id, labels, values, label, color) {
      return render(id, {
        type: "bar",
        data: { labels: labels, datasets: [{
          label: label, data: values, backgroundColor: (color || ACCENT) + "cc",
          borderRadius: 7, borderSkipped: false, maxBarThickness: 34
        }] },
        options: baseOptions()
      });
    },

    doughnut(id, labels, values) {
      const palette = [ACCENT, LIME, BLUE, "#ffb648", "#ff8fab", "#9b8bff", "#4fd1c5", RED];
      return render(id, {
        type: "doughnut",
        data: { labels: labels, datasets: [{
          data: values, backgroundColor: palette, borderColor: "#10161a", borderWidth: 2, hoverOffset: 8
        }] },
        options: baseOptions({
          cutout: "62%",
          scales: {},
          plugins: {
            legend: { display: true, position: "bottom", labels: { color: "#8fa0a4", boxWidth: 10, font: { size: 11 } } },
            tooltip: { backgroundColor: "#111a1d", padding: 10 }
          }
        })
      });
    },

    multiLine(id, series) {
      const palette = [ACCENT, LIME, BLUE, "#ffb648", "#ff8fab"];
      const labels = Array.from(new Set([].concat.apply([], series.map((s) => s.labels)))).sort();
      return render(id, {
        type: "line",
        data: {
          labels: labels,
          datasets: series.map((s, i) => ({
            label: s.exercise,
            data: labels.map((l) => {
              const idx = s.labels.indexOf(l);
              return idx === -1 ? null : s.values[idx];
            }),
            borderColor: palette[i % palette.length],
            backgroundColor: palette[i % palette.length],
            spanGaps: true, tension: 0.3, borderWidth: 2, pointRadius: 3
          }))
        },
        options: baseOptions({ plugins: { legend: { display: true, position: "bottom", labels: { color: "#8fa0a4", boxWidth: 10, font: { size: 10 } } } } })
      });
    },

    empty(id, message) {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      if (registry[id]) { registry[id].destroy(); delete registry[id]; }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#8fa0a4";
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(message || "No data yet", canvas.width / 2, canvas.height / 2);
    }
  };
})();
