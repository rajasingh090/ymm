/* GymPulse AI - shared frontend helpers */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const GP = {
    today: (window.GYMPULSE && window.GYMPULSE.today) || new Date().toISOString().slice(0, 10),
    muscles: (window.GYMPULSE && window.GYMPULSE.muscles) || [],
    settings: (window.GYMPULSE && window.GYMPULSE.settings) || {},
    reduceMotion,

    async api(url, options) {
      const opts = Object.assign({ headers: { "Content-Type": "application/json" } }, options || {});
      const res = await fetch(url, opts);
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        const err = new Error((data && data.error) || "Request failed (" + res.status + ")");
        err.status = res.status; err.data = data;
        throw err;
      }
      return data;
    },

    toast(message, isError) {
      const el = document.getElementById("toast");
      if (!el) return;
      el.textContent = message;
      el.classList.toggle("error", !!isError);
      el.classList.add("show");
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove("show"), 2800);
    },

    icons() { if (window.lucide) window.lucide.createIcons(); },

    reveal(root) {
      const nodes = (root || document).querySelectorAll(".reveal:not(.visible)");
      if (reduceMotion || !("IntersectionObserver" in window)) {
        nodes.forEach((n) => n.classList.add("visible"));
        return;
      }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
          if (entry.isIntersecting) {
            setTimeout(() => entry.target.classList.add("visible"), i * 45);
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 });
      nodes.forEach((n) => io.observe(n));
    },

    counters(root) {
      (root || document).querySelectorAll(".counter").forEach((el) => {
        const target = parseFloat(el.dataset.value || "0");
        const decimals = parseInt(el.dataset.decimals || "0", 10);
        const suffix = el.dataset.suffix || "";
        if (reduceMotion) { el.textContent = target.toFixed(decimals) + suffix; return; }
        const duration = 900;
        const t0 = performance.now();
        function step(now) {
          const p = Math.min((now - t0) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (target * eased).toFixed(decimals) + suffix;
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    },

    escape(str) {
      return String(str == null ? "" : str).replace(/[&<>"']/g, (c) => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
      ));
    },

    fmtDate(iso) {
      const d = new Date(iso + "T00:00:00");
      if (isNaN(d)) return iso;
      return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    },

    fmtDuration(min) {
      min = Math.round(min || 0);
      if (min < 60) return min + " min";
      return Math.floor(min / 60) + "h " + (min % 60) + "m";
    },

    statusLabel(status) {
      return { went: "Went to gym", missed: "Did not go", rest: "Planned rest day",
               unrecorded: "Not recorded", future: "Upcoming" }[status] || status;
    }
  };

  window.GP = GP;

  document.addEventListener("DOMContentLoaded", () => {
    GP.icons();
    GP.reveal();
    GP.counters();
    setTimeout(GP.icons, 400);
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
})();
