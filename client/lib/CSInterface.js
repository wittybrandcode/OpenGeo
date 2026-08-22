/*************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
*  Copyright 2015 Adobe Systems Incorporated
*  All Rights Reserved.
*
* NOTICE:  All information contained herein is, and remains
* the property of Adobe Systems Incorporated and its suppliers,
* if any.  The intellectual and technical concepts contained
* herein are proprietary to Adobe Systems Incorporated and its
* suppliers and are protected by all applicable intellectual property
* laws, including trade secret and copyright laws.
* Dissemination of this information or reproduction of this material
* is strictly forbidden unless prior written permission is obtained
* from Adobe Systems Incorporated.
**************************************************************************/

/**
 * CSInterface.js - v12.0.0
 * Simplified for CEP 12 / AE 2025
 */

var SystemPath = {
  USER_DATA: 'userData',
  COMMON_FILES: 'commonFiles',
  MY_DOCUMENTS: 'myDocuments',
  APPLICATION: 'application',
  EXTENSION: 'extension',
  HOST_APPLICATION: 'hostApplication',
  TEMP: 'TEMP'
};

var CSInterface = (function () {
  function CSInterface() {
    this._createEvent('com.adobe.csxs.evalScript');
  }

  CSInterface.prototype.evalScript = function (script, callback) {
    if (typeof callback === 'function') {
      this._evalScriptWithCallback(script, callback);
    } else {
      this._evalScript(script);
    }
  };

  CSInterface.prototype._evalScript = function (script) {
    try {
      if (window.__adobe_cep__) {
        var result = window.__adobe_cep__.evalScript(script);
        return result;
      }
      return 'error: window.__adobe_cep__ not available';
    } catch (e) {
      return 'error: ' + e.message;
    }
  };

  CSInterface.prototype._evalScriptWithCallback = function (script, callback) {
    try {
      if (window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(script, callback);
      } else {
        callback('error: window.__adobe_cep__ not available');
      }
    } catch (e) {
      callback('error: ' + e.message);
    }
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    try {
      if (window.__adobe_cep__) {
        var path = window.__adobe_cep__.getSystemPath(pathType);
        if (path) return path;
      }
    } catch (e) {}
    if (pathType === SystemPath.TEMP || pathType === 'TEMP') {
      var userData = this.getSystemPath(SystemPath.USER_DATA);
      if (userData) return userData;
      return 'C:\\Users\\Public';
    }
    return '';
  };

  CSInterface.prototype._createEvent = function (type) {
    try {
      var event = new CSEvent(type, 'APPLICATION');
      event.extensionId = 'com.opengeo.map.panel';
      this._event = event;
    } catch (e) {}
  };

  CSInterface.prototype.getExtensions = function () {
    try {
      return JSON.parse(window.__adobe_cep__.getExtensions());
    } catch (e) {
      return [];
    }
  };

  CSInterface.prototype.getHostEnvironment = function () {
    try {
      return JSON.parse(window.__adobe_cep__.getHostEnvironment());
    } catch (e) {
      return null;
    }
  };

  return CSInterface;
})();

var CSEvent = function (type, scope) {
  this.type = type;
  this.scope = scope;
};

