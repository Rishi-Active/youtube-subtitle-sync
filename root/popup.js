// Generate a unique ID for the current video to save its specific offset
function getVideoId(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtube.com') && urlObj.searchParams.has('v')) {
      return urlObj.searchParams.get('v');
    }
  } catch (e) {
    console.error('Invalid URL:', url);
  }
  return null;
}

// Global state
let currentOffset = 0;
let currentSettings = {
  fontSize: 100,
  position: 5,
  spacing: 120,
  align: 'center',
  hideNative: true
};
let currentVideoId = null;

// Update the UI
function updateUI(offset) {
  const display = document.getElementById('offset-display');
  const sign = offset > 0 ? '+' : (offset < 0 ? '-' : '');
  display.textContent = `${sign}${Math.abs(offset).toFixed(1)}s`;
  
  if (offset === 0) {
    display.style.color = 'var(--text)';
  } else if (offset > 0) {
    display.style.color = '#00C851'; // Green for delaying
  } else {
    display.style.color = '#ff4444'; // Red for advancing
  }
}

function updateSettingsUI() {
  document.getElementById('setting-font-size').value = currentSettings.fontSize;
  document.getElementById('setting-position').value = currentSettings.position;
  document.getElementById('setting-spacing').value = currentSettings.spacing;
  document.getElementById('setting-align').value = currentSettings.align;
  document.getElementById('setting-hide-native').checked = currentSettings.hideNative;
}

// Send the offset value to the content script
function sendOffsetToContentScript(offset, videoId) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url.includes('youtube.com/watch')) {
      chrome.tabs.sendMessage(activeTab.id, { 
        action: 'setOffset', 
        offset: offset 
      }).then(() => {
        document.getElementById('status-text').textContent = 'Applied';
        setTimeout(() => { document.getElementById('status-text').textContent = 'Ready'; }, 2000);
      }).catch((err) => {
        document.getElementById('status-text').textContent = 'Reload page first';
      });
      
      if (videoId) {
        chrome.storage.local.set({ [`yt_sync_${videoId}`]: offset });
      }
    }
  });
}

function sendSettingsToContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url.includes('youtube.com/watch')) {
      chrome.tabs.sendMessage(activeTab.id, { 
        action: 'setSettings', 
        settings: currentSettings 
      }).catch((err) => {});
      
      // Save global settings
      chrome.storage.local.set({ yt_sync_global_settings: currentSettings });
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // Initialize
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url.includes('youtube.com/watch')) {
      currentVideoId = getVideoId(activeTab.url);
      
      // Load global settings
      chrome.storage.local.get(['yt_sync_global_settings'], (result) => {
        if (result.yt_sync_global_settings) {
          currentSettings = { ...currentSettings, ...result.yt_sync_global_settings };
        }
        updateSettingsUI();
        sendSettingsToContentScript();
      });

      // Load specific video offset
      if (currentVideoId) {
        chrome.storage.local.get(`yt_sync_${currentVideoId}`, (result) => {
          const savedOffset = result[`yt_sync_${currentVideoId}`];
          if (savedOffset !== undefined) {
            currentOffset = savedOffset;
            updateUI(currentOffset);
          }
        });
      }
    } else {
      document.getElementById('status-text').textContent = 'Navigate to a YouTube video';
      document.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
    }
  });

  // Adjust timing
  function adjustOffset(delta) {
    currentOffset = parseFloat((currentOffset + delta).toFixed(1));
    updateUI(currentOffset);
    sendOffsetToContentScript(currentOffset, currentVideoId);
  }

  document.getElementById('btn-plus-05').addEventListener('click', () => adjustOffset(0.5));
  document.getElementById('btn-plus-01').addEventListener('click', () => adjustOffset(0.1));
  document.getElementById('btn-minus-05').addEventListener('click', () => adjustOffset(-0.5));
  document.getElementById('btn-minus-01').addEventListener('click', () => adjustOffset(-0.1));
  
  document.getElementById('btn-apply-custom').addEventListener('click', () => {
    const customValue = parseFloat(document.getElementById('custom-offset-input').value);
    if (!isNaN(customValue)) {
      currentOffset = parseFloat(customValue.toFixed(2));
      updateUI(currentOffset);
      sendOffsetToContentScript(currentOffset, currentVideoId);
    }
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    currentOffset = 0;
    document.getElementById('custom-offset-input').value = '';
    updateUI(currentOffset);
    sendOffsetToContentScript(currentOffset, currentVideoId);
  });

  // Settings
  function handleSettingChange(e) {
    const id = e.target.id;
    if (id === 'setting-font-size') currentSettings.fontSize = parseInt(e.target.value, 10);
    if (id === 'setting-position') currentSettings.position = parseInt(e.target.value, 10);
    if (id === 'setting-spacing') currentSettings.spacing = parseInt(e.target.value, 10);
    if (id === 'setting-align') currentSettings.align = e.target.value;
    if (id === 'setting-hide-native') currentSettings.hideNative = e.target.checked;
    
    sendSettingsToContentScript();
  }

  document.getElementById('setting-font-size').addEventListener('input', handleSettingChange);
  document.getElementById('setting-position').addEventListener('input', handleSettingChange);
  document.getElementById('setting-spacing').addEventListener('input', handleSettingChange);
  document.getElementById('setting-align').addEventListener('change', handleSettingChange);
  document.getElementById('setting-hide-native').addEventListener('change', handleSettingChange);
});
