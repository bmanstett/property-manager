"use strict";
(() => {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    money:
      '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 9h18m-6 6h3"/><path d="m5 5 12-3 1 3"/>',
    leases:
      '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 0v5h5M8 12h8m-8 4h5"/>',
    documents:
      '<path d="M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    tasks:
      '<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 3h6v4H9zm-2 11 3 3 6-6"/>',
    settings:
      '<path d="m10 3-.5 2-2 .9-2-.6-2 3.4 1.6 1.5v2.5l-1.6 1.6 2 3.5 2.1-.6 1.9 1 .5 2.1h4l.5-2.1 1.9-1 2.1.6 2-3.5-1.6-1.6v-2.5l1.6-1.5-2-3.4-2 .6-2-.9-.5-2z"/><circle cx="12" cy="11.8" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 5 1c-.6 1.7-2.5 1.5-2.5 3.6m0 2.9h.01"/>',
    shield:
      '<path d="m12 3 8 3v5c0 5.5-4.1 8.8-8 10-3.9-1.2-8-4.5-8-10V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    backup:
      '<path d="M6 17a4 4 0 0 1-.4-8A6.5 6.5 0 0 1 18 8.4a4.5 4.5 0 0 1 .5 8.8M12 21V11m-3 3 3-3 3 3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-8 12h4"/>',
    user: '<circle cx="12" cy="9" r="3.5"/><path d="M5 20c.5-6 13.5-6 14 0"/>',
    up: '<path d="M7 17 17 7M7 7h10v10"/>',
    down: '<path d="m17 7-10 10m10 0H7V7"/>',
    uptrend: '<path d="m3 17 6-6 4 4 8-9m-7 0h7v7"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
    chevrons: '<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    drop: '<path d="m6 9 6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    checkcircle: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    receipt:
      '<path d="M6 3 8 5l2-2 2 2 2-2 2 2 2-2v18l-2-2-2 2-2-2-2 2-2-2-2 2z"/><path d="M9 9h6m-6 4h6"/>',
    camera:
      '<path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/>',
    file: '<path d="M5 3h9l5 5v13H5zm9 0v5h5M8 12h8m-8 4h5"/>',
    chart: '<path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9"/>',
    building:
      '<path d="M3 21h18M5 21V8l7-4 7 4v13m-10-9h.01M15 12h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
    box: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 7h18l-2-4H5zm6 4h6"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    tools:
      '<path d="m20 3-4 4 1 3 3 1 3-4a6 6 0 0 1-8 8l-6 6a2 2 0 0 1-3-3l6-6a6 6 0 0 1 8-9Z" transform="translate(-1 0)"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13m-18-12h.01M3 12h.01M3 18h.01"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    sample:
      '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9"/>',
    leaf: '<path d="M4 20C4 9 13 4 21 3c0 9-4 18-15 15m-2 2L16 8"/>',
  };
  window.ico = (name, size = 20) =>
    `<svg width="${Number(size) || 20}" height="${Number(size) || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  window.brandmark =
    '<svg viewBox="0 0 40 42" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3 20 19 6l16 14M8 22 19 12l11 10v13H9V24m6 11V23l4-4 4 4v12"/></svg>';
})();
