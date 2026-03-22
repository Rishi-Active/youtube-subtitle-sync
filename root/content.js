let currentOffset = 0; // In seconds
let urlChangeInterval = null;
let currentVideoId = null;

let subtitleEvents = [];
let renderLoopId = null;

let userSettings = {
  fontSize: 100,
  position: 5,
  spacing: 120,
  align: 'center',
  hideNative: true
};

// Initialize on load
console.log('YouTube Subtitle Sync extension initialized');
init();

function init() {
  // Inject interceptor script into MAIN world
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'setOffset') {
      currentOffset = request.offset;
      applyAndSaveOffset(currentOffset);
      sendResponse({ status: "success" });
    } else if (request.action === 'setSettings') {
      userSettings = request.settings;
      updateContainerStyles();
      sendResponse({ status: "success" });
    }
    return true;
  });

  // Listen for intercepted subtitle data from inject.js
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'YT_SYNC_SUBTITLE_DATA') {
      subtitleEvents = event.data.events;
      startCustomRenderer();
    }
  });

  // Load global settings immediately
  chrome.storage.local.get(['yt_sync_global_settings'], (result) => {
    if (result.yt_sync_global_settings) {
      userSettings = { ...userSettings, ...result.yt_sync_global_settings };
      updateContainerStyles();
    }
  });

  // Track URL changes (YouTube is a SPA)
  urlChangeInterval = setInterval(checkUrlChange, 1000);
  checkUrlChange();
  
  // Apply keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
}

function handleKeyboardShortcuts(e) {
  // Alt+Shift+Left/Right
  if (e.altKey && e.shiftKey) {
    if (e.key === 'ArrowRight') {
      currentOffset = parseFloat((currentOffset + 0.1).toFixed(1));
      applyAndSaveOffset(currentOffset);
    } else if (e.key === 'ArrowLeft') {
      currentOffset = parseFloat((currentOffset - 0.1).toFixed(1));
      applyAndSaveOffset(currentOffset);
    }
  }
}

function applyAndSaveOffset(offset) {
  showNotification(`Subtitle offset: ${offset > 0 ? '+' : ''}${offset.toFixed(1)}s`);
  if (currentVideoId) {
    chrome.storage.local.set({ [`yt_sync_${currentVideoId}`]: offset });
  }
}

function checkUrlChange() {
  const newVideoId = new URL(window.location.href).searchParams.get('v');
  if (newVideoId && newVideoId !== currentVideoId) {
    currentVideoId = newVideoId;
    subtitleEvents = [];
    stopCustomRenderer();
    loadSavedOffset(currentVideoId);
  } else if (!newVideoId && currentVideoId) {
    currentVideoId = null;
    currentOffset = 0;
    subtitleEvents = [];
    stopCustomRenderer();
  }
}

function loadSavedOffset(videoId) {
  chrome.storage.local.get(`yt_sync_${videoId}`, (result) => {
    const savedOffset = result[`yt_sync_${videoId}`];
    if (savedOffset !== undefined) {
      currentOffset = savedOffset;
      showNotification(`Sync loaded: ${currentOffset > 0 ? '+' : ''}${currentOffset.toFixed(1)}s`);
    } else {
      currentOffset = 0;
    }
  });
}

function getOrCreateSubtitleContainer() {
  let container = document.getElementById('yt-sync-custom-subs');
  if (!container) {
    const player = document.querySelector('.html5-video-player') || document.body;
    container = document.createElement('div');
    container.id = 'yt-sync-custom-subs';
    container.style.cssText = `
      position: absolute;
      left: 0;
      width: 100%;
      pointer-events: none;
      z-index: 999;
      display: flex;
      flex-direction: column;
    `;
    player.appendChild(container);
    
    // Hide native subtitles via CSS fallback
    const style = document.createElement('style');
    style.id = 'yt-sync-hide-native';
    style.textContent = `
      .ytp-caption-window-container, 
      #ytp-caption-window-container,
      .caption-window {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      .ytp-caption-segment {
        color: transparent !important;
        background: transparent !important;
        text-shadow: none !important;
      }
    `;
    document.head.appendChild(style);
  }
  updateContainerStyles();
  return container;
}

function updateContainerStyles() {
  const container = document.getElementById('yt-sync-custom-subs');
  if (container) {
    container.style.bottom = `${userSettings.position}%`;
    container.style.alignItems = userSettings.align === 'left' ? 'flex-start' : (userSettings.align === 'right' ? 'flex-end' : 'center');
    container.style.textAlign = userSettings.align;
  }
}

