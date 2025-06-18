import Promise from 'bluebird';
import sanitize from 'sanitize-filename';

class Browser {
  static isValidUrl(url) {
    let matchesInvalid = false;
    let matchesValid = true;
    const invalidRegex = [/epub\.press/i, /chrome:\/\//i, /localhost/i];
    const validRegex = [/http/i];

    invalidRegex.forEach((regex) => {
      matchesInvalid = matchesInvalid || regex.test(url);
    });

    validRegex.forEach((regex) => {
      matchesValid = matchesValid && regex.test(url);
    });

    return !matchesInvalid && matchesValid;
  }

  static filterUrls(urls) {
    return (urls || []).filter(Browser.isValidUrl);
  }

  static isBackgroundMsg(sender) {
    // In MV3, the service worker has no URL. We identify it by the lack of a tab.
    return !sender.tab;
  }

  static isPopupMsg(sender) {
    return sender.url && sender.url.indexOf('popup') > -1;
  }

  static getCurrentWindowTabs() {
    let promise;
    try {
      promise = new Promise((resolve, reject) => {
        chrome.windows.getCurrent({ populate: true }, (currentWindow) => {
          if (currentWindow && currentWindow.tabs) {
            const websiteTabs = currentWindow.tabs.filter(tab => Browser.isValidUrl(tab.url));
            resolve(websiteTabs);
          } else {
            reject(new Error('No tabs!'));
          }
        });
      });
    } catch (e) {
      promise = new Promise((resolve) => {
        resolve(null);
      });
    }
    return promise;
  }

  static getTabsHtml(tabs) {
    const htmlPromises = tabs.map(
      tab => new Promise((resolve) => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.documentElement.outerHTML,
        }, (injectionResults) => {
          if (chrome.runtime.lastError) {
            // Handle error, e.g., if the tab was closed or the script couldn't be injected
            console.error(chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          // The result is an array of InjectionResult objects. We expect only one.
          const html = injectionResults && injectionResults[0] ? injectionResults[0].result : undefined;
          const updatedTab = { ...tab, content: html };
          if (html && html.match(/html/i)) {
            resolve(updatedTab);
          } else {
            resolve(null);
          }
        });
      }),
    );

    return Promise.all(htmlPromises);
  }

  static getLocalStorage(fields) {
    return new Promise((resolve) => {
      chrome.storage.local.get(fields, (state) => {
        resolve(state);
      });
    });
  }

  static setLocalStorage(keyValues) {
    chrome.storage.local.set(keyValues);
  }

  static sendMessage(...args) {
    chrome.runtime.sendMessage(...args);
  }

  static onBackgroundMessage(cb) {
    chrome.runtime.onMessage.addListener((request, sender) => {
      if (Browser.isBackgroundMsg(sender)) {
        cb(request, sender);
      }
    });
  }

  static onForegroundMessage(cb) {
    chrome.runtime.onMessage.addListener((request, sender) => {
      if (Browser.isPopupMsg(sender)) {
        cb(request, sender);
      }
    });
  }

  static download(params) {
    return new Promise((resolve, reject) => {
      const sanitizedParams = { ...params, filename: sanitize(params.filename) };
      chrome.downloads.download(sanitizedParams, (downloadId) => {
        const downloadListener = (downloadInfo) => {
          if (downloadInfo.id === downloadId) {
            if (downloadInfo.error) {
              chrome.downloads.onChanged.removeListener(downloadListener);
              reject(downloadInfo.error);
            } else if (downloadInfo.state && downloadInfo.state.current === 'complete') {
              chrome.downloads.onChanged.removeListener(downloadListener);
              resolve();
            }
          }
        };

        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          chrome.downloads.onChanged.addListener(downloadListener);
        }
      });
    });
  }

  static baseUrl() {
    return chrome.runtime.getManifest().homepage_url;
  }

  static getManifest() {
    return chrome.runtime.getManifest();
  }

  static getErrorMsg(location, xhr) {
    const errorCodes = {
      // Book Create Errors
      400: 'There was a problem with the request. Is EpubPress up to date?',
      422: 'Request contained invalid data.',
      500: 'Unexpected server error.',
      503: 'Server took too long to respond.',

      // Download Errors
      SERVER_FAILED: 'Server error while downloading.',
      SERVER_BAD_CONTENT: 'Book could not be found',
    };

    return errorCodes[xhr.status] || `An unexpected error occured: ${location}`;
  }
}

export default Browser;
