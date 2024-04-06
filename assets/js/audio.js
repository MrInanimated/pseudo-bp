(function () {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    if (window.AudioContext) {
        var context = new window.AudioContext();
        var masterGain = context.createGain();
        masterGain.connect(context.destination);
        masterGain.gain.value = 0.5;

        window.audio = {
            context: context,
            masterGain: masterGain,

            sounds: {

            },

            loadSound: function (name, source) {
                this.sounds[name] = {loaded: false};

                var request = new XMLHttpRequest();
                request.open("GET", source, true);
                request.responseType = "arraybuffer";

                request.onload = function () {
                    this.context.decodeAudioData(request.response,
                        function (buffer) {
                            if (!buffer) {
                                console.error("Error loading " + source);
                            }
                            else {
                                this.sounds[name].buffer = buffer;
                                this.sounds[name].loaded = true;
                            }
                        }.bind(this),
                        function (error) {
                            console.error("Error decoding audio data", error);
                        });
                }.bind(this);

                request.onerror = function () {
                    console.error("XHR error while loading " + source);
                };

                request.send();
            },

            playSound: function (name, options) {
                if (!this.sounds[name].loaded) return;
                options = options || {};

                var gain = this.context.createGain();
                gain.value = options.volume || 1;
                gain.connect(this.masterGain);

                var buffer = context.createBufferSource();
                buffer.buffer = this.sounds[name].buffer;
                buffer.loop = !!options.loop;
                buffer.connect(gain);
                buffer.start(0);

                return buffer;
            },
        };
    }
    else {
        window.audio = {loadSound: function () {}, playSound: function () {}};

        console.error("Error: Your browser does not support web audio API.");
    }

}).call(this);