function stopCustomRenderer() {
  if (renderLoopId) {
    cancelAnimationFrame(renderLoopId);
    renderLoopId = null;
  }
  const container = document.getElementById('yt-sync-custom-subs');
  if (container) container.innerHTML = '';
  
  const style = document.getElementById('yt-sync-hide-native');
  if (style) style.remove();
}

function startCustomRenderer() {
  stopCustomRenderer(); // ensure no duplicates
  
  const container = getOrCreateSubtitleContainer();
  const video = document.querySelector('video');
  
  function renderLoop() {
    if (!video || subtitleEvents.length === 0) {
      renderLoopId = requestAnimationFrame(renderLoop);
      return;
    }

    // Is CC turn on? We check native CC button state to know if we should render
    const ccButton = document.querySelector('.ytp-subtitles-button');
    const isCcOn = ccButton && ccButton.getAttribute('aria-pressed') === 'true';
    
    // Rigorous hiding of native subtitles using Javascript on EVERY frame it's enabled
    if (isCcOn && userSettings.hideNative) {
      const nativeCaps = document.querySelectorAll('.ytp-caption-window-container, .caption-window, ytd-transcript-segment-renderer, .ytp-caption-segment, .ytp-caption-segment-window');
      for (let el of nativeCaps) {
        if (el.style.display !== 'none' || el.style.opacity !== '0') {
          el.style.setProperty('display', 'none', 'important');
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
    }
    
    if (!isCcOn) {
      container.innerHTML = '';
      renderLoopId = requestAnimationFrame(renderLoop);
      return;
    }

    const effectiveTimeMs = (video.currentTime * 1000) - (currentOffset * 1000);
    let activeHtml = '';
    
    // Find matching events
    for (const evt of subtitleEvents) {
      const start = evt.tStartMs;
      const end = start + (evt.dDurationMs || 0);
      
      if (effectiveTimeMs >= start && effectiveTimeMs <= end && evt.segs) {
        // Build the text line
        let lineText = '';
        for (const seg of evt.segs) {
          if (seg.utf8) {
            lineText += seg.utf8;
          }
        }
        
        if (lineText.trim()) {
          let lineHtml = lineText.replace(/\n/g, '<br>');
          const fontSize = getFontSize() * (userSettings.fontSize / 100);
          activeHtml += `<div style="
            background: rgba(8, 8, 8, 0.85);
            color: white;
            padding: 4px 16px;
            border-radius: 4px;
            font-size: ${fontSize}px;
            line-height: ${userSettings.spacing}%;
            font-family: 'YouTube Noto', Roboto, Arial, sans-serif;
            text-shadow: 0 0 2px rgba(0,0,0,0.5);
            margin: 1px 0;
            display: inline-block;
            white-space: pre-wrap;
          ">${lineHtml}</div>`;
        }
      }
    }

    if (container.innerHTML !== activeHtml) {
      container.innerHTML = activeHtml;
    }
    
    renderLoopId = requestAnimationFrame(renderLoop);
  }
  
  renderLoopId = requestAnimationFrame(renderLoop);
}

function getFontSize() {
  const player = document.querySelector('.html5-video-player');
  if (!player) return 18;
  const width = player.clientWidth;
  if (width < 600) return 14;
  if (width < 1000) return 18;
  if (width < 1500) return 22;
  return 26;
}

// Display a transient notification on the YouTube player
function showNotification(text) {
  const container = document.querySelector('.html5-video-player') || document.body;
  
  let notif = document.getElementById('yt-sync-notification');
  if (!notif) {
    notif = document.createElement('div');
    notif.id = 'yt-sync-notification';
    notif.style.cssText = `
      position: absolute;
      top: 10%;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 10px 20px;
      border-radius: 4px;
      font-size: 16px;
      font-family: Roboto, Arial, sans-serif;
      z-index: 9999;
      pointer-events: none;
      transition: opacity 0.3s;
      opacity: 0;
    `;
    container.appendChild(notif);
  }
  
  notif.textContent = text;
  notif.style.opacity = '1';
  
  if (window.ytSyncNotifTimeout) {
    clearTimeout(window.ytSyncNotifTimeout);
  }
  
  window.ytSyncNotifTimeout = setTimeout(() => {
    notif.style.opacity = '0';
  }, 2000);
}
