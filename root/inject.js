// This script runs in the page context (MAIN world) to intercept YouTube's subtitle data.

// Intercept window.fetch for subtitle data
const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
  
  if (url.includes('/api/timedtext')) {
    try {
      const response = await originalFetch.apply(this, args);
      // Clone it so we don't consume the original response body
      const clonedResponse = response.clone();
      
      const text = await clonedResponse.text();
      
      // Send the intercepted subtitle data to our content script
      if (url.includes('fmt=json3') || text.trim().startsWith('{')) {
        try {
          const json = JSON.parse(text);
          if (json.events && Array.isArray(json.events)) {
            window.postMessage({
              type: 'YT_SYNC_SUBTITLE_DATA',
              events: json.events
            }, '*');
          }
        } catch (e) {
          console.error('[YT Sync] Error parsing JSON:', e);
        }
      }

      return response;
    } catch (err) {
      return originalFetch.apply(this, args);
    }
  }

  return originalFetch.apply(this, args);
};

// Also intercept XMLHttpRequest
const originalXhrOpen = XMLHttpRequest.prototype.open;
const originalXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._url = url;
  return originalXhrOpen.call(this, method, url, ...rest);
};

XMLHttpRequest.prototype.send = function(body) {
  if (typeof this._url === 'string' && this._url.includes('/api/timedtext')) {
    this.addEventListener('load', function() {
      try {
        if (this.responseText && (this._url.includes('fmt=json3') || this.responseText.trim().startsWith('{'))) {
          const json = JSON.parse(this.responseText);
          if (json.events && Array.isArray(json.events)) {
            window.postMessage({
              type: 'YT_SYNC_SUBTITLE_DATA',
              events: json.events
            }, '*');
          }
        }
      } catch (e) {}
    });
  }
  return originalXhrSend.call(this, body);
};
