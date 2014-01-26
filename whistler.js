$(function() {
  var LOG_2 = Math.log(2);
  var NOTES = "A A# B C C# D D# E F F# G G#".split(' ');

  function frequencyToNote(hz) {
    var number = 12 * Math.log(hz / 440) / LOG_2 + 49;
    return number;
  } 
  function noteToString(note) {
    var cents = Math.round((note - Math.round(note)) * 100);
    return (
      NOTES[(((Math.round(note) - 1) % 12) + 12) % 12] + " " +
      Math.floor((note + 8) / 12) + " " +
      "(" + (cents >= 0 ? "+" : "") + cents + "%)"
    );
  }

  var spectrumCanvas = $("#spectrum")[0];
  var spectrumContext = spectrumCanvas.getContext("2d");
  var spectrogramCanvas = $("#spectrogram")[0];
  var spectrogramContext = spectrogramCanvas.getContext("2d");
  var frequencyDiv = $("#frequency");
  var noteDiv = $("#note");

  function extractFrequency(spectrum, sampleRate) {
    var n = spectrum.length;
    var peakBin = 0;
    var peak = -1e99;
    for (var i = 0; i < n; ++i) {
      if (spectrum[i] > peak) {
        peak = spectrum[i];
        peakBin = i;
      }
    }

    var adjustment;
    if (peakBin > 0 && peakBin < n - 1) {
      // http://www.ingelec.uns.edu.ar/pds2803/Materiales/Articulos/AnalisisFrecuencial/04205098.pdf
      // Sadly WebAudio gives us only have the magnitude, not the argument :(
      var left = Math.abs(spectrum[peakBin - 1]);
      var middle = Math.abs(spectrum[peakBin]);
      var right = Math.abs(spectrum[peakBin + 1]);
      adjustment = (right - left) / (4 * middle - 2 * left - 2 * right);
    } else {
      adjustment = 0;
    }
    var peak = peakBin + adjustment;
    var frequency = peak * sampleRate / n;
    return frequency;
  }

  function renderSpectrum(spectrum, sampleRate, frequency) {
    var width = spectrumCanvas.width;
    var height = spectrumCanvas.height;

    spectrumContext.clearRect(0, 0, width, height);

    var n = spectrum.length;

    var w = 6;
    for (var i = 0; i < n; ++i) {
      var h = 128 + spectrum[i];
      spectrumContext.fillRect(i * w, height - h, w, h);
    }

    var note = frequencyToNote(frequency);
    frequencyDiv.html(frequency + " Hz");
    noteDiv.html(noteToString(note));

    var peak = frequency / sampleRate * n;
    spectrumContext.strokeStyle = "#f00";
    spectrumContext.beginPath();
    spectrumContext.moveTo((peak + 0.5) * w, 0);
    spectrumContext.lineTo((peak + 0.5) * w, height);
    spectrumContext.closePath();
    spectrumContext.stroke();
  }

  var spectrogramN;

  function clearSpectrogram() {
    var width = spectrogramCanvas.width;
    var height = spectrogramCanvas.height;
    spectrogramContext.clearRect(0, 0, width, height);
    spectrogramN = 0;
  }

  function intensityToColor(x) {
    var c = Math.round(256 + 2*x);
    if (c < 0) c = 0;
    if (c > 255) c = 255;
    return "rgb(" + c + "," + c + "," + c + ")";
  }

  function renderSpectrogram(spectrum, sampleRate, frequency) {
    var width = spectrogramCanvas.width;
    var height = spectrogramCanvas.height;
    var n = spectrum.length;
    var w = 4;
    var h = 2;
    for (var i = 0; i < n; i++) {
      spectrogramContext.fillStyle = intensityToColor(spectrum[i]);
      spectrogramContext.fillRect(spectrogramN * w, height - (i + 1) * h, w, h);
    }

    var peak = frequency / sampleRate * n;
    spectrogramContext.strokeStyle = "#f00";
    spectrogramContext.beginPath();
    spectrogramContext.moveTo(spectrogramN * w, height - (peak + 0.5) * h)
    spectrogramContext.lineTo((spectrogramN + 1) * w, height - (peak + 0.5) * h)
    spectrogramContext.stroke();

    spectrogramN++;
    if (spectrogramN * w > width) spectrogramN = 0;

    spectrogramContext.strokeStyle = "#008";
    spectrogramContext.beginPath();
    spectrogramContext.moveTo(spectrogramN * w + 0.5, 0);
    spectrogramContext.lineTo(spectrogramN * w + 0.5, height);
    spectrogramContext.stroke();
  }

  var context;

  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!window.AudioContext) {
    alert("AudioContext is not supported in your browser.");
    return;
  }
  navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (!navigator.getUserMedia) {
    alert("getUserMedia is not supported in your browser.");
    return;
  }

  try {
    context = new AudioContext();
    context.createScriptProcessor = context.createScriptProcessor || context.createJavaScriptNode;
  } catch (e) {
    alert("Could not create audio context: " + e);
    return;
  }

  var toMono = context.createChannelMerger();

  var analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  toMono.connect(analyser);
  var spectrum = new Float32Array(analyser.frequencyBinCount);

  var scriptProcessor = context.createScriptProcessor(analyser.fftSize);
  scriptProcessor.onaudioprocess = function(e) {
    analyser.getFloatFrequencyData(spectrum);
    var frequency = extractFrequency(spectrum, context.sampleRate);
    renderSpectrum(spectrum, context.sampleRate, frequency);
    renderSpectrogram(spectrum, context.sampleRate, frequency);
  };
  analyser.connect(scriptProcessor);

  var zeroGain = context.createGain();
  zeroGain.gain.value = 0;
  zeroGain.connect(context.destination);

  var microphoneStream;
  var microphone;

  var recordButton = $("#record");
  var stopButton = $("#stop");

  recordButton.on("click", function() {
    navigator.getUserMedia(
      {audio: true},
      function(stream) {
        clearSpectrogram();

        microphoneStream = stream;
        microphone = context.createMediaStreamSource(microphoneStream);
        microphone.connect(toMono);

        // Don't know why this has to be done here, but if we do it during initialization it doesn't work.
        scriptProcessor.connect(zeroGain);

        recordButton.hide();
        stopButton.show();
      },
      function(error) {
        alert("Could not open microphone stream: " + error);
      });
  });
  stopButton.on("click", function() {
    scriptProcessor.disconnect();
    microphone.disconnect();
    microphoneStream.stop();

    stopButton.hide();
    recordButton.show();
  });

  recordButton.click();
});
