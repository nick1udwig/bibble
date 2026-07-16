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

  function render(fontSize) {
    var normalized = Settings.normalizeFontSize(fontSize);
    var input = document.querySelector('input[name="font-size"][value="' + normalized + '"]');

    if (input) {
      input.checked = true;
    }
    preview.setAttribute("data-font-size", normalized);
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

  render(current.fontSize);

  form.addEventListener("change", function() {
    render(selectedFontSize());
    status.textContent = "Preview updated. Save to apply it to your watch.";
  });

  form.addEventListener("submit", function(event) {
    event.preventDefault();
    current = Settings.saveSettings({
      fontSize: selectedFontSize()
    }, window.localStorage);
    status.textContent = "Saved. Returning to Pebble…";
    closeWith(current);
  });
}());
