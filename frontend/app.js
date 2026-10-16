// Đăng ký service worker cho PWA (chỉ khi chạy qua http/https, không phải file://).
(function () {
  if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("sw.js")
        .then(function (reg) {
          console.log("[sop] Service worker đã đăng ký:", reg.scope);
        })
        .catch(function (err) {
          console.warn("[sop] Không đăng ký được service worker:", err);
        });
    });
  }
})();
