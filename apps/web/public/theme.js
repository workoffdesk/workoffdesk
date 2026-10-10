// The colours chosen in Settings, set before the first paint; src/looks.ts keeps them after.
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem('workoffdesk.theme');
  } catch {
    // Storage can be blocked; following the device still works.
  }
  if (theme !== 'light' && theme !== 'dark' && theme !== 'eye') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
})();
