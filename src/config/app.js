(function() {
  "use strict";

  var Settings = window.BibbleSettings;
  var form = document.getElementById("settings-form");
  var preview = document.getElementById("watch-preview");
  var status = document.getElementById("status");
  var embedded = Settings.readConfigPageState(window.location.search);
  var current = embedded || Settings.loadSettings(window.localStorage);

  function selectedFontSize() {
    var selected = document.querySelector('input[name="font-size"]:checked');
    return Settings.normalizeFontSize(selected ? selected.value : current.fontSize);
  }

  function selectedBold() {
    var selected = document.querySelector('input[name="font-bold"]:checked');
    return Settings.normalizeBold(selected ? selected.value : current.bold);
  }

  function selectedSettings() {
    return Settings.normalizeSettings({
      fontSize: selectedFontSize(),
      bold: selectedBold()
    });
  }

  function render(settings) {
    var normalized = Settings.normalizeSettings(settings);
    var sizeInput = document.querySelector(
      'input[name="font-size"][value="' + normalized.fontSize + '"]'
    );
    var boldInput = document.querySelector(
      'input[name="font-bold"][value="' + (normalized.bold ? "bold" : "regular") + '"]'
    );

    if (sizeInput) {
      sizeInput.checked = true;
    }
    if (boldInput) {
      boldInput.checked = true;
    }
    preview.setAttribute("data-font-size", normalized.fontSize);
    preview.setAttribute("data-bold", normalized.bold ? "true" : "false");
  }

  function closeWith(settings) {
    var closeUrl = "pebblejs://close#" + encodeURIComponent(JSON.stringify(settings));

    if (window.PebbleConfigBridge && typeof window.PebbleConfigBridge.submit === "function") {
      window.PebbleConfigBridge.submit(settings);
      return;
    }

    try {
      window.location.href = closeUrl;
    } catch (_) {
    }
    try {
      document.location = closeUrl;
    } catch (_) {
    }
  }

  render(current);

  form.addEventListener("change", function() {
    render(selectedSettings());
    status.textContent = "Preview updated. Save to apply it to your watch.";
  });

  form.addEventListener("submit", function(event) {
    event.preventDefault();
    current = Settings.saveSettings(selectedSettings(), window.localStorage);
    status.textContent = "Saved. Returning to Pebble…";
    closeWith(current);
  });
}());
